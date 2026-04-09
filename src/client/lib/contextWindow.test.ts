import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../../shared/types"
import { deriveLatestContextWindowSnapshot, formatContextWindowTokens, overrideContextWindowMaxTokens } from "./contextWindow"

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
