import { useMemo, useState, type ReactNode } from "react"
import { Bot, CheckCircle2, CircleAlert, Clock3, MessageSquareText, UserRound } from "lucide-react"
import type { HydratedSubagentTaskStatus } from "../../../shared/types"
import type { ProcessedToolCall } from "./types"
import { cn } from "../../lib/utils"
import { AnimatedShinyText } from "../ui/animated-shiny-text"
import { ExpandableRow, MetaCodeBlock, MetaLabel, MetaRow, MetaText, VerticalLineContainer } from "./shared"
import { TranscriptMessageList } from "./TranscriptMessageList"
import { getSubagentSummary, getSubagentTitle, inferSubagentStatus } from "../../lib/subagentTasks"

interface Props {
  message: Extract<ProcessedToolCall, { toolKind: "subagent_task" }>
  isLoading?: boolean
  localPath?: string | null
  defaultExpanded?: boolean
}

const CHILD_THREAD_PREVIEW_LIMIT = 8

function formatJson(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

function statusLabel(status: HydratedSubagentTaskStatus): string {
  switch (status) {
    case "success":
      return "Success"
    case "error":
      return "Error"
    case "running":
      return "Running"
    case "waiting":
      return "Waiting"
  }
}

function statusClasses(status: HydratedSubagentTaskStatus): string {
  switch (status) {
    case "success":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    case "error":
      return "border-destructive/20 bg-destructive/10 text-destructive"
    case "running":
      return "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"
    case "waiting":
      return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  }
}

function StatusIcon({ status }: { status: HydratedSubagentTaskStatus }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-3.5 w-3.5" />
    case "error":
      return <CircleAlert className="h-3.5 w-3.5" />
    case "running":
      return <Clock3 className="h-3.5 w-3.5" />
    case "waiting":
      return <Clock3 className="h-3.5 w-3.5" />
  }
}

function MetaBadge({ status, children }: { status?: HydratedSubagentTaskStatus; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        status ? statusClasses(status) : "border-border bg-muted text-muted-foreground"
      )}
    >
      {status ? <StatusIcon status={status} /> : null}
      <span>{children}</span>
    </span>
  )
}

function OverviewRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 min-w-0">
      <MetaLabel className="text-xs uppercase tracking-[0.14em] text-muted-foreground/80">{title}</MetaLabel>
      {children}
    </section>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/80 bg-muted/25 px-3 py-3 text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function buildSubtitleParts(result: Props["message"]["result"]) {
  const parts: string[] = []

  if (result?.providerStatus) {
    parts.push(`provider: ${result.providerStatus}`)
  }
  if (typeof result?.messageCount === "number") {
    parts.push(`${result.messageCount} messages`)
  }
  if (result?.childThreadIds?.length) {
    parts.push(`${result.childThreadIds.length} ${result.childThreadIds.length === 1 ? "thread" : "threads"}`)
  }

  return parts
}

export function SubagentMessage({ message, isLoading = false, localPath, defaultExpanded = false }: Props) {
  const result = message.result
  const status = inferSubagentStatus(message, isLoading)
  const title = getSubagentTitle(message)
  const summary = getSubagentSummary(message)
  const subtitleParts = useMemo(() => buildSubtitleParts(result), [result])
  const inputText = useMemo(() => formatJson(message.rawInput ?? message.input), [message.input, message.rawInput])
  const resultText = useMemo(() => {
    if (message.isError) {
      return result?.errorText ?? formatJson(message.rawResult ?? result ?? "Subagent task failed")
    }
    return result?.resultText ?? formatJson(message.rawResult ?? result ?? "No result available")
  }, [message.isError, message.rawResult, result])
  const childMessages = result?.childTranscript?.messages ?? []
  const [showFullThread, setShowFullThread] = useState(false)
  const hasLongThread = childMessages.length > CHILD_THREAD_PREVIEW_LIMIT
  const visibleChildMessages = showFullThread ? childMessages : childMessages.slice(0, CHILD_THREAD_PREVIEW_LIMIT)
  const noChildTranscriptText = result?.childThreadIds?.length
    ? `No child transcript available for ${result.childThreadIds.join(", ")}`
    : "No child transcript available"

  return (
    <MetaRow className="w-full">
      <ExpandableRow
        defaultExpanded={defaultExpanded}
        expandedContent={
          <VerticalLineContainer className="my-3 text-sm">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="rounded-xl border border-border/70 bg-muted/25 px-3 py-3">
                <div className="text-sm text-foreground/90">{summary}</div>
              </div>

              <Section title="Overview">
                <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2 pb-3">
                    <MetaBadge status={status}>{statusLabel(status)}</MetaBadge>
                    <MetaBadge>{message.input.subagentType || message.toolName}</MetaBadge>
                    {typeof result?.messageCount === "number" ? <MetaBadge>{`${result.messageCount} messages`}</MetaBadge> : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    <OverviewRow label="Subagent" value={title} />
                    <OverviewRow label="Tool" value={message.toolName} />
                    <OverviewRow label="Thread" value={result?.childThreadId ?? result?.childThreadIds?.join(", ")} />
                    <OverviewRow label="Session" value={result?.childSessionId} />
                    <OverviewRow label="Provider" value={result?.providerStatus} />
                    <OverviewRow label="Summary" value={result?.summary ?? result?.latestMessage} />
                  </div>
                </div>
              </Section>

              <Section title="Input">
                <MetaCodeBlock label="Arguments" copyText={inputText}>
                  {inputText}
                </MetaCodeBlock>
              </Section>

              <Section title="Result / Error">
                <div className="flex flex-col gap-3">
                  <MetaCodeBlock label={message.isError ? "Error" : "Result"} copyText={resultText}>
                    {resultText}
                  </MetaCodeBlock>
                  {message.rawResult && typeof message.rawResult !== "string" ? (
                    <MetaCodeBlock label="Provider Payload" copyText={formatJson(message.rawResult)}>
                      {formatJson(message.rawResult)}
                    </MetaCodeBlock>
                  ) : null}
                  {message.resultDebugRaw ? (
                    <MetaCodeBlock label="Debug Raw" copyText={message.resultDebugRaw}>
                      {message.resultDebugRaw}
                    </MetaCodeBlock>
                  ) : null}
                </div>
              </Section>

              <Section title="Child Thread">
                {childMessages.length > 0 ? (
                  <div className="min-w-0 rounded-2xl border border-border/70 bg-background/80 p-3">
                    <div className="flex flex-wrap items-center gap-2 pb-3">
                      <MetaBadge status={result?.childTranscript?.status}>{result?.childTranscript?.title || result?.childThreadId || "Child thread"}</MetaBadge>
                      <MetaText>{`${childMessages.length} messages`}</MetaText>
                      {result?.childTranscript?.hasMore ? <MetaText>preview</MetaText> : null}
                    </div>
                    <div className="max-h-[28rem] overflow-auto pr-1">
                      <TranscriptMessageList
                        messages={visibleChildMessages}
                        isLoading={false}
                        localPath={localPath ?? undefined}
                        readOnly
                        domIdPrefix={`subagent-${message.id}`}
                      />
                    </div>
                    {hasLongThread ? (
                      <button
                        onClick={() => setShowFullThread((current) => !current)}
                        className="mt-3 text-xs font-medium text-muted-foreground transition-opacity hover:opacity-70"
                      >
                        {showFullThread ? "Show less" : `Show all ${childMessages.length} messages`}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState text={noChildTranscriptText} />
                )}
              </Section>
            </div>
          </VerticalLineContainer>
        }
      >
        <div className="flex w-full min-w-0 items-start gap-3 rounded-2xl border border-border/70 bg-muted/[0.22] px-3 py-2.5 text-left">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/80">
            <UserRound className="size-4 text-muted-icon" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-start gap-2">
              <MetaLabel className="min-w-0 text-left text-sm leading-5 whitespace-normal break-words">
                <AnimatedShinyText animate={status === "running"} shimmerWidth={Math.max(24, title.length * 4)}>
                  {title}
                </AnimatedShinyText>
              </MetaLabel>
              <MetaBadge status={status}>{statusLabel(status)}</MetaBadge>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {subtitleParts.length > 0 ? subtitleParts.map((part) => (
                <span key={part} className="whitespace-nowrap">{part}</span>
              )) : <span className="whitespace-nowrap">nested agent task</span>}
            </div>
            <div className="mt-2 flex min-w-0 items-start gap-2 text-sm text-foreground/80">
              <Bot className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words text-left">{summary}</span>
            </div>
          </div>
          <div className="mt-0.5 shrink-0 text-muted-foreground">
            <MessageSquareText className="size-4" />
          </div>
        </div>
      </ExpandableRow>
    </MetaRow>
  )
}
