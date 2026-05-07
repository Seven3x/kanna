import type { AgentProvider, ProjectSummary, QueuedChatMessage, TranscriptEntry } from "../shared/types"

export interface ProjectRecord extends ProjectSummary {
  deletedAt?: number
}

export interface ExternalChatRecord {
  provider: "codex"
  source: "codex_local_history"
  externalSessionId: string
  importedFromPath: string
  sourceFile: string
  sourceUpdatedAt: number
  importedAt: number
  title: string
}

export interface ChatRecord {
  id: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
  archivedAt?: number
  unread: boolean
  provider: AgentProvider | null
  planMode: boolean
  sessionToken: string | null
  pendingForkSessionToken?: string | null
  hasMessages?: boolean
  lastMessageAt?: number
  lastTurnOutcome: "success" | "failed" | "cancelled" | null
  external?: ExternalChatRecord | null
}

export function externalSessionKey(provider: string, externalSessionId: string) {
  return `${provider}:${externalSessionId}`
}

export function normalizeExternalChatRecord(value: ExternalChatRecord): ExternalChatRecord {
  return {
    provider: value.provider,
    source: value.source,
    externalSessionId: value.externalSessionId,
    importedFromPath: value.importedFromPath,
    sourceFile: value.sourceFile,
    sourceUpdatedAt: value.sourceUpdatedAt,
    importedAt: value.importedAt,
    title: value.title,
  }
}

export function externalRecordsEqual(left: ExternalChatRecord, right: ExternalChatRecord) {
  return left.provider === right.provider
    && left.source === right.source
    && left.externalSessionId === right.externalSessionId
    && left.sourceFile === right.sourceFile
    && left.sourceUpdatedAt === right.sourceUpdatedAt
    && left.title === right.title
}

export interface StoreState {
  projectsById: Map<string, ProjectRecord>
  projectIdsByPath: Map<string, string>
  chatsById: Map<string, ChatRecord>
  chatIdsByExternalSession: Map<string, string>
  queuedMessagesByChatId: Map<string, QueuedChatMessage[]>
}

export interface SnapshotFile {
  v: 2
  generatedAt: number
  projects: ProjectRecord[]
  chats: ChatRecord[]
  sidebarProjectOrder?: string[]
  queuedMessages?: Array<{ chatId: string; entries: QueuedChatMessage[] }>
  messages?: Array<{ chatId: string; entries: TranscriptEntry[] }>
}

export type ProjectEvent = {
  v: 2
  type: "project_opened"
  timestamp: number
  projectId: string
  localPath: string
  title: string
} | {
  v: 2
  type: "project_removed"
  timestamp: number
  projectId: string
}

export type ChatEvent =
  | {
      v: 2
      type: "chat_created"
      timestamp: number
      chatId: string
      projectId: string
      title: string
    }
  | {
      v: 2
      type: "chat_renamed"
      timestamp: number
      chatId: string
      title: string
    }
  | {
      v: 2
      type: "chat_deleted"
      timestamp: number
      chatId: string
    }
  | {
      v: 2
      type: "chat_archived"
      timestamp: number
      chatId: string
    }
  | {
      v: 2
      type: "chat_unarchived"
      timestamp: number
      chatId: string
    }
  | {
      v: 2
      type: "chat_provider_set"
      timestamp: number
      chatId: string
      provider: AgentProvider
    }
  | {
      v: 2
      type: "chat_plan_mode_set"
      timestamp: number
      chatId: string
      planMode: boolean
    }
  | {
      v: 2
      type: "chat_read_state_set"
      timestamp: number
      chatId: string
      unread: boolean
    }
  | {
      v: 2
      type: "chat_external_metadata_set"
      timestamp: number
      chatId: string
      external: ExternalChatRecord
    }

export type MessageEvent = {
  v: 2
  type: "message_appended"
  timestamp: number
  chatId: string
  entry: TranscriptEntry
}

export type QueuedMessageEvent =
  | {
      v: 2
      type: "queued_message_enqueued"
      timestamp: number
      chatId: string
      message: QueuedChatMessage
    }
  | {
      v: 2
      type: "queued_message_removed"
      timestamp: number
      chatId: string
      queuedMessageId: string
    }

export type TurnEvent =
  | {
      v: 2
      type: "turn_started"
      timestamp: number
      chatId: string
    }
  | {
      v: 2
      type: "turn_finished"
      timestamp: number
      chatId: string
    }
  | {
      v: 2
      type: "turn_failed"
      timestamp: number
      chatId: string
      error: string
    }
  | {
      v: 2
      type: "turn_cancelled"
      timestamp: number
      chatId: string
    }
  | {
      v: 2
      type: "session_token_set"
      timestamp: number
      chatId: string
      sessionToken: string | null
    }
  | {
      v: 2
      type: "pending_fork_session_token_set"
      timestamp: number
      chatId: string
      pendingForkSessionToken: string | null
    }

export type StoreEvent = ProjectEvent | ChatEvent | MessageEvent | QueuedMessageEvent | TurnEvent

export function createEmptyState(): StoreState {
  return {
    projectsById: new Map(),
    projectIdsByPath: new Map(),
    chatsById: new Map(),
    chatIdsByExternalSession: new Map(),
    queuedMessagesByChatId: new Map(),
  }
}

export function cloneTranscriptEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.map((entry) => ({ ...entry }))
}
