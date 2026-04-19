import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import { cn } from "../../lib/utils"
import {
  formatContextWindowTokens,
  type ContextWindowSnapshot,
  type ContextWindowUsageHistoryEntry,
} from "../../lib/contextWindow"

interface ContextWindowMeterProps {
  usage: ContextWindowSnapshot
  sessionToken?: string | null
  history?: ContextWindowUsageHistoryEntry[]
  className?: string
}

interface SessionTokenBadgeProps {
  sessionToken?: string | null
  className?: string
}

function formatHistoryTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export function ContextWindowMeter({ usage, sessionToken, history = [], className }: ContextWindowMeterProps) {
  const circumference = 2 * Math.PI * 16
  const progress = usage.usedPercentage ?? 0
  const strokeOffset = circumference * (1 - Math.max(0, Math.min(100, progress)) / 100)
  const label = usage.usedPercentage === null
    ? `${formatContextWindowTokens(usage.usedTokens)}`
    : `${Math.round(usage.usedPercentage)}%`
  const lastTurnSummary = usage.lastTurnUsedTokens !== null
    ? `Last send +${formatContextWindowTokens(usage.lastTurnUsedTokens)}`
    : "Last send unavailable"

  const tooltipText = usage.maxTokens
    ? [
        `${Math.round(usage.usedPercentage ?? 0)}% · ${formatContextWindowTokens(usage.usedTokens)}/${formatContextWindowTokens(usage.maxTokens)} context used`,
        lastTurnSummary,
        `Input ${formatContextWindowTokens(usage.lastTurnInputTokens)} · Cached ${formatContextWindowTokens(usage.lastTurnCachedInputTokens)} · Output ${formatContextWindowTokens(usage.lastTurnOutputTokens)} · Reasoning ${formatContextWindowTokens(usage.lastTurnReasoningOutputTokens)}`,
        `Session ${sessionToken ?? "none"}`,
      ].join("\n")
    : [
        `${formatContextWindowTokens(usage.usedTokens)} tokens used so far`,
        lastTurnSummary,
        `Session ${sessionToken ?? "none"}`,
      ].join("\n")

  const recentHistory = history.slice(-12).reverse()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={-1}
          aria-label={tooltipText}
          className={cn("inline-flex items-center gap-2", className)}
        >
          <div className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-background/85 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur">
            <span className="sr-only">{tooltipText}</span>
            <svg viewBox="0 0 40 40" className="absolute h-9 w-9 -rotate-90">
              <circle cx="20" cy="20" r="16" fill="none" className="stroke-border/60" strokeWidth="3" />
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                className="stroke-foreground transition-[stroke-dashoffset] duration-300"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeOffset}
              />
            </svg>
            <span className="relative z-10">{label}</span>
          </div>
          <div className="hidden max-w-[17rem] min-w-0 rounded-2xl border border-border/70 bg-background/85 px-3 py-1.5 text-left shadow-sm backdrop-blur md:block">
            <div className="break-all font-mono text-[11px] leading-4 text-muted-foreground">{sessionToken ?? "no-session"}</div>
            <div className="text-[11px] text-foreground/80">
              {usage.lastTurnUsedTokens !== null ? `+${formatContextWindowTokens(usage.lastTurnUsedTokens)}` : "no delta"}
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="max-w-[26rem] whitespace-pre-line"
      >
        <div className="space-y-3">
          <div className="whitespace-pre-line">{tooltipText}</div>
          {recentHistory.length > 0 ? (
            <div className="border-t border-border/60 pt-2">
              <div className="mb-1 text-xs font-medium text-foreground/80">Recent sends</div>
              <div className="space-y-1.5">
                {recentHistory.map((entry, index) => (
                  <div key={`${entry.updatedAt}:${index}`} className="text-xs leading-4 text-muted-foreground">
                    <div className="font-mono text-[11px] text-foreground/80">
                      {formatHistoryTimestamp(entry.updatedAt)} · +{formatContextWindowTokens(entry.turnUsedTokens)}
                    </div>
                    <div>
                      in {formatContextWindowTokens(entry.turnInputTokens)} · cached {formatContextWindowTokens(entry.turnCachedInputTokens)} · out {formatContextWindowTokens(entry.turnOutputTokens)} · reasoning {formatContextWindowTokens(entry.turnReasoningOutputTokens)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function SessionTokenBadge({ sessionToken, className }: SessionTokenBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={-1}
          aria-label={`Session ${sessionToken ?? "none"}`}
          className={cn(
            "inline-flex max-w-[17rem] min-w-0 rounded-2xl border border-border/70 bg-background/85 px-3 py-1.5 text-left shadow-sm backdrop-blur",
            className
          )}
        >
          <div className="break-all font-mono text-[11px] leading-4 text-muted-foreground">{sessionToken ?? "no-session"}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="max-w-[26rem] whitespace-pre-line"
      >
        {`Session ${sessionToken ?? "none"}`}
      </TooltipContent>
    </Tooltip>
  )
}
