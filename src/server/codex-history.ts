import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { McpServerInfo, TranscriptEntry } from "../shared/types"
import { EventStore } from "./event-store"
import type { ExternalChatRecord } from "./events"
import { resolveLocalPath } from "./paths"

interface CodexSessionIndexRecord {
  threadName: string | null
  updatedAt: number | null
}

interface ParsedCodexSession {
  externalSessionId: string
  cwd: string
  title: string
  sourceFile: string
  sourceUpdatedAt: number
  entries: TranscriptEntry[]
}

export interface CodexHistoryImportResult {
  scannedSessionCount: number
  importedChatCount: number
  appendedEntryCount: number
  latestChatId: string | null
  warnings: string[]
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function toComparablePathKey(localPath: string) {
  const normalized = path.normalize(localPath).replace(/\\/g, "/")
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

function normalizeExistingDirectory(localPath: string) {
  try {
    const resolved = resolveLocalPath(localPath)
    const realPath = existsSync(resolved) ? realpathSync.native(resolved) : resolved
    if (!statSync(realPath).isDirectory()) {
      return null
    }
    return realPath
  } catch {
    return null
  }
}

function collectCodexSessionFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectCodexSessionFiles(fullPath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath)
    }
  }

  return files
}

function readCodexSessionIndex(indexPath: string) {
  const entries = new Map<string, CodexSessionIndexRecord>()
  if (!existsSync(indexPath)) {
    return entries
  }

  for (const line of readFileSync(indexPath, "utf8").split("\n")) {
    if (!line.trim()) continue
    const record = parseJsonRecord(line)
    if (!record) continue

    const id = typeof record.id === "string" ? record.id : null
    if (!id) continue

    const updatedAt = typeof record.updated_at === "string" ? Date.parse(record.updated_at) : Number.NaN
    const threadName = typeof record.thread_name === "string" ? record.thread_name.trim() : null

    entries.set(id, {
      threadName: threadName || null,
      updatedAt: Number.isNaN(updatedAt) ? null : updatedAt,
    })
  }

  return entries
}

function toTimestamp(value: unknown, fallback: number) {
  if (typeof value !== "string") return fallback
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

function makeImportedEntryId(sessionId: string, lineIndex: number, entryIndex: number, kind: string) {
  return createHash("sha1").update(`${sessionId}:${lineIndex}:${entryIndex}:${kind}`).digest("hex")
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asMcpServers(value: unknown): McpServerInfo[] {
  if (!Array.isArray(value)) return []
  const servers: McpServerInfo[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    if (!record || typeof record.name !== "string" || typeof record.status !== "string") {
      continue
    }
    servers.push({
      name: record.name,
      status: record.status,
      error: typeof record.error === "string" ? record.error : undefined,
    })
  }
  return servers
}

function createEntry<TEntry extends Omit<TranscriptEntry, "_id" | "createdAt">>(
  sessionId: string,
  lineIndex: number,
  entryIndex: number,
  createdAt: number,
  entry: TEntry
): TEntry & Pick<TranscriptEntry, "_id" | "createdAt"> {
  return {
    _id: makeImportedEntryId(sessionId, lineIndex, entryIndex, entry.kind),
    createdAt,
    ...entry,
  }
}

function createSystemInitEntry(
  sessionId: string,
  lineIndex: number,
  createdAt: number,
  model: string,
  payload: Record<string, unknown>
): TranscriptEntry {
  return createEntry(sessionId, lineIndex, 0, createdAt, {
    kind: "system_init",
    provider: "codex",
    model,
    tools: Array.isArray(payload.tools) ? payload.tools.map((entry) => String(entry)) : [],
    agents: Array.isArray(payload.agents) ? payload.agents.map((entry) => String(entry)) : [],
    slashCommands: Array.isArray(payload.slashCommands) ? payload.slashCommands.map((entry) => String(entry)) : [],
    mcpServers: asMcpServers(payload.mcpServers),
  })
}

function assistantEntriesFromMessage(
  sessionId: string,
  lineIndex: number,
  createdAt: number,
  payload: Record<string, unknown>
): TranscriptEntry[] {
  const content = Array.isArray(payload.content) ? payload.content : []
  const entries: TranscriptEntry[] = []

  for (const item of content) {
    const record = asRecord(item)
    if (!record) continue

    if (record.type === "output_text" && typeof record.text === "string" && record.text.trim()) {
      entries.push(createEntry(sessionId, lineIndex, entries.length, createdAt, {
        kind: "assistant_text",
        text: record.text,
      }))
      continue
    }

    if (typeof record.text === "string" && record.text.trim()) {
      entries.push(createEntry(sessionId, lineIndex, entries.length, createdAt, {
        kind: "assistant_text",
        text: record.text,
      }))
    }
  }

  return entries
}

function parseFunctionArguments(value: unknown) {
  if (typeof value !== "string") {
    return asRecord(value) ?? { value }
  }

  try {
    const parsed = JSON.parse(value)
    return asRecord(parsed) ?? { value: parsed }
  } catch {
    return { raw: value }
  }
}

function responseItemEntries(
  sessionId: string,
  lineIndex: number,
  createdAt: number,
  payload: Record<string, unknown>
): TranscriptEntry[] {
  const payloadType = payload.type

  if (payloadType === "message") {
    const role = payload.role
    if (role === "assistant") {
      return assistantEntriesFromMessage(sessionId, lineIndex, createdAt, payload)
    }
    return []
  }

  if (payloadType === "function_call") {
    const toolId = typeof payload.call_id === "string" ? payload.call_id : `${sessionId}:call:${lineIndex}`
    const toolName = typeof payload.name === "string" ? payload.name : "unknown_tool"
    return [
      createEntry(sessionId, lineIndex, 0, createdAt, {
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "unknown_tool",
          toolName,
          toolId,
          input: {
            payload: parseFunctionArguments(payload.arguments),
          },
          rawInput: parseFunctionArguments(payload.arguments),
        },
      }),
    ]
  }

  if (payloadType === "function_call_output") {
    const toolId = typeof payload.call_id === "string" ? payload.call_id : `${sessionId}:call:${lineIndex}`
    const output = payload.output
    return [
      createEntry(sessionId, lineIndex, 0, createdAt, {
        kind: "tool_result",
        toolId,
        content: typeof output === "string" ? output : output ?? null,
      }),
    ]
  }

  if (payloadType === "reasoning") {
    const summary = Array.isArray(payload.summary)
      ? payload.summary
        .map((entry) => {
          const record = asRecord(entry)
          if (typeof entry === "string") return entry
          if (record && typeof record.text === "string") return record.text
          return ""
        })
        .filter(Boolean)
        .join("\n")
      : ""
    if (!summary) {
      return []
    }

    return [
      createEntry(sessionId, lineIndex, 0, createdAt, {
        kind: "compact_summary",
        summary,
      }),
    ]
  }

  // Session history contains many bookkeeping-only items; skip those unless they
  // carry user-visible content that can be mapped into the transcript.
  return []
}

function eventMessageEntries(
  sessionId: string,
  lineIndex: number,
  createdAt: number,
  payload: Record<string, unknown>
): TranscriptEntry[] {
  const payloadType = payload.type

  if (payloadType === "user_message" && typeof payload.message === "string" && payload.message.trim()) {
    return [
      createEntry(sessionId, lineIndex, 0, createdAt, {
        kind: "user_prompt",
        content: payload.message,
      }),
    ]
  }

  if (payloadType === "turn_aborted") {
    return [
      createEntry(sessionId, lineIndex, 0, createdAt, {
        kind: "interrupted",
      }),
    ]
  }

  return []
}

function firstUserPromptSummary(entries: TranscriptEntry[]) {
  const userEntry = entries.find((entry) => entry.kind === "user_prompt")
  if (!userEntry || userEntry.kind !== "user_prompt") {
    return null
  }

  const collapsed = userEntry.content.replace(/\s+/g, " ").trim()
  if (!collapsed) {
    return null
  }

  return collapsed.length <= 60 ? collapsed : `${collapsed.slice(0, 57)}...`
}

function parseCodexSessionFile(
  sessionFile: string,
  targetPathKey: string,
  indexBySessionId: Map<string, CodexSessionIndexRecord>
) {
  const warnings: string[] = []
  const fileMtime = statSync(sessionFile).mtimeMs
  const lines = readFileSync(sessionFile, "utf8").split("\n")
  const entries: TranscriptEntry[] = []
  let sessionId: string | null = null
  let cwd: string | null = null
  let sawSystemInit = false
  let latestTimestamp = fileMtime

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    if (!line.trim()) continue

    const record = parseJsonRecord(line)
    if (!record) {
      warnings.push(`Skipped invalid JSON in ${path.basename(sessionFile)} at line ${lineIndex + 1}.`)
      continue
    }

    const createdAt = toTimestamp(record.timestamp, fileMtime)
    latestTimestamp = Math.max(latestTimestamp, createdAt)

    if (record.type === "session_meta") {
      const payload = asRecord(record.payload)
      if (!payload) continue

      sessionId = typeof payload.id === "string" ? payload.id : sessionId
      cwd = typeof payload.cwd === "string" ? payload.cwd : cwd
      continue
    }

    if (!sessionId) {
      continue
    }

    if (record.type === "turn_context") {
      const payload = asRecord(record.payload) ?? record
      const model = typeof payload.model === "string" ? payload.model : null
      if (!sawSystemInit && model) {
        entries.push(createSystemInitEntry(sessionId, lineIndex, createdAt, model, payload))
        sawSystemInit = true
      }
      continue
    }

    if (record.type === "response_item") {
      const payload = asRecord(record.payload)
      if (!payload) continue
      entries.push(...responseItemEntries(sessionId, lineIndex, createdAt, payload))
      continue
    }

    if (record.type === "event_msg") {
      const payload = asRecord(record.payload)
      if (!payload) continue
      entries.push(...eventMessageEntries(sessionId, lineIndex, createdAt, payload))
    }
  }

  if (!sessionId || !cwd) {
    return { session: null, warnings }
  }

  const normalizedCwd = normalizeExistingDirectory(cwd)
  if (!normalizedCwd || toComparablePathKey(normalizedCwd) !== targetPathKey) {
    return { session: null, warnings }
  }

  const indexRecord = indexBySessionId.get(sessionId)
  const title = indexRecord?.threadName || firstUserPromptSummary(entries) || path.basename(normalizedCwd) || sessionId
  const sourceUpdatedAt = indexRecord?.updatedAt ?? latestTimestamp

  return {
    session: {
      externalSessionId: sessionId,
      cwd: normalizedCwd,
      title,
      sourceFile: sessionFile,
      sourceUpdatedAt,
      entries,
    } satisfies ParsedCodexSession,
    warnings,
  }
}

export class CodexHistoryImporter {
  readonly homeDir: string

  constructor(homeDir: string = homedir()) {
    this.homeDir = homeDir
  }

  listSessionsForProject(localPath: string) {
    const normalizedProjectPath = normalizeExistingDirectory(localPath)
    if (!normalizedProjectPath) {
      return { sessions: [] as ParsedCodexSession[], warnings: [] as string[] }
    }

    const targetPathKey = toComparablePathKey(normalizedProjectPath)
    const sessionsDir = path.join(this.homeDir, ".codex", "sessions")
    const sessionFiles = collectCodexSessionFiles(sessionsDir)
    const indexBySessionId = readCodexSessionIndex(path.join(this.homeDir, ".codex", "session_index.jsonl"))
    const sessions: ParsedCodexSession[] = []
    const warnings: string[] = []

    for (const sessionFile of sessionFiles) {
      try {
        const parsed = parseCodexSessionFile(sessionFile, targetPathKey, indexBySessionId)
        warnings.push(...parsed.warnings)
        if (parsed.session) {
          sessions.push(parsed.session)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(`Failed to import ${path.basename(sessionFile)}: ${message}`)
      }
    }

    sessions.sort((left, right) => right.sourceUpdatedAt - left.sourceUpdatedAt)
    return { sessions, warnings }
  }

  async importSessionsForProject(localPath: string, projectId: string, store: EventStore): Promise<CodexHistoryImportResult> {
    const { sessions, warnings } = this.listSessionsForProject(localPath)
    let importedChatCount = 0
    let appendedEntryCount = 0
    let latestChatId: string | null = null

    for (const session of sessions) {
      const external: ExternalChatRecord = {
        provider: "codex",
        source: "codex_local_history",
        externalSessionId: session.externalSessionId,
        importedFromPath: localPath,
        sourceFile: session.sourceFile,
        sourceUpdatedAt: session.sourceUpdatedAt,
        importedAt: Date.now(),
        title: session.title,
      }

      const result = await store.upsertImportedChatFromExternalSession({
        projectId,
        provider: "codex",
        title: session.title,
        sessionToken: session.externalSessionId,
        external,
        entries: session.entries,
      })

      if (result.created) {
        importedChatCount += 1
      }
      appendedEntryCount += result.appendedCount
      if (!latestChatId) {
        latestChatId = result.chat.id
      }
    }

    return {
      scannedSessionCount: sessions.length,
      importedChatCount,
      appendedEntryCount,
      latestChatId,
      warnings,
    }
  }
}
