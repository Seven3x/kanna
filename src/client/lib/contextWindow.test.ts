import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../../shared/types"
import {
  deriveContextWindowUsageHistory,
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
  overrideContextWindowMaxTokens,
} from "./contextWindow"

function entry(partial: Omit<TranscriptEntry, "_id" | "createdAt">, createdAt = Date.now()): TranscriptEntry {
  return {
    _id: crypto.randomUUID(),
    createdAt,
    ...partial,
  } as TranscriptEntry
}

describe("deriveLatestContextWindowSnapshot", () => {
  test("returns the latest context window update with derived metrics", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      entry({
        kind: "context_window_updated",
        usage: { usedTokens: 125, maxTokens: 500, compactsAutomatically: false },
      }, 1),
      entry({
        kind: "context_window_updated",
        usage: { usedTokens: 200, maxTokens: 800, compactsAutomatically: true },
      }, 2),
    ])

    expect(snapshot).not.toBeNull()
    expect(snapshot?.usedTokens).toBe(200)
    expect(snapshot?.remainingTokens).toBe(600)
    expect(snapshot?.usedPercentage).toBe(25)
    expect(snapshot?.compactsAutomatically).toBe(true)
    expect(snapshot?.lastTurnUsedTokens).toBe(75)
  })

  test("ignores non-positive usage updates", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      entry({
        kind: "context_window_updated",
        usage: { usedTokens: 0, compactsAutomatically: false },
      }),
    ])

    expect(snapshot).toBeNull()
  })

  test("prefers explicit last-turn token fields when present", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      entry({
        kind: "context_window_updated",
        usage: {
          usedTokens: 250,
          inputTokens: 200,
          cachedInputTokens: 150,
          outputTokens: 50,
          reasoningOutputTokens: 10,
          compactsAutomatically: true,
        },
      }, 1),
      entry({
        kind: "context_window_updated",
        usage: {
          usedTokens: 400,
          inputTokens: 320,
          cachedInputTokens: 220,
          outputTokens: 80,
          reasoningOutputTokens: 20,
          lastUsedTokens: 90,
          lastInputTokens: 70,
          lastCachedInputTokens: 55,
          lastOutputTokens: 20,
          lastReasoningOutputTokens: 5,
          compactsAutomatically: true,
        },
      }, 2),
    ])

    expect(snapshot?.lastTurnUsedTokens).toBe(90)
    expect(snapshot?.lastTurnInputTokens).toBe(70)
    expect(snapshot?.lastTurnCachedInputTokens).toBe(55)
    expect(snapshot?.lastTurnOutputTokens).toBe(20)
    expect(snapshot?.lastTurnReasoningOutputTokens).toBe(5)
  })
})

describe("overrideContextWindowMaxTokens", () => {
  test("recomputes percentages against the explicit max token count", () => {
    const base = deriveLatestContextWindowSnapshot([
      entry({
        kind: "context_window_updated",
        usage: { usedTokens: 50_000, compactsAutomatically: false },
      }),
    ])

    const snapshot = overrideContextWindowMaxTokens(base, 200_000)
    expect(snapshot?.maxTokens).toBe(200_000)
    expect(snapshot?.usedPercentage).toBe(25)
    expect(snapshot?.remainingTokens).toBe(150_000)
  })
})

describe("formatContextWindowTokens", () => {
  test("formats token counts compactly", () => {
    expect(formatContextWindowTokens(12_500)).toBe("12.5k")
    expect(formatContextWindowTokens(1_200_000)).toBe("1.2M")
  })
})

describe("deriveContextWindowUsageHistory", () => {
  test("builds per-update token deltas in chronological order", () => {
    const history = deriveContextWindowUsageHistory([
      entry({
        kind: "context_window_updated",
        usage: { usedTokens: 100, inputTokens: 80, cachedInputTokens: 50, outputTokens: 20, compactsAutomatically: true },
      }, 1),
      entry({
        kind: "context_window_updated",
        usage: { usedTokens: 170, inputTokens: 120, cachedInputTokens: 70, outputTokens: 35, compactsAutomatically: true },
      }, 2),
    ])

    expect(history).toHaveLength(2)
    expect(history[0]?.turnUsedTokens).toBe(100)
    expect(history[1]?.turnUsedTokens).toBe(70)
    expect(history[1]?.turnInputTokens).toBe(40)
    expect(history[1]?.turnCachedInputTokens).toBe(20)
    expect(history[1]?.turnOutputTokens).toBe(15)
  })
})
