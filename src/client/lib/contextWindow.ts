import type { ContextWindowUsageSnapshot, TranscriptEntry } from "../../shared/types"

export interface ContextWindowSnapshot extends ContextWindowUsageSnapshot {
  remainingTokens: number | null
  usedPercentage: number | null
  remainingPercentage: number | null
  updatedAt: string
}

function withDerivedMetrics(
  usage: ContextWindowUsageSnapshot,
  updatedAt: string,
  compactsAutomatically: boolean,
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
  }
}

export function deriveLatestContextWindowSnapshot(
  entries: ReadonlyArray<TranscriptEntry>,
): ContextWindowSnapshot | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.kind !== "context_window_updated" || entry.usage.usedTokens <= 0) {
      continue
    }

    return withDerivedMetrics(
      entry.usage,
      new Date(entry.createdAt).toISOString(),
      entry.usage.compactsAutomatically,
    )
  }

  return null
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
