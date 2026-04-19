import { query, type CanUseTool, type PermissionResult, type Query } from "@anthropic-ai/claude-agent-sdk"
import type {
  AgentProvider,
  ChatAttachment,
  ContextWindowUsageSnapshot,
  NormalizedToolCall,
  PendingToolSnapshot,
  KannaStatus,
  TranscriptEntry,
} from "../shared/types"
import { normalizeToolCall } from "../shared/tools"
import type { ClientCommand } from "../shared/protocol"
import { EventStore } from "./event-store"
import { CodexAppServerManager } from "./codex-app-server"
import { type GenerateChatTitleResult, generateTitleForChatDetailed } from "./generate-title"
import { resolveUploadedAttachments } from "./uploads"
import type { HarnessEvent, HarnessToolRequest, HarnessTurn } from "./harness-types"
import {
  codexServiceTierFromModelOptions,
  getServerProviderCatalog,
  normalizeClaudeModelOptions,
  normalizeCodexModelOptions,
  normalizeServerModel,
} from "./provider-catalog"
import { resolveClaudeApiModelId } from "../shared/types"
import { fallbackTitleFromMessage } from "./generate-title"
import { switchToNextCodexAuthAccount } from "./codex-accounts"

const CLAUDE_TOOLSET = [
  "Skill",
  "WebFetch",
  "WebSearch",
  "Task",
  "TaskOutput",
  "Bash",
  "Glob",
  "Grep",
  "Read",
  "Edit",
  "Write",
  "TodoWrite",
  "KillShell",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
] as const

interface PendingToolRequest {
  toolUseId: string
  tool: NormalizedToolCall & { toolKind: "ask_user_question" | "exit_plan_mode" }
  resolve: (result: unknown) => void
}

interface ActiveTurn {
  chatId: string
  provider: AgentProvider
  turn: HarnessTurn
  model: string
  effort?: string
  serviceTier?: "fast"
  planMode: boolean
  status: KannaStatus
  pendingTool: PendingToolRequest | null
  postToolFollowUp: { content: string; planMode: boolean } | null
  hasFinalResult: boolean
  cancelRequested: boolean
  cancelRecorded: boolean
}

interface AgentCoordinatorArgs {
  store: EventStore
  onStateChange: () => void
  codexManager?: CodexAppServerManager
  generateTitle?: (messageContent: string, cwd: string) => Promise<GenerateChatTitleResult>
  autoSwitchCodexAccount?: typeof switchToNextCodexAuthAccount
}

function timestamped<T extends Omit<TranscriptEntry, "_id" | "createdAt">>(
  entry: T,
  createdAt = Date.now()
): TranscriptEntry {
  return {
    _id: crypto.randomUUID(),
    createdAt,
    ...entry,
  } as TranscriptEntry
}

function stringFromUnknown(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function escapeXmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

const CODEX_USAGE_LIMIT_PATTERN = /you(?:'|’)ve hit your usage limit/i

function isCodexUsageLimitMessage(provider: AgentProvider, message: string) {
  if (provider !== "codex") return false
  return CODEX_USAGE_LIMIT_PATTERN.test(message) || (
    message.toLowerCase().includes("usage limit")
    && message.toLowerCase().includes("codex/settings/usage")
  )
}

function createErrorResultEntry(message: string): Extract<TranscriptEntry, { kind: "result" }> {
  return timestamped({
    kind: "result",
    subtype: "error",
    isError: true,
    durationMs: 0,
    result: message,
  }) as Extract<TranscriptEntry, { kind: "result" }>
}

function compactRetryText(value: string, maxLength = 1200) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function formatRetryContextEntry(entry: TranscriptEntry): string | null {
  switch (entry.kind) {
    case "user_prompt":
      return entry.content.trim() ? `User: ${compactRetryText(entry.content, 1600)}` : null
    case "assistant_text":
      return entry.text.trim() ? `Assistant: ${compactRetryText(entry.text, 1600)}` : null
    case "compact_summary":
      return entry.summary.trim() ? `Summary: ${compactRetryText(entry.summary, 1800)}` : null
    case "tool_call":
      return `Tool ${entry.tool.toolName}: ${compactRetryText(stringFromUnknown(entry.tool.input), 800)}`
    case "tool_result":
      return `Tool result${entry.isError ? " (error)" : ""}: ${compactRetryText(stringFromUnknown(entry.content), 1000)}`
    case "result":
      if (entry.isError || !entry.result.trim()) return null
      return `Result: ${compactRetryText(entry.result, 800)}`
    default:
      return null
  }
}

function buildRetryContinuationPrompt(entries: TranscriptEntry[]) {
  const summaries = entries
    .filter((entry): entry is Extract<TranscriptEntry, { kind: "compact_summary" }> => entry.kind === "compact_summary")
    .map((entry) => compactRetryText(entry.summary, 3_200))
    .filter(Boolean)

  const firstUserPrompt = entries.find((entry): entry is Extract<TranscriptEntry, { kind: "user_prompt" }> => (
    entry.kind === "user_prompt" && entry.content.trim().length > 0
  ))
  const latestUserPrompt = [...entries].reverse().find((entry): entry is Extract<TranscriptEntry, { kind: "user_prompt" }> => (
    entry.kind === "user_prompt" && entry.content.trim().length > 0
  ))

  const recentFormatted = entries
    .map((entry) => formatRetryContextEntry(entry))
    .filter((entry): entry is string => Boolean(entry))

  if (!firstUserPrompt && recentFormatted.length === 0 && summaries.length === 0) {
    return "继续"
  }

  const selectedRecent: string[] = []
  let totalLength = 0
  for (let index = recentFormatted.length - 1; index >= 0; index -= 1) {
    const line = recentFormatted[index]!
    const nextLength = totalLength + line.length + 1
    if (selectedRecent.length >= 40 || nextLength > 24_000) {
      break
    }
    selectedRecent.unshift(line)
    totalLength = nextLength
  }

  const sections = [
    "继续。",
    "",
    "由于账号已自动切换，原来的 Codex thread 无法继续复用。下面附上这段对话的任务背景、压缩摘要和最近上下文。请把它们视为同一任务的既有状态，直接从中断处继续，不要从头开始，也不要重复已经完成的步骤。",
  ]

  if (firstUserPrompt) {
    sections.push("", "<original_task>", compactRetryText(firstUserPrompt.content, 4_000), "</original_task>")
  }

  if (summaries.length > 0) {
    sections.push("", "<conversation_summaries>", ...summaries.map((summary) => `Summary: ${summary}`), "</conversation_summaries>")
  }

  if (latestUserPrompt && latestUserPrompt !== firstUserPrompt) {
    sections.push("", "<latest_user_request>", compactRetryText(latestUserPrompt.content, 4_000), "</latest_user_request>")
  }

  if (selectedRecent.length > 0) {
    sections.push("", "<recent_conversation_context>", ...selectedRecent, "</recent_conversation_context>")
  }

  sections.push("", "请先简短确认你已恢复上述上下文，然后直接继续执行。")

  return [
    ...sections,
  ].join("\n")
}

export function buildAttachmentHintText(attachments: ChatAttachment[]) {
  if (attachments.length === 0) return ""

  const lines = attachments.map((attachment) => (
    `<attachment kind="${escapeXmlAttribute(attachment.kind)}" mime_type="${escapeXmlAttribute(attachment.mimeType)}" path="${escapeXmlAttribute(attachment.absolutePath)}" project_path="${escapeXmlAttribute(attachment.relativePath)}" size_bytes="${attachment.size}" display_name="${escapeXmlAttribute(attachment.displayName)}" />`
  ))

  return [
    "<kanna-attachments>",
    ...lines,
    "</kanna-attachments>",
  ].join("\n")
}

export function buildPromptText(content: string, attachments: ChatAttachment[]) {
  const attachmentHint = buildAttachmentHintText(attachments)
  if (!attachmentHint) {
    return content.trim()
  }

  const trimmed = content.trim()
  return [
    trimmed || "Please inspect the attached files.",
    attachmentHint,
  ].join("\n\n").trim()
}

export function buildTitleSeedText(content: string, attachments: Array<Pick<ChatAttachment, "displayName">>) {
  const normalizedContent = content.replace(/\s+/g, " ").trim()
  if (normalizedContent) {
    return normalizedContent
  }

  const displayNames = attachments
    .map((attachment) => attachment.displayName.trim())
    .filter(Boolean)

  if (displayNames.length === 0) {
    return ""
  }

  if (displayNames.length === 1) {
    return `Review ${displayNames[0]}`
  }

  if (displayNames.length === 2) {
    return `Review ${displayNames[0]} and ${displayNames[1]}`
  }

  return `Review ${displayNames[0]}, ${displayNames[1]}, and ${displayNames.length - 2} more files`
}

function discardedToolResult(
  tool: NormalizedToolCall & { toolKind: "ask_user_question" | "exit_plan_mode" }
) {
  if (tool.toolKind === "ask_user_question") {
    return {
      discarded: true,
      answers: {},
    }
  }

  return {
    discarded: true,
  }
}

export function normalizeClaudeStreamMessage(message: any): TranscriptEntry[] {
  const debugRaw = JSON.stringify(message)
  const messageId = typeof message.uuid === "string" ? message.uuid : undefined

  if (message.type === "system" && message.subtype === "init") {
    return [
      timestamped({
        kind: "system_init",
        messageId,
        provider: "claude",
        model: typeof message.model === "string" ? message.model : "unknown",
        tools: Array.isArray(message.tools) ? message.tools : [],
        agents: Array.isArray(message.agents) ? message.agents : [],
        slashCommands: Array.isArray(message.slash_commands)
          ? message.slash_commands.filter((entry: string) => !entry.startsWith("._"))
          : [],
        mcpServers: Array.isArray(message.mcp_servers) ? message.mcp_servers : [],
        debugRaw,
      }),
    ]
  }

  if (message.type === "assistant" && Array.isArray(message.message?.content)) {
    const entries: TranscriptEntry[] = []
    for (const content of message.message.content) {
      if (content.type === "text" && typeof content.text === "string") {
        entries.push(timestamped({
          kind: "assistant_text",
          messageId,
          text: content.text,
          debugRaw,
        }))
      }
      if (content.type === "tool_use" && typeof content.name === "string" && typeof content.id === "string") {
        entries.push(timestamped({
          kind: "tool_call",
          messageId,
          tool: normalizeToolCall({
            toolName: content.name,
            toolId: content.id,
            input: (content.input ?? {}) as Record<string, unknown>,
          }),
          debugRaw,
        }))
      }
    }
    return entries
  }

  if (message.type === "user" && Array.isArray(message.message?.content)) {
    const entries: TranscriptEntry[] = []
    for (const content of message.message.content) {
      if (content.type === "tool_result" && typeof content.tool_use_id === "string") {
        entries.push(timestamped({
          kind: "tool_result",
          messageId,
          toolId: content.tool_use_id,
          content: content.content,
          isError: Boolean(content.is_error),
          debugRaw,
        }))
      }
      if (message.message.role === "user" && typeof message.message.content === "string") {
        entries.push(timestamped({
          kind: "compact_summary",
          messageId,
          summary: message.message.content,
          debugRaw,
        }))
      }
    }
    return entries
  }

  if (message.type === "result") {
    if (message.subtype === "cancelled") {
      return [timestamped({ kind: "interrupted", messageId, debugRaw })]
    }
    return [
      timestamped({
        kind: "result",
        messageId,
        subtype: message.is_error ? "error" : "success",
        isError: Boolean(message.is_error),
        durationMs: typeof message.duration_ms === "number" ? message.duration_ms : 0,
        result: typeof message.result === "string" ? message.result : stringFromUnknown(message.result),
        costUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : undefined,
        debugRaw,
      }),
    ]
  }

  if (message.type === "system" && message.subtype === "status" && typeof message.status === "string") {
    return [timestamped({ kind: "status", messageId, status: message.status, debugRaw })]
  }

  if (message.type === "system" && message.subtype === "compact_boundary") {
    return [timestamped({ kind: "compact_boundary", messageId, debugRaw })]
  }

  if (message.type === "system" && message.subtype === "context_cleared") {
    return [timestamped({ kind: "context_cleared", messageId, debugRaw })]
  }

  if (
    message.type === "user" &&
    message.message?.role === "user" &&
    typeof message.message.content === "string" &&
    message.message.content.startsWith("This session is being continued")
  ) {
    return [timestamped({ kind: "compact_summary", messageId, summary: message.message.content, debugRaw })]
  }

  return []
}

export function normalizeClaudeUsageSnapshot(
  value: unknown,
  maxTokens?: number,
): ContextWindowUsageSnapshot | null {
  const usage = asRecord(value)
  if (!usage) return null

  const directInputTokens = asNumber(usage.input_tokens) ?? asNumber(usage.inputTokens) ?? 0
  const cacheCreationInputTokens =
    asNumber(usage.cache_creation_input_tokens) ?? asNumber(usage.cacheCreationInputTokens) ?? 0
  const cacheReadInputTokens =
    asNumber(usage.cache_read_input_tokens) ?? asNumber(usage.cacheReadInputTokens) ?? 0
  const outputTokens = asNumber(usage.output_tokens) ?? asNumber(usage.outputTokens) ?? 0
  const reasoningOutputTokens =
    asNumber(usage.reasoning_output_tokens) ?? asNumber(usage.reasoningOutputTokens)
  const toolUses = asNumber(usage.tool_uses) ?? asNumber(usage.toolUses)
  const durationMs = asNumber(usage.duration_ms) ?? asNumber(usage.durationMs)

  const inputTokens = directInputTokens + cacheCreationInputTokens + cacheReadInputTokens
  const usedTokens = inputTokens + outputTokens
  if (usedTokens <= 0) {
    return null
  }

  return {
    usedTokens,
    inputTokens,
    ...(cacheReadInputTokens > 0 ? { cachedInputTokens: cacheReadInputTokens } : {}),
    ...(outputTokens > 0 ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    lastUsedTokens: usedTokens,
    lastInputTokens: inputTokens,
    ...(cacheReadInputTokens > 0 ? { lastCachedInputTokens: cacheReadInputTokens } : {}),
    ...(outputTokens > 0 ? { lastOutputTokens: outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { lastReasoningOutputTokens: reasoningOutputTokens } : {}),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(typeof maxTokens === "number" && maxTokens > 0 ? { maxTokens } : {}),
    compactsAutomatically: false,
  }
}

export function maxClaudeContextWindowFromModelUsage(modelUsage: unknown): number | undefined {
  const record = asRecord(modelUsage)
  if (!record) return undefined

  let maxContextWindow: number | undefined
  for (const value of Object.values(record)) {
    const usage = asRecord(value)
    const contextWindow = asNumber(usage?.contextWindow) ?? asNumber(usage?.context_window)
    if (contextWindow === undefined) continue
    maxContextWindow = Math.max(maxContextWindow ?? 0, contextWindow)
  }
  return maxContextWindow
}

function getClaudeAssistantMessageUsageId(message: any): string | null {
  if (typeof message?.message?.id === "string" && message.message.id) {
    return message.message.id
  }
  if (typeof message?.uuid === "string" && message.uuid) {
    return message.uuid
  }
  return null
}

async function* createClaudeHarnessStream(q: Query): AsyncGenerator<HarnessEvent> {
  let seenAssistantUsageIds = new Set<string>()
  let latestUsageSnapshot: ContextWindowUsageSnapshot | null = null
  let lastKnownContextWindow: number | undefined

  for await (const sdkMessage of q as AsyncIterable<any>) {
    const sessionToken = typeof sdkMessage.session_id === "string" ? sdkMessage.session_id : null
    if (sessionToken) {
      yield { type: "session_token", sessionToken }
    }

    if (sdkMessage?.type === "assistant") {
      const usageId = getClaudeAssistantMessageUsageId(sdkMessage)
      const usageSnapshot = normalizeClaudeUsageSnapshot(sdkMessage.usage, lastKnownContextWindow)
      if (usageId && usageSnapshot && !seenAssistantUsageIds.has(usageId)) {
        seenAssistantUsageIds.add(usageId)
        latestUsageSnapshot = usageSnapshot
        yield {
          type: "transcript",
          entry: timestamped({
            kind: "context_window_updated",
            usage: usageSnapshot,
            hidden: true,
          }),
        }
      }
    }

    if (sdkMessage?.type === "result") {
      const resultContextWindow = maxClaudeContextWindowFromModelUsage(sdkMessage.modelUsage)
      if (resultContextWindow !== undefined) {
        lastKnownContextWindow = resultContextWindow
      }

      const accumulatedUsage = normalizeClaudeUsageSnapshot(
        sdkMessage.usage,
        resultContextWindow ?? lastKnownContextWindow,
      )
      const finalUsage = latestUsageSnapshot
        ? {
            ...latestUsageSnapshot,
            ...(typeof (resultContextWindow ?? lastKnownContextWindow) === "number"
              ? { maxTokens: resultContextWindow ?? lastKnownContextWindow }
              : {}),
            ...(accumulatedUsage && accumulatedUsage.usedTokens > latestUsageSnapshot.usedTokens
              ? { totalProcessedTokens: accumulatedUsage.usedTokens }
              : {}),
          }
        : accumulatedUsage

      if (finalUsage) {
        yield {
          type: "transcript",
          entry: timestamped({
            kind: "context_window_updated",
            usage: finalUsage,
            hidden: true,
          }),
        }
      }

      seenAssistantUsageIds = new Set<string>()
      latestUsageSnapshot = null
    }

    for (const entry of normalizeClaudeStreamMessage(sdkMessage)) {
      yield { type: "transcript", entry }
    }
  }
}

async function startClaudeTurn(args: {
  content: string
  localPath: string
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  onToolRequest: (request: HarnessToolRequest) => Promise<unknown>
}): Promise<HarnessTurn> {
  const canUseTool: CanUseTool = async (toolName, input, options) => {
    if (toolName !== "AskUserQuestion" && toolName !== "ExitPlanMode") {
      return {
        behavior: "allow",
        updatedInput: input,
      }
    }

    const tool = normalizeToolCall({
      toolName,
      toolId: options.toolUseID,
      input: (input ?? {}) as Record<string, unknown>,
    })

    if (tool.toolKind !== "ask_user_question" && tool.toolKind !== "exit_plan_mode") {
      return {
        behavior: "deny",
        message: "Unsupported tool request",
      }
    }

    const result = await args.onToolRequest({ tool })

    if (tool.toolKind === "ask_user_question") {
      const record = result && typeof result === "object" ? result as Record<string, unknown> : {}
      return {
        behavior: "allow",
        updatedInput: {
          ...(tool.rawInput ?? {}),
          questions: record.questions ?? tool.input.questions,
          answers: record.answers ?? result,
        },
      } satisfies PermissionResult
    }

    const record = result && typeof result === "object" ? result as Record<string, unknown> : {}
    const confirmed = Boolean(record.confirmed)
    if (confirmed) {
      return {
        behavior: "allow",
        updatedInput: {
          ...(tool.rawInput ?? {}),
          ...record,
        },
      } satisfies PermissionResult
    }

    return {
      behavior: "deny",
      message: typeof record.message === "string"
        ? `User wants to suggest edits to the plan: ${record.message}`
        : "User wants to suggest edits to the plan before approving.",
    } satisfies PermissionResult
  }

  const q = query({
    prompt: args.content,
    options: {
      cwd: args.localPath,
      model: args.model,
      effort: args.effort as "low" | "medium" | "high" | "max" | undefined,
      resume: args.sessionToken ?? undefined,
      permissionMode: args.planMode ? "plan" : "acceptEdits",
      canUseTool,
      tools: [...CLAUDE_TOOLSET],
      settingSources: ["user", "project", "local"],
      env: (() => { const { CLAUDECODE: _, ...env } = process.env; return env })(),
    },
  })

  return {
    provider: "claude",
    stream: createClaudeHarnessStream(q),
    getAccountInfo: async () => {
      try {
        return await q.accountInfo()
      } catch {
        return null
      }
    },
    interrupt: async () => {
      await q.interrupt()
    },
    close: () => {
      q.close()
    },
  }
}

export class AgentCoordinator {
  private readonly store: EventStore
  private readonly onStateChange: () => void
  private readonly codexManager: CodexAppServerManager
  private readonly generateTitle: (messageContent: string, cwd: string) => Promise<GenerateChatTitleResult>
  private readonly autoSwitchCodexAccount: typeof switchToNextCodexAuthAccount
  private reportBackgroundError: ((message: string) => void) | null = null
  readonly activeTurns = new Map<string, ActiveTurn>()
  readonly drainingStreams = new Map<string, { turn: HarnessTurn }>()

  constructor(args: AgentCoordinatorArgs) {
    this.store = args.store
    this.onStateChange = args.onStateChange
    this.codexManager = args.codexManager ?? new CodexAppServerManager()
    this.generateTitle = args.generateTitle ?? generateTitleForChatDetailed
    this.autoSwitchCodexAccount = args.autoSwitchCodexAccount ?? switchToNextCodexAuthAccount
  }

  setBackgroundErrorReporter(report: ((message: string) => void) | null) {
    this.reportBackgroundError = report
  }

  getActiveStatuses() {
    const statuses = new Map<string, KannaStatus>()
    for (const [chatId, turn] of this.activeTurns.entries()) {
      statuses.set(chatId, turn.status)
    }
    return statuses
  }

  getPendingTool(chatId: string): PendingToolSnapshot | null {
    const pending = this.activeTurns.get(chatId)?.pendingTool
    if (!pending) return null
    return { toolUseId: pending.toolUseId, toolKind: pending.tool.toolKind }
  }

  getDrainingChatIds(): Set<string> {
    return new Set(this.drainingStreams.keys())
  }

  async restartCodexSessions() {
    const activeCodexChatIds = [...this.activeTurns.values()]
      .filter((turn) => turn.provider === "codex")
      .map((turn) => turn.chatId)

    await Promise.allSettled(activeCodexChatIds.map((chatId) => this.cancel(chatId)))
    this.codexManager.stopAll()
    this.onStateChange()
  }

  async stopDraining(chatId: string) {
    const draining = this.drainingStreams.get(chatId)
    if (!draining) return
    draining.turn.close()
    this.drainingStreams.delete(chatId)
    this.onStateChange()
  }

  private async maybeAnnotateUsageLimitResult(
    active: ActiveTurn,
    entry: Extract<TranscriptEntry, { kind: "result" }>
  ): Promise<Extract<TranscriptEntry, { kind: "result" }>> {
    if (!entry.isError || !isCodexUsageLimitMessage(active.provider, entry.result)) {
      return entry
    }

    try {
      const switched = await this.autoSwitchCodexAccount()
      if (!switched) {
        return entry
      }

      const retrySessionToken = this.store.requireChat(active.chatId).sessionToken
      this.codexManager.stopSession(active.chatId)
      const retryPrompt = retrySessionToken
        ? "继续"
        : buildRetryContinuationPrompt(this.store.getMessages(active.chatId))

      const accountLabel = switched.switchedAccount.email ?? switched.switchedAccount.id
      return {
        ...entry,
        retryAction: {
          type: "send_message",
          label: "Retry",
          content: retryPrompt,
          provider: "codex",
        },
        autoRecovery: {
          type: "codex_usage_limit_switch",
          switchedAccountId: switched.switchedAccount.id,
          switchedAccountEmail: switched.switchedAccount.email,
          notice: `Codex account switched to ${accountLabel}. Click Retry to send "继续".`,
        },
      }
    } catch {
      return entry
    }
  }

  private resolveProvider(command: Extract<ClientCommand, { type: "chat.send" }>, currentProvider: AgentProvider | null) {
    if (currentProvider) return currentProvider
    return command.provider ?? "claude"
  }

  private getProviderSettings(provider: AgentProvider, command: Extract<ClientCommand, { type: "chat.send" }>) {
    const catalog = getServerProviderCatalog(provider)
    if (provider === "claude") {
      const model = normalizeServerModel(provider, command.model)
      const modelOptions = normalizeClaudeModelOptions(model, command.modelOptions, command.effort)
      return {
        model: resolveClaudeApiModelId(model, modelOptions.contextWindow),
        effort: modelOptions.reasoningEffort,
        serviceTier: undefined,
        planMode: catalog.supportsPlanMode ? Boolean(command.planMode) : false,
      }
    }

    const modelOptions = normalizeCodexModelOptions(command.modelOptions, command.effort)
    return {
      model: normalizeServerModel(provider, command.model),
      effort: modelOptions.reasoningEffort,
      serviceTier: codexServiceTierFromModelOptions(modelOptions),
      planMode: catalog.supportsPlanMode ? Boolean(command.planMode) : false,
    }
  }

  private async startTurnForChat(args: {
    chatId: string
    provider: AgentProvider
    content: string
    attachments: ChatAttachment[]
    model: string
    effort?: string
    serviceTier?: "fast"
    planMode: boolean
    appendUserPrompt: boolean
  }) {
    // Close any lingering draining stream before starting a new turn.
    const draining = this.drainingStreams.get(args.chatId)
    if (draining) {
      draining.turn.close()
      this.drainingStreams.delete(args.chatId)
    }

    const chat = this.store.requireChat(args.chatId)
    if (this.activeTurns.has(args.chatId)) {
      throw new Error("Chat is already running")
    }

    if (!chat.provider) {
      await this.store.setChatProvider(args.chatId, args.provider)
    }
    await this.store.setPlanMode(args.chatId, args.planMode)

    const project = this.store.getProject(chat.projectId)
    if (!project) {
      throw new Error("Project not found")
    }

    const attachments = await resolveUploadedAttachments({
      projectId: project.id,
      localPath: project.localPath,
      attachments: args.attachments,
    })
    const titleSeedText = buildTitleSeedText(args.content, attachments)

    const existingMessages = this.store.getMessages(args.chatId)
    const shouldGenerateTitle = args.appendUserPrompt && chat.title === "New Chat" && existingMessages.length === 0
    const optimisticTitle = shouldGenerateTitle ? fallbackTitleFromMessage(titleSeedText) : null

    if (optimisticTitle) {
      await this.store.renameChat(args.chatId, optimisticTitle)
    }

    if (args.appendUserPrompt) {
      await this.store.appendMessage(
        args.chatId,
        timestamped({ kind: "user_prompt", content: args.content, attachments }, Date.now())
      )
    }
    await this.store.recordTurnStarted(args.chatId)

    if (shouldGenerateTitle) {
      void this.generateTitleInBackground(args.chatId, titleSeedText, project.localPath, optimisticTitle ?? "New Chat")
    }

    const onToolRequest = async (request: HarnessToolRequest): Promise<unknown> => {
      const active = this.activeTurns.get(args.chatId)
      if (!active) {
        throw new Error("Chat turn ended unexpectedly")
      }

      active.status = "waiting_for_user"
      this.onStateChange()

      return await new Promise<unknown>((resolve) => {
        active.pendingTool = {
          toolUseId: request.tool.toolId,
          tool: request.tool,
          resolve,
        }
      })
    }

    let turn: HarnessTurn
    if (args.provider === "claude") {
      turn = await startClaudeTurn({
        content: buildPromptText(args.content, attachments),
        localPath: project.localPath,
        model: args.model,
        effort: args.effort,
        planMode: args.planMode,
        sessionToken: chat.sessionToken,
        onToolRequest,
      })
    } else {
      await this.codexManager.startSession({
        chatId: args.chatId,
        cwd: project.localPath,
        model: args.model,
        serviceTier: args.serviceTier,
        sessionToken: chat.sessionToken,
      })
      turn = await this.codexManager.startTurn({
        chatId: args.chatId,
        content: buildPromptText(args.content, attachments),
        model: args.model,
        effort: args.effort as any,
        serviceTier: args.serviceTier,
        planMode: args.planMode,
        onToolRequest,
      })
    }

    const active: ActiveTurn = {
      chatId: args.chatId,
      provider: args.provider,
      turn,
      model: args.model,
      effort: args.effort,
      serviceTier: args.serviceTier,
      planMode: args.planMode,
      status: "starting",
      pendingTool: null,
      postToolFollowUp: null,
      hasFinalResult: false,
      cancelRequested: false,
      cancelRecorded: false,
    }
    this.activeTurns.set(args.chatId, active)
    this.onStateChange()

    if (turn.getAccountInfo) {
      void turn.getAccountInfo()
        .then(async (accountInfo) => {
          if (!accountInfo) return
          await this.store.appendMessage(args.chatId, timestamped({ kind: "account_info", accountInfo }))
          this.onStateChange()
        })
        .catch(() => undefined)
    }

    void this.runTurn(active)
  }

  async send(command: Extract<ClientCommand, { type: "chat.send" }>) {
    let chatId = command.chatId

    if (!chatId) {
      if (!command.projectId) {
        throw new Error("Missing projectId for new chat")
      }
      const created = await this.store.createChat(command.projectId)
      chatId = created.id
    }

    const chat = this.store.requireChat(chatId)
    const provider = this.resolveProvider(command, chat.provider)
    const settings = this.getProviderSettings(provider, command)
    await this.startTurnForChat({
      chatId,
      provider,
      content: command.content,
      attachments: command.attachments ?? [],
      model: settings.model,
      effort: settings.effort,
      serviceTier: settings.serviceTier,
      planMode: settings.planMode,
      appendUserPrompt: true,
    })

    return { chatId }
  }

  private async generateTitleInBackground(chatId: string, messageContent: string, cwd: string, expectedCurrentTitle: string) {
    try {
      const result = await this.generateTitle(messageContent, cwd)
      if (result.failureMessage) {
        this.reportBackgroundError?.(
          `[title-generation] chat ${chatId} failed provider title generation: ${result.failureMessage}`
        )
      }
      if (!result.title || result.usedFallback) return

      const chat = this.store.requireChat(chatId)
      if (chat.title !== expectedCurrentTitle) return

      await this.store.renameChat(chatId, result.title)
      this.onStateChange()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.reportBackgroundError?.(
        `[title-generation] chat ${chatId} failed background title generation: ${message}`
      )
    }
  }

  private async runTurn(active: ActiveTurn) {
    try {
      for await (const event of active.turn.stream) {
        // Once cancelled, stop processing further stream events.
        // cancel() already removed us from activeTurns and notified the UI.
        if (active.cancelRequested) break

        if (event.type === "session_token" && event.sessionToken) {
          await this.store.setSessionToken(active.chatId, event.sessionToken)
          this.onStateChange()
          continue
        }

        if (!event.entry) continue
        const entry = event.entry.kind === "result"
          ? await this.maybeAnnotateUsageLimitResult(active, event.entry)
          : event.entry
        await this.store.appendMessage(active.chatId, entry)

        if (entry.kind === "system_init") {
          active.status = "running"
        }

        if (entry.kind === "result") {
          active.hasFinalResult = true
          if (entry.isError) {
            await this.store.recordTurnFailed(active.chatId, entry.result || "Turn failed")
          } else if (!active.cancelRequested) {
            await this.store.recordTurnFinished(active.chatId)
          }
          // Remove from activeTurns as soon as the result arrives so the UI
          // transitions to idle immediately. The stream may still be open
          // (e.g. background tasks), but the user should be able to send
          // new messages without having to hit stop first.
          this.activeTurns.delete(active.chatId)
          // Track the still-open stream so the UI can show a draining
          // indicator and the user can stop background tasks.
          this.drainingStreams.set(active.chatId, { turn: active.turn })
        }

        this.onStateChange()
      }
    } catch (error) {
      if (!active.cancelRequested) {
        const message = error instanceof Error ? error.message : String(error)
        const resultEntry = await this.maybeAnnotateUsageLimitResult(
          active,
          createErrorResultEntry(message)
        )
        await this.store.appendMessage(
          active.chatId,
          resultEntry
        )
        await this.store.recordTurnFailed(active.chatId, message)
      }
    } finally {
      if (active.cancelRequested && !active.cancelRecorded) {
        await this.store.recordTurnCancelled(active.chatId)
      }
      active.turn.close()
      // Only remove if we're still the active turn for this chat.
      // We may have already been removed by result handling or cancel(),
      // and a new turn may have started for the same chatId.
      if (this.activeTurns.get(active.chatId) === active) {
        this.activeTurns.delete(active.chatId)
      }
      // Stream has fully ended — no longer draining.
      this.drainingStreams.delete(active.chatId)
      this.onStateChange()

      if (active.postToolFollowUp && !active.cancelRequested) {
        try {
          await this.startTurnForChat({
            chatId: active.chatId,
            provider: active.provider,
            content: active.postToolFollowUp.content,
            attachments: [],
            model: active.model,
            effort: active.effort,
            serviceTier: active.serviceTier,
            planMode: active.postToolFollowUp.planMode,
            appendUserPrompt: false,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const resultEntry = await this.maybeAnnotateUsageLimitResult(
            active,
            createErrorResultEntry(message)
          )
          await this.store.appendMessage(
            active.chatId,
            resultEntry
          )
          await this.store.recordTurnFailed(active.chatId, message)
          this.onStateChange()
        }
      }
    }
  }

  async cancel(chatId: string) {
    // Also clean up any draining stream for this chat.
    const draining = this.drainingStreams.get(chatId)
    if (draining) {
      draining.turn.close()
      this.drainingStreams.delete(chatId)
    }

    const active = this.activeTurns.get(chatId)
    if (!active) return

    // Guard against concurrent cancel() calls — only the first one does work.
    if (active.cancelRequested) return
    active.cancelRequested = true

    const pendingTool = active.pendingTool
    active.pendingTool = null

    if (pendingTool) {
      const result = discardedToolResult(pendingTool.tool)
      await this.store.appendMessage(
        chatId,
        timestamped({
          kind: "tool_result",
          toolId: pendingTool.toolUseId,
          content: result,
        })
      )
      if (active.provider === "codex" && pendingTool.tool.toolKind === "exit_plan_mode") {
        pendingTool.resolve(result)
      }
    }

    await this.store.appendMessage(chatId, timestamped({ kind: "interrupted" }))
    await this.store.recordTurnCancelled(chatId)
    active.cancelRecorded = true
    active.hasFinalResult = true

    // Remove from activeTurns immediately so the UI reflects the cancellation
    // right away, rather than waiting for interrupt() which may hang.
    this.activeTurns.delete(chatId)
    this.onStateChange()

    // Now attempt to interrupt/close the underlying stream in the background.
    // This is best-effort — the turn is already removed from active state above,
    // and runTurn()'s finally block will also call close().
    try {
      await Promise.race([
        active.turn.interrupt(),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    } catch {
      // interrupt() failed — force close
    }
    active.turn.close()
  }

  async respondTool(command: Extract<ClientCommand, { type: "chat.respondTool" }>) {
    const active = this.activeTurns.get(command.chatId)
    if (!active || !active.pendingTool) {
      throw new Error("No pending tool request")
    }

    const pending = active.pendingTool
    if (pending.toolUseId !== command.toolUseId) {
      throw new Error("Tool response does not match active request")
    }

    await this.store.appendMessage(
      command.chatId,
      timestamped({
        kind: "tool_result",
        toolId: command.toolUseId,
        content: command.result,
      })
    )

    active.pendingTool = null
    active.status = "running"

    if (pending.tool.toolKind === "exit_plan_mode") {
      const result = (command.result ?? {}) as {
        confirmed?: boolean
        clearContext?: boolean
        message?: string
      }
      if (result.confirmed && result.clearContext) {
        await this.store.setSessionToken(command.chatId, null)
        await this.store.appendMessage(command.chatId, timestamped({ kind: "context_cleared" }))
      }

      if (active.provider === "codex") {
        active.postToolFollowUp = result.confirmed
          ? {
              content: result.message
                ? `Proceed with the approved plan. Additional guidance: ${result.message}`
                : "Proceed with the approved plan.",
              planMode: false,
            }
          : {
              content: result.message
                ? `Revise the plan using this feedback: ${result.message}`
                : "Revise the plan using this feedback.",
              planMode: true,
            }
      }
    }

    pending.resolve(command.result)

    this.onStateChange()
  }
}
