import React, { useEffect, useMemo, useState } from "react"
import type { AskUserQuestionItem, ProcessedToolCall } from "./types"
import type { AskUserQuestionAnswerMap, HydratedTranscriptMessage, ProjectSkillSummary } from "../../../shared/types"
import { getLatestToolIds } from "../../app/derived"
import { UserMessage } from "./UserMessage"
import { RawJsonMessage } from "./RawJsonMessage"
import { SystemMessage } from "./SystemMessage"
import { AccountInfoMessage } from "./AccountInfoMessage"
import { TextMessage } from "./TextMessage"
import { AskUserQuestionMessage } from "./AskUserQuestionMessage"
import { ExitPlanModeMessage } from "./ExitPlanModeMessage"
import { TodoWriteMessage } from "./TodoWriteMessage"
import { ToolCallMessage } from "./ToolCallMessage"
import { ResultMessage } from "./ResultMessage"
import { InterruptedMessage } from "./InterruptedMessage"
import { CompactBoundaryMessage, ContextClearedMessage } from "./CompactBoundaryMessage"
import { CompactSummaryMessage } from "./CompactSummaryMessage"
import { StatusMessage } from "./StatusMessage"
import { CollapsedToolGroup } from "./CollapsedToolGroup"

const SPECIAL_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode", "TodoWrite"])

type RenderItem =
  | { type: "single"; message: HydratedTranscriptMessage; index: number }
  | { type: "tool-group"; messages: HydratedTranscriptMessage[]; startIndex: number }

function isCollapsibleToolCall(message: HydratedTranscriptMessage) {
  if (message.kind !== "tool") return false
  if (message.toolKind === "subagent_task") return false
  const toolName = (message as ProcessedToolCall).toolName
  return !SPECIAL_TOOL_NAMES.has(toolName)
}

function groupMessages(messages: HydratedTranscriptMessage[]): RenderItem[] {
  const result: RenderItem[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]
    if (isCollapsibleToolCall(message)) {
      const group: HydratedTranscriptMessage[] = [message]
      const startIndex = index
      index += 1
      while (index < messages.length && isCollapsibleToolCall(messages[index])) {
        group.push(messages[index])
        index += 1
      }
      if (group.length >= 2) {
        result.push({ type: "tool-group", messages: group, startIndex })
      } else {
        result.push({ type: "single", message, index: startIndex })
      }
      continue
    }

    result.push({ type: "single", message, index })
    index += 1
  }

  return result
}

interface TranscriptMessageListProps {
  messages: HydratedTranscriptMessage[]
  isLoading: boolean
  localPath?: string
  projectId?: string
  skills?: ProjectSkillSummary[]
  latestToolIds?: Record<string, string | null>
  onAskUserQuestionSubmit?: (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap
  ) => void
  onExitPlanModeConfirm?: (toolUseId: string, confirmed: boolean, clearContext?: boolean, message?: string) => void
  onOpenProjectFile?: (filePath: string) => void
  readOnly?: boolean
  domIdPrefix?: string
  selectionZoneAttribute?: string
}

const EMPTY_LATEST_TOOL_IDS = {
  AskUserQuestion: null,
  ExitPlanMode: null,
  TodoWrite: null,
} as const

const INITIAL_RENDER_ITEM_LIMIT = 160
const RENDER_ITEM_PAGE_SIZE = 120

export function TranscriptMessageList({
  messages,
  isLoading,
  localPath,
  projectId,
  skills = [],
  latestToolIds,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
  onOpenProjectFile,
  readOnly = false,
  domIdPrefix = "msg",
  selectionZoneAttribute,
}: TranscriptMessageListProps) {
  const renderItems = useMemo(() => groupMessages(messages), [messages])
  const [visibleStartIndex, setVisibleStartIndex] = useState(() => Math.max(0, renderItems.length - INITIAL_RENDER_ITEM_LIMIT))
  const resolvedLatestToolIds = useMemo(
    () => latestToolIds ?? (readOnly ? EMPTY_LATEST_TOOL_IDS : getLatestToolIds(messages)),
    [latestToolIds, messages, readOnly]
  )

  useEffect(() => {
    setVisibleStartIndex(Math.max(0, renderItems.length - INITIAL_RENDER_ITEM_LIMIT))
  }, [renderItems.length])

  const hiddenItemCount = visibleStartIndex
  const visibleItems = useMemo(
    () => renderItems.slice(visibleStartIndex),
    [renderItems, visibleStartIndex]
  )

  function renderMessage(message: HydratedTranscriptMessage, index: number): React.ReactNode {
    if (message.kind === "user_prompt") {
      return <UserMessage key={message.id} content={message.content} attachments={message.attachments} skills={skills} />
    }

    switch (message.kind) {
      case "unknown":
        return <RawJsonMessage key={message.id} json={message.json} />
      case "system_init": {
        const isFirst = messages.findIndex((entry) => entry.kind === "system_init") === index
        return isFirst ? <SystemMessage key={message.id} message={message} rawJson={message.debugRaw} /> : null
      }
      case "account_info": {
        const isFirst = messages.findIndex((entry) => entry.kind === "account_info") === index
        return isFirst ? <AccountInfoMessage key={message.id} message={message} /> : null
      }
      case "assistant_text":
        return <TextMessage key={message.id} message={message} skills={skills} />
      case "tool":
        if (message.toolKind === "ask_user_question" && !readOnly) {
          return (
            <AskUserQuestionMessage
              key={message.id}
              message={message}
              onSubmit={onAskUserQuestionSubmit ?? (() => { })}
              isLatest={message.id === resolvedLatestToolIds.AskUserQuestion}
            />
          )
        }
        if (message.toolKind === "exit_plan_mode" && !readOnly) {
          return (
            <ExitPlanModeMessage
              key={message.id}
              message={message}
              onConfirm={onExitPlanModeConfirm ?? (() => { })}
              isLatest={message.id === resolvedLatestToolIds.ExitPlanMode}
            />
          )
        }
        if (message.toolKind === "todo_write") {
          if (!readOnly && message.id !== resolvedLatestToolIds.TodoWrite) return null
          return <TodoWriteMessage key={message.id} message={message} isActive={isLoading} />
        }
        return (
          <ToolCallMessage
            key={message.id}
            message={message}
            isLoading={isLoading}
            localPath={localPath}
            projectId={projectId}
            onOpenProjectFile={onOpenProjectFile}
          />
        )
      case "result": {
        const nextMessage = messages[index + 1]
        const previousMessage = messages[index - 1]
        if (nextMessage?.kind === "context_cleared" || previousMessage?.kind === "context_cleared") {
          return null
        }
        return <ResultMessage key={message.id} message={message} />
      }
      case "interrupted":
        return <InterruptedMessage key={message.id} message={message} />
      case "compact_boundary":
        return <CompactBoundaryMessage key={message.id} />
      case "context_cleared":
        return <ContextClearedMessage key={message.id} />
      case "compact_summary":
        return <CompactSummaryMessage key={message.id} message={message} />
      case "status":
        return index === messages.length - 1 ? <StatusMessage key={message.id} message={message} /> : null
    }
  }

  return (
    <>
      {hiddenItemCount > 0 ? (
        <div className="pb-4">
          <button
            type="button"
            onClick={() => setVisibleStartIndex((current) => Math.max(0, current - RENDER_ITEM_PAGE_SIZE))}
            className="w-full rounded-xl border border-border/70 bg-muted/25 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            {`Show ${Math.min(RENDER_ITEM_PAGE_SIZE, hiddenItemCount)} earlier messages (${hiddenItemCount} hidden)`}
          </button>
        </div>
      ) : null}
      {visibleItems.map((item) => {
        const selectionProps = selectionZoneAttribute ? { [selectionZoneAttribute]: "" } : {}

        if (item.type === "tool-group") {
          return (
            <div
              key={`${domIdPrefix}-group-${item.startIndex}`}
              className="group relative"
              {...selectionProps}
            >
              <CollapsedToolGroup
                messages={item.messages}
                isLoading={isLoading}
                localPath={localPath}
                projectId={projectId}
                onOpenProjectFile={onOpenProjectFile}
              />
            </div>
          )
        }

        const rendered = renderMessage(item.message, item.index)
        if (!rendered) return null
        return (
          <div
            key={item.message.id}
            id={`${domIdPrefix}-${item.message.id}`}
            className="group relative"
            {...selectionProps}
          >
            {rendered}
          </div>
        )
      })}
    </>
  )
}
