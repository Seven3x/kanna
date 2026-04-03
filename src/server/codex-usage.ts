import type { AccountInfo, CodexUsageSnapshot, TranscriptEntry } from "../shared/types"
import type { StoreState } from "./events"

export function deriveCodexUsageSnapshot(
  state: StoreState,
  getMessages: (chatId: string) => TranscriptEntry[]
): CodexUsageSnapshot {
  let latestAccountInfo: AccountInfo | null = null
  let latestAccountInfoAt = -1
  let chatCount = 0
  let importedChatCount = 0
  let turnCount = 0
  let meteredTurnCount = 0
  let totalCostUsd = 0
  let lastActiveAt: number | null = null

  for (const chat of state.chatsById.values()) {
    if (chat.deletedAt || chat.provider !== "codex") continue

    chatCount += 1
    if (chat.external?.provider === "codex") {
      importedChatCount += 1
    }

    const chatLastActiveAt = chat.lastMessageAt ?? chat.updatedAt
    lastActiveAt = lastActiveAt === null ? chatLastActiveAt : Math.max(lastActiveAt, chatLastActiveAt)

    for (const entry of getMessages(chat.id)) {
      if (entry.kind === "account_info" && entry.createdAt > latestAccountInfoAt) {
        latestAccountInfo = entry.accountInfo
        latestAccountInfoAt = entry.createdAt
      }

      if (entry.kind !== "result") continue

      turnCount += 1
      if (typeof entry.costUsd === "number") {
        meteredTurnCount += 1
        totalCostUsd += entry.costUsd
      }
    }
  }

  return {
    accountInfo: latestAccountInfo,
    chatCount,
    importedChatCount,
    turnCount,
    meteredTurnCount,
    totalCostUsd,
    lastActiveAt,
  }
}
