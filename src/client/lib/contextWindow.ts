import type { ContextWindowUsageSnapshot, TranscriptEntry } from "../../shared/types"

export interface ContextWindowSnapshot extends ContextWindowUsageSnapshot {
  remainingTokens: number | null
  usedPercentage: number | null
  remainingPercentage: number | null
  updatedAt: string
  lastTurnUsedTokens: number | null
  lastTurnInputTokens: number | null
  lastTurnCachedInputTokens: number | null
  lastTurnOutputTokens: number | null
  lastTurnReasoningOutputTokens: number | null
}

export interface ContextWindowUsageHistoryEntry {
  updatedAt: string
  usedTokens: number
  maxTokens: number | null
  turnUsedTokens: number | null
  turnInputTokens: number | null
  turnCachedInputTokens: number | null
  turnOutputTokens: number | null
  turnReasoningOutputTokens: number | null
}

function withDerivedMetrics(
  usage: ContextWindowUsageSnapshot,
  updatedAt: string,
  compactsAutomatically: boolean,
  lastTurnUsage: {
    usedTokens: number | null
    inputTokens: number | null
    cachedInputTokens: number | null
    outputTokens: number | null
    reasoningOutputTokens: number | null
  },
): ContextWindowSnapshot {
  const maxTokens = typeof usage.maxTokens === "number" && usage.maxTokens > 0 ? usage.maxTokens : null
  const remainingTokens = maxTokens === null ? null : Math.max(maxTokens - usage.usedTokens, 0)
  const usedPercentage = maxTokens === null ? null : Math.max(0, Math.min(100, (usage.usedTokens / maxTokens) * 100))
  const remainingPercentage = usedPercentage === null ? null : Math.max(0, 100 - usedPercentage)

  return {
    ...usage,
    compactsAutomatically,
    ...(maxTokens === null ? {} : { maxTokens }),
    remainingTokens,
    usedPercentage,
    remainingPercentage,
    updatedAt,
    lastTurnUsedTokens: lastTurnUsage.usedTokens,
    lastTurnInputTokens: lastTurnUsage.inputTokens,
    lastTurnCachedInputTokens: lastTurnUsage.cachedInputTokens,
    lastTurnOutputTokens: lastTurnUsage.outputTokens,
    lastTurnReasoningOutputTokens: lastTurnUsage.reasoningOutputTokens,
  }
}

function normalizeUsageValue(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

function diffUsageValue(current: number | undefined, previous: number | undefined) {
  if (typeof current !== "number" || !Number.isFinite(current)) return null
  if (typeof previous !== "number" || !Number.isFinite(previous)) return Math.max(0, current)
  return Math.max(0, current - previous)
}

export function deriveLatestContextWindowSnapshot(
  entries: ReadonlyArray<TranscriptEntry>,
): ContextWindowSnapshot | null {
  for (let latestIndex = entries.length - 1; latestIndex >= 0; latestIndex -= 1) {
    const latestEntry = entries[latestIndex]
    if (latestEntry.kind !== "context_window_updated" || latestEntry.usage.usedTokens <= 0) {
      continue
    }

    let previousUsage: ContextWindowUsageSnapshot | null = null
    for (let previousIndex = latestIndex - 1; previousIndex >= 0; previousIndex -= 1) {
      const previousEntry = entries[previousIndex]
      if (previousEntry.kind !== "context_window_updated" || previousEntry.usage.usedTokens <= 0) {
        continue
      }
      previousUsage = previousEntry.usage
      break
    }

    return withDerivedMetrics(
      latestEntry.usage,
      new Date(latestEntry.createdAt).toISOString(),
      latestEntry.usage.compactsAutomatically,
      {
        usedTokens: normalizeUsageValue(latestEntry.usage.lastUsedTokens) ?? diffUsageValue(latestEntry.usage.usedTokens, previousUsage?.usedTokens),
        inputTokens: normalizeUsageValue(latestEntry.usage.lastInputTokens) ?? diffUsageValue(latestEntry.usage.inputTokens, previousUsage?.inputTokens),
        cachedInputTokens: normalizeUsageValue(latestEntry.usage.lastCachedInputTokens) ?? diffUsageValue(latestEntry.usage.cachedInputTokens, previousUsage?.cachedInputTokens),
        outputTokens: normalizeUsageValue(latestEntry.usage.lastOutputTokens) ?? diffUsageValue(latestEntry.usage.outputTokens, previousUsage?.outputTokens),
        reasoningOutputTokens: normalizeUsageValue(latestEntry.usage.lastReasoningOutputTokens) ?? diffUsageValue(latestEntry.usage.reasoningOutputTokens, previousUsage?.reasoningOutputTokens),
      },
    )
  }

  return null
}

export function deriveContextWindowUsageHistory(
  entries: ReadonlyArray<TranscriptEntry>,
): ContextWindowUsageHistoryEntry[] {
  const history: ContextWindowUsageHistoryEntry[] = []
  let previousUsage: ContextWindowUsageSnapshot | null = null

  for (const entry of entries) {
    if (entry.kind !== "context_window_updated" || entry.usage.usedTokens <= 0) {
      continue
    }

    const usage = entry.usage
    const maxTokens = typeof usage.maxTokens === "number" && usage.maxTokens > 0 ? usage.maxTokens : null
    history.push({
      updatedAt: new Date(entry.createdAt).toISOString(),
      usedTokens: usage.usedTokens,
      maxTokens,
      turnUsedTokens: normalizeUsageValue(usage.lastUsedTokens) ?? diffUsageValue(usage.usedTokens, previousUsage?.usedTokens),
      turnInputTokens: normalizeUsageValue(usage.lastInputTokens) ?? diffUsageValue(usage.inputTokens, previousUsage?.inputTokens),
      turnCachedInputTokens: normalizeUsageValue(usage.lastCachedInputTokens) ?? diffUsageValue(usage.cachedInputTokens, previousUsage?.cachedInputTokens),
      turnOutputTokens: normalizeUsageValue(usage.lastOutputTokens) ?? diffUsageValue(usage.outputTokens, previousUsage?.outputTokens),
      turnReasoningOutputTokens: normalizeUsageValue(usage.lastReasoningOutputTokens) ?? diffUsageValue(usage.reasoningOutputTokens, previousUsage?.reasoningOutputTokens),
    })
    previousUsage = usage
  }

  return history
}

export function overrideContextWindowMaxTokens(
  snapshot: ContextWindowSnapshot | null,
  maxTokens: number | null,
): ContextWindowSnapshot | null {
  if (!snapshot || maxTokens === null || maxTokens <= 0) {
    return snapshot
  }

  return withDerivedMetrics(
    {
      ...snapshot,
      maxTokens,
    },
    snapshot.updatedAt,
    snapshot.compactsAutomatically,
    {
      usedTokens: snapshot.lastTurnUsedTokens,
      inputTokens: snapshot.lastTurnInputTokens,
      cachedInputTokens: snapshot.lastTurnCachedInputTokens,
      outputTokens: snapshot.lastTurnOutputTokens,
      reasoningOutputTokens: snapshot.lastTurnReasoningOutputTokens,
    },
  )
}

export function formatContextWindowTokens(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "?"
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`
  }

  return String(Math.round(value))
}
