import { hydrateToolResult } from "../../shared/tools"
import type {
  HydratedSubagentTaskResult,
  HydratedSubagentTaskStatus,
  HydratedSubagentTranscriptPreview,
  HydratedToolCall,
  HydratedTranscriptMessage,
  NormalizedToolCall,
  SubagentThreadSummary,
  TranscriptEntry,
} from "../../shared/types"

function createTimestamp(createdAt: number): string {
  return new Date(createdAt).toISOString()
}

function createBaseMessage(entry: TranscriptEntry) {
  return {
    id: entry._id,
    messageId: entry.messageId,
    timestamp: createTimestamp(entry.createdAt),
    hidden: entry.hidden,
  }
}

function hydrateToolCall(entry: Extract<TranscriptEntry, { kind: "tool_call" }>): HydratedToolCall {
  return {
    id: entry._id,
    messageId: entry.messageId,
    hidden: entry.hidden,
    kind: "tool",
    toolKind: entry.tool.toolKind,
    toolName: entry.tool.toolName,
    toolId: entry.tool.toolId,
    input: entry.tool.input as HydratedToolCall["input"],
    rawInput: entry.tool.rawInput,
    debugRaw: entry.debugRaw,
    timestamp: createTimestamp(entry.createdAt),
  } as HydratedToolCall
}

function getStructuredToolResultFromDebug(entry: Extract<TranscriptEntry, { kind: "tool_result" }>): unknown {
  if (!entry.debugRaw) return undefined

  try {
    const parsed = JSON.parse(entry.debugRaw) as { tool_use_result?: unknown }
    return parsed.tool_use_result
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry))
}

function normalizeSubagentStatus(value: unknown): HydratedSubagentTaskStatus | undefined {
  const status = readString(value)?.toLowerCase()
  if (!status) return undefined

  if (["failed", "error", "errored", "cancelled"].includes(status)) return "error"
  if (["completed", "complete", "succeeded", "success", "finished"].includes(status)) return "success"
  if (["waiting", "blocked", "pending", "paused", "approval_required", "needs_approval"].includes(status)) return "waiting"
  if (["running", "inprogress", "in_progress", "started", "working"].includes(status)) return "running"
  return undefined
}

function transcriptEntriesFromUnknown(value: unknown): TranscriptEntry[] | null {
  if (!Array.isArray(value)) return null
  const entries = value.filter((entry) => {
    const record = asRecord(entry)
    return Boolean(record && typeof record.kind === "string" && typeof record._id === "string" && typeof record.createdAt === "number")
  }) as TranscriptEntry[]

  return entries.length === value.length ? entries : null
}

function hydratedMessagesFromUnknown(value: unknown): HydratedTranscriptMessage[] | null {
  if (!Array.isArray(value)) return null

  const messages = value.filter((entry) => {
    const record = asRecord(entry)
    return Boolean(record && typeof record.kind === "string" && typeof record.id === "string" && typeof record.timestamp === "string")
  }) as HydratedTranscriptMessage[]

  return messages.length === value.length ? messages : null
}

function extractTranscriptMessages(value: unknown): HydratedTranscriptMessage[] | undefined {
  const transcriptEntries = transcriptEntriesFromUnknown(value)
  if (transcriptEntries) {
    return processTranscriptMessages(transcriptEntries)
  }

  const hydratedMessages = hydratedMessagesFromUnknown(value)
  if (hydratedMessages) {
    return hydratedMessages
  }

  return undefined
}

function lastAssistantText(messages: HydratedTranscriptMessage[] | undefined): string | undefined {
  if (!messages?.length) return undefined

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.kind === "assistant_text") {
      const text = message.text.trim()
      if (text) return text
    }
  }

  return undefined
}

function extractChildTranscriptPreview(record: Record<string, unknown>): HydratedSubagentTranscriptPreview | undefined {
  const directCandidate = record.childTranscript ?? record.child_transcript ?? record.transcriptPreview ?? record.transcript_preview
  const nestedCandidate = asRecord(record.childThread ?? record.child_thread)
  const previewRecord = Array.isArray(directCandidate)
    ? null
    : asRecord(directCandidate) ?? nestedCandidate

  const rawMessages = Array.isArray(directCandidate)
    ? directCandidate
    : previewRecord?.messages ?? previewRecord?.entries ?? previewRecord?.transcript

  const messages = extractTranscriptMessages(rawMessages)
  if (!messages?.length) return undefined

  const providerStatus = readString(previewRecord?.status ?? nestedCandidate?.status)
  const summary = lastAssistantText(messages) ?? readString(previewRecord?.summary ?? nestedCandidate?.summary)
  return {
    threadId: readString(previewRecord?.threadId ?? previewRecord?.thread_id ?? nestedCandidate?.threadId ?? nestedCandidate?.thread_id),
    sessionId: readString(previewRecord?.sessionId ?? previewRecord?.session_id ?? nestedCandidate?.sessionId ?? nestedCandidate?.session_id),
    title: readString(previewRecord?.title ?? nestedCandidate?.title),
    status: normalizeSubagentStatus(providerStatus),
    providerStatus,
    summary,
    messageCount: readNumber(previewRecord?.messageCount ?? previewRecord?.message_count) ?? messages.length,
    hasMore: previewRecord?.hasMore === true || previewRecord?.has_more === true,
    messages,
  }
}

function extractChildThreads(record: Record<string, unknown>): SubagentThreadSummary[] {
  const threadIds = readStringArray(record.receiverThreadIds ?? record.receiver_thread_ids)
  const stateEntries = asRecord(record.agentsStates ?? record.agent_states)
  const stateThreadIds = stateEntries ? Object.keys(stateEntries) : []
  const orderedIds = [...new Set([...threadIds, ...stateThreadIds])]

  return orderedIds.map((threadId) => {
    const state = asRecord(stateEntries?.[threadId])
    const providerStatus = readString(state?.status)

    return {
      threadId,
      status: normalizeSubagentStatus(providerStatus),
      providerStatus,
      latestMessage: readString(state?.message),
      summary: readString(state?.message),
    } satisfies SubagentThreadSummary
  })
}

function hydrateSubagentResult(rawResult: unknown, rawInput: Record<string, unknown> | undefined, isError?: boolean): HydratedSubagentTaskResult {
  const record = asRecord(rawResult)
  const inputRecord = asRecord(rawInput)
  const transcriptPreview = record ? extractChildTranscriptPreview(record) : undefined
  const childThreads = record ? extractChildThreads(record) : []
  const providerStatus = readString(record?.status)
  const childThreadIds = [...new Set([
    ...(record ? readStringArray(record.receiverThreadIds ?? record.receiver_thread_ids) : []),
    ...(transcriptPreview?.threadId ? [transcriptPreview.threadId] : []),
  ])]
  const latestMessage = lastAssistantText(transcriptPreview?.messages)
    ?? transcriptPreview?.summary
    ?? childThreads.find((thread) => thread.latestMessage)?.latestMessage
    ?? readString(record?.message)
    ?? readString(inputRecord?.prompt)
  const resultText = readString(record?.result ?? record?.output ?? record?.content)
  const errorText = isError ? latestMessage ?? resultText ?? readString(record?.error) : undefined

  return {
    status: isError ? "error" : normalizeSubagentStatus(providerStatus) ?? (record ? "success" : undefined),
    providerStatus,
    summary: latestMessage ?? resultText,
    latestMessage,
    resultText,
    errorText,
    childThreadId: childThreadIds.length === 1 ? childThreadIds[0] : undefined,
    childThreadIds: childThreadIds.length > 0 ? childThreadIds : undefined,
    childSessionId: readString(record?.childSessionId ?? record?.child_session_id),
    childTitle: transcriptPreview?.title ?? readString(record?.childTitle ?? record?.child_title),
    messageCount: transcriptPreview?.messageCount,
    childThreads: childThreads.length > 0 ? childThreads : undefined,
    childTranscript: transcriptPreview,
  }
}

export function processTranscriptMessages(entries: TranscriptEntry[]): HydratedTranscriptMessage[] {
  const pendingToolCalls = new Map<string, { hydrated: HydratedToolCall; normalized: NormalizedToolCall }>()
  const messages: HydratedTranscriptMessage[] = []

  for (const entry of entries) {
    switch (entry.kind) {
      case "user_prompt":
        messages.push({
          ...createBaseMessage(entry),
          kind: "user_prompt",
          content: entry.content,
        })
        break
      case "system_init":
        messages.push({
          ...createBaseMessage(entry),
          kind: "system_init",
          provider: entry.provider,
          model: entry.model,
          tools: entry.tools,
          agents: entry.agents,
          slashCommands: entry.slashCommands,
          mcpServers: entry.mcpServers,
          debugRaw: entry.debugRaw,
        })
        break
      case "account_info":
        messages.push({
          ...createBaseMessage(entry),
          kind: "account_info",
          accountInfo: entry.accountInfo,
        })
        break
      case "assistant_text":
        messages.push({
          ...createBaseMessage(entry),
          kind: "assistant_text",
          text: entry.text,
        })
        break
      case "tool_call": {
        const toolCall = hydrateToolCall(entry)
        pendingToolCalls.set(entry.tool.toolId, { hydrated: toolCall, normalized: entry.tool })
        messages.push(toolCall)
        break
      }
      case "tool_result": {
        const pendingCall = pendingToolCalls.get(entry.toolId)
        if (pendingCall) {
          const rawResult = (
            pendingCall.normalized.toolKind === "ask_user_question" ||
            pendingCall.normalized.toolKind === "exit_plan_mode"
          )
            ? getStructuredToolResultFromDebug(entry) ?? entry.content
            : entry.content

          pendingCall.hydrated.result = (
            pendingCall.normalized.toolKind === "subagent_task"
              ? hydrateSubagentResult(rawResult, pendingCall.hydrated.rawInput, entry.isError)
              : hydrateToolResult(pendingCall.normalized, rawResult)
          ) as never
          pendingCall.hydrated.rawResult = rawResult
          pendingCall.hydrated.isError = entry.isError
          pendingCall.hydrated.resultDebugRaw = entry.debugRaw
        }
        break
      }
      case "result":
        messages.push({
          ...createBaseMessage(entry),
          kind: "result",
          success: !entry.isError,
          cancelled: entry.subtype === "cancelled",
          result: entry.result,
          durationMs: entry.durationMs,
          costUsd: entry.costUsd,
        })
        break
      case "status":
        messages.push({
          ...createBaseMessage(entry),
          kind: "status",
          status: entry.status,
        })
        break
      case "compact_boundary":
        messages.push({
          ...createBaseMessage(entry),
          kind: "compact_boundary",
        })
        break
      case "compact_summary":
        messages.push({
          ...createBaseMessage(entry),
          kind: "compact_summary",
          summary: entry.summary,
        })
        break
      case "context_cleared":
        messages.push({
          ...createBaseMessage(entry),
          kind: "context_cleared",
        })
        break
      case "interrupted":
        messages.push({
          ...createBaseMessage(entry),
          kind: "interrupted",
        })
        break
      default:
        messages.push({
          ...createBaseMessage(entry),
          kind: "unknown",
          json: JSON.stringify(entry, null, 2),
        })
        break
    }
  }

  return messages
}
