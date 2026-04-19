import { useState } from "react"
import type { ProcessedResultMessage } from "./types"
import { MetaRow, MetaLabel } from "./shared"

interface Props {
  message: ProcessedResultMessage
  onRetry?: (message: ProcessedResultMessage) => Promise<void> | void
}

export function ResultMessage({ message, onRetry }: Props) {
  const [isRetrying, setIsRetrying] = useState(false)

  const formatDuration = (ms: number) => {
    if (ms < 1000) {
      return `${ms}ms`
    }

    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`
    }

    if (minutes > 0) {
      return `${minutes}m${seconds > 0 ? ` ${seconds}s` : ""}`
    }

    return `${seconds}s`
  }

  if (!message.success) {
    const canRetry = Boolean(message.retryAction && onRetry)
    return (
      <div className="relative px-4 py-3 pr-24 mx-2 my-1 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
        {canRetry ? (
          <button
            type="button"
            disabled={isRetrying}
            onClick={async () => {
              if (!onRetry || isRetrying) return
              setIsRetrying(true)
              try {
                await onRetry(message)
              } finally {
                setIsRetrying(false)
              }
            }}
            className="absolute right-3 top-3 rounded-md border border-destructive/30 bg-background/90 px-3 py-1 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-background disabled:cursor-default disabled:opacity-60"
          >
            {isRetrying ? "Retrying..." : (message.retryAction?.label ?? "Retry")}
          </button>
        ) : null}
        <div>{message.result || "An unknown error occurred."}</div>
        {message.autoRecovery ? (
          <div className="mt-3 text-xs leading-5 text-foreground/80">
            {message.autoRecovery.notice}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <MetaRow className={`px-0.5 text-xs tracking-wide ${message.durationMs > 60000 ? '' : 'hidden'}`}>
      <div className="w-full h-[1px] bg-border"></div>
      <MetaLabel className="whitespace-nowrap text-[11px] tracking-widest text-muted-foreground/60 uppercase flex-shrink-0">Worked for {formatDuration(message.durationMs)}</MetaLabel>
      <div className="w-full h-[1px] bg-border"></div>
    </MetaRow>
  )
}
