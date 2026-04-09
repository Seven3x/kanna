import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import { cn } from "../../lib/utils"
import { formatContextWindowTokens, type ContextWindowSnapshot } from "../../lib/contextWindow"

interface ContextWindowMeterProps {
  usage: ContextWindowSnapshot
  className?: string
}

export function ContextWindowMeter({ usage, className }: ContextWindowMeterProps) {
  const circumference = 2 * Math.PI * 16
  const progress = usage.usedPercentage ?? 0
  const strokeOffset = circumference * (1 - Math.max(0, Math.min(100, progress)) / 100)
  const label = usage.usedPercentage === null
    ? `${formatContextWindowTokens(usage.usedTokens)}`
    : `${Math.round(usage.usedPercentage)}%`

  const tooltipText = usage.maxTokens
    ? `${Math.round(usage.usedPercentage ?? 0)}% · ${formatContextWindowTokens(usage.usedTokens)}/${formatContextWindowTokens(usage.maxTokens)} context used`
    : `${formatContextWindowTokens(usage.usedTokens)} tokens used so far`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label={tooltipText}
          className={cn(
            "inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-background/85 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur",
            className,
          )}
        >
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
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  )
}
