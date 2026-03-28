import { useEffect, useMemo, useState } from "react"
import { Bot, ChevronRight, MessageSquareText } from "lucide-react"
import type { HydratedSubagentTaskToolCall, HydratedSubagentTaskStatus, HydratedTranscriptMessage } from "../../../shared/types"
import { cn } from "../../lib/utils"
import { getSubagentSummary, getSubagentTitle, inferSubagentStatus } from "../../lib/subagentTasks"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogGhostButton, DialogHeader, DialogTitle } from "../ui/dialog"
import { SubagentMessage } from "../messages/SubagentMessage"

interface Props {
  messages: HydratedTranscriptMessage[]
  isLoading: boolean
  localPath?: string | null
  onRevealMessage?: (messageId: string) => void
}

function isSubagentMessage(message: HydratedTranscriptMessage): message is HydratedSubagentTaskToolCall {
  return message.kind === "tool" && message.toolKind === "subagent_task"
}

function statusLabel(status: HydratedSubagentTaskStatus): string {
  switch (status) {
    case "running":
      return "Running"
    case "success":
      return "Success"
    case "error":
      return "Error"
    case "waiting":
      return "Waiting"
  }
}

function statusDotClass(status: HydratedSubagentTaskStatus) {
  switch (status) {
    case "running":
      return "bg-sky-500"
    case "success":
      return "bg-emerald-500"
    case "error":
      return "bg-destructive"
    case "waiting":
      return "bg-amber-500"
  }
}

export function SubagentDock({ messages, isLoading, localPath, onRevealMessage }: Props) {
  const subagentMessages = useMemo(
    () => messages.filter(isSubagentMessage).slice().reverse(),
    [messages]
  )
  const [open, setOpen] = useState(false)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)

  const selectedMessage = useMemo(
    () => subagentMessages.find((message) => message.id === selectedMessageId) ?? subagentMessages[0] ?? null,
    [selectedMessageId, subagentMessages]
  )

  const runningCount = useMemo(
    () => subagentMessages.filter((message) => inferSubagentStatus(message, isLoading) === "running").length,
    [isLoading, subagentMessages]
  )

  useEffect(() => {
    if (!selectedMessageId && subagentMessages[0]) {
      setSelectedMessageId(subagentMessages[0].id)
      return
    }

    if (selectedMessageId && !subagentMessages.some((message) => message.id === selectedMessageId)) {
      setSelectedMessageId(subagentMessages[0]?.id ?? null)
    }
  }, [selectedMessageId, subagentMessages])

  if (subagentMessages.length === 0) return null

  return (
    <>
      <div className="mx-auto flex w-full max-w-[800px] justify-end px-4 pb-2">
        <button
          onClick={() => {
            if (!selectedMessageId && subagentMessages[0]) {
              setSelectedMessageId(subagentMessages[0].id)
            }
            setOpen(true)
          }}
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-background/92 px-3 py-2 text-sm shadow-sm backdrop-blur transition-colors hover:bg-muted/35"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/40">
            <Bot className="size-3.5 text-muted-foreground" />
          </span>
          <span className="min-w-0 text-left">
            <span className="block font-medium text-foreground/90">Subagents</span>
            <span className="block text-xs text-muted-foreground">
              {subagentMessages.length} in this thread
              {runningCount > 0 ? `, ${runningCount} running` : ""}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg" className="max-w-[min(1100px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessageSquareText className="size-4 text-muted-foreground" />
              <span>Subagents</span>
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="px-4 pb-4 pt-3.5">
            <div className="grid min-h-0 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
              <div className="min-w-0">
                <div className="mb-2 text-xs text-muted-foreground">
                  {subagentMessages.length} available in this thread
                </div>
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-auto pr-1">
                  {subagentMessages.map((message) => {
                    const status = inferSubagentStatus(message, isLoading)
                    const title = getSubagentTitle(message)
                    const summary = getSubagentSummary(message)

                    return (
                      <button
                        key={message.id}
                        onClick={() => setSelectedMessageId(message.id)}
                        className={cn(
                          "flex w-full flex-col rounded-xl border border-border/70 bg-muted/[0.22] px-3 py-2.5 text-left transition-colors hover:bg-muted/[0.36]",
                          selectedMessage?.id === message.id && "border-foreground/15 bg-muted/[0.42]"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground/90">{title}</div>
                            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", statusDotClass(status))} />
                              <span>{statusLabel(status)}</span>
                              {typeof message.result?.messageCount === "number" ? (
                                <span>{`${message.result.messageCount} msg`}</span>
                              ) : null}
                            </div>
                          </div>
                          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        </div>
                        <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {summary}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="min-w-0">
                {selectedMessage ? (
                  <SubagentMessage
                    message={selectedMessage}
                    isLoading={isLoading}
                    localPath={localPath}
                    defaultExpanded
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-border/80 bg-muted/25 px-4 py-6 text-sm text-muted-foreground">
                    No subagent selected
                  </div>
                )}
              </div>
            </div>
          </DialogBody>
          {selectedMessage ? (
            <DialogFooter>
              <DialogGhostButton
                onClick={() => {
                  onRevealMessage?.(selectedMessage.id)
                  setOpen(false)
                }}
              >
                Reveal In Thread
              </DialogGhostButton>
              <DialogGhostButton onClick={() => setOpen(false)}>
                Close
              </DialogGhostButton>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
