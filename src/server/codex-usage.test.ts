import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../shared/types"
import { createEmptyState } from "./events"
import { deriveCodexUsageSnapshot } from "./codex-usage"

function entry(overrides: Partial<TranscriptEntry> & Pick<TranscriptEntry, "kind" | "_id" | "createdAt">): TranscriptEntry {
  return {
    messageId: undefined,
    hidden: false,
    debugRaw: undefined,
    ...overrides,
  } as TranscriptEntry
}

describe("deriveCodexUsageSnapshot", () => {
  test("aggregates codex chats, cost, and latest account info", () => {
    const state = createEmptyState()
    state.chatsById.set("chat-1", {
      id: "chat-1",
      projectId: "project-1",
      title: "Chat 1",
      createdAt: 1,
      updatedAt: 100,
      unread: false,
      lastMessageAt: 140,
      provider: "codex",
      planMode: false,
      sessionToken: null,
      lastTurnOutcome: "success",
      external: null,
    })
    state.chatsById.set("chat-2", {
      id: "chat-2",
      projectId: "project-1",
      title: "Imported chat",
      createdAt: 2,
      updatedAt: 200,
      unread: false,
      lastMessageAt: 220,
      provider: "codex",
      planMode: false,
      sessionToken: null,
      lastTurnOutcome: "success",
      external: {
        provider: "codex",
        source: "codex_local_history",
        externalSessionId: "session-1",
        importedFromPath: "/tmp/project",
        sourceFile: "/tmp/project/session.jsonl",
        sourceUpdatedAt: 150,
        importedAt: 160,
        title: "Imported chat",
      },
    })
    state.chatsById.set("chat-3", {
      id: "chat-3",
      projectId: "project-1",
      title: "Claude chat",
      createdAt: 3,
      updatedAt: 300,
      unread: false,
      provider: "claude",
      planMode: false,
      sessionToken: null,
      lastTurnOutcome: "success",
      external: null,
    })

    const messagesByChatId: Record<string, TranscriptEntry[]> = {
      "chat-1": [
        entry({
          kind: "account_info",
          _id: "acc-1",
          createdAt: 110,
          accountInfo: { email: "old@example.com", subscriptionType: "plus" },
        }),
        entry({
          kind: "result",
          _id: "result-1",
          createdAt: 120,
          subtype: "success",
          isError: false,
          durationMs: 10,
          result: "ok",
          costUsd: 0.12,
        }),
      ],
      "chat-2": [
        entry({
          kind: "account_info",
          _id: "acc-2",
          createdAt: 210,
          accountInfo: { email: "new@example.com", subscriptionType: "pro", tokenSource: "oauth" },
        }),
        entry({
          kind: "result",
          _id: "result-2",
          createdAt: 215,
          subtype: "success",
          isError: false,
          durationMs: 10,
          result: "ok",
          costUsd: 0.3,
        }),
        entry({
          kind: "result",
          _id: "result-3",
          createdAt: 216,
          subtype: "success",
          isError: false,
          durationMs: 10,
          result: "ok",
        }),
      ],
      "chat-3": [
        entry({
          kind: "result",
          _id: "result-4",
          createdAt: 310,
          subtype: "success",
          isError: false,
          durationMs: 10,
          result: "ok",
          costUsd: 9.99,
        }),
      ],
    }

    expect(deriveCodexUsageSnapshot(state, (chatId) => messagesByChatId[chatId] ?? [])).toEqual({
      accountInfo: { email: "new@example.com", subscriptionType: "pro", tokenSource: "oauth" },
      chatCount: 2,
      importedChatCount: 1,
      turnCount: 3,
      meteredTurnCount: 2,
      totalCostUsd: 0.42,
      lastActiveAt: 220,
    })
  })
})
