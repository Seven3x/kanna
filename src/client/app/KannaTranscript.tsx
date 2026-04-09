import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { AskUserQuestionItem } from "../components/messages/types"
import type { AskUserQuestionAnswerMap, HydratedTranscriptMessage, ProjectSkillSummary } from "../../shared/types"
import { getProjectRelativeFilePath } from "../lib/projectFiles"
import { UserMessage } from "../components/messages/UserMessage"
import { RawJsonMessage } from "../components/messages/RawJsonMessage"
import { SystemMessage } from "../components/messages/SystemMessage"
import { AccountInfoMessage } from "../components/messages/AccountInfoMessage"
import { TextMessage } from "../components/messages/TextMessage"
import { AskUserQuestionMessage } from "../components/messages/AskUserQuestionMessage"
import { ExitPlanModeMessage } from "../components/messages/ExitPlanModeMessage"
import { TodoWriteMessage } from "../components/messages/TodoWriteMessage"
import { ToolCallMessage } from "../components/messages/ToolCallMessage"
import { ResultMessage } from "../components/messages/ResultMessage"
import { InterruptedMessage } from "../components/messages/InterruptedMessage"
import { CompactBoundaryMessage, ContextClearedMessage } from "../components/messages/CompactBoundaryMessage"
import { CompactSummaryMessage } from "../components/messages/CompactSummaryMessage"
import { StatusMessage } from "../components/messages/StatusMessage"
import { CollapsedToolGroup } from "../components/messages/CollapsedToolGroup"
import { ProjectFilePreviewDialog } from "../components/messages/ProjectFilePreviewDialog"
import { OpenLocalLinkProvider } from "../components/messages/shared"
import { CHAT_SELECTION_ZONE_ATTRIBUTE } from "./chatFocusPolicy"

const SPECIAL_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode", "TodoWrite"])

type TranscriptRenderItem =
  | { type: "single"; message: HydratedTranscriptMessage; index: number }
  | { type: "tool-group"; messages: HydratedTranscriptMessage[]; startIndex: number }

interface ResolvedSingleTranscriptRow {
  kind: "single"
  id: string
  message: HydratedTranscriptMessage
  index: number
  isLoading: boolean
  localPath?: string
  projectId?: string
  skills: ProjectSkillSummary[]
  isFirstSystem: boolean
  isFirstAccount: boolean
  isLatestAskUserQuestion: boolean
  isLatestExitPlanMode: boolean
  isLatestTodoWrite: boolean
  hideResult: boolean
  isFinalStatus: boolean
}

interface ResolvedToolGroupTranscriptRow {
  kind: "tool-group"
  id: string
  startIndex: number
  messages: HydratedTranscriptMessage[]
  isLoading: boolean
  localPath?: string
  projectId?: string
}

type ResolvedTranscriptRow = ResolvedSingleTranscriptRow | ResolvedToolGroupTranscriptRow

const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 12
const VIRTUALIZATION_OVERSCAN_PX = 1000

function isCollapsibleToolCall(message: HydratedTranscriptMessage) {
  if (message.kind !== "tool") return false
  if (message.toolKind === "subagent_task") return false
  return !SPECIAL_TOOL_NAMES.has(message.toolName)
}

function buildTranscriptRenderItems(messages: HydratedTranscriptMessage[]): TranscriptRenderItem[] {
  const result: TranscriptRenderItem[] = []
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

function getTranscriptRenderItemId(item: TranscriptRenderItem) {
  if (item.type === "single") {
    return item.message.id
  }

  const firstId = item.messages[0]?.id ?? item.startIndex
  const lastId = item.messages[item.messages.length - 1]?.id ?? item.startIndex
  return `tool-group:${firstId}:${lastId}:${item.messages.length}`
}

function shouldRenderTranscriptSingleRow(
  message: HydratedTranscriptMessage,
  {
    isFirstSystem,
    isFirstAccount,
    isLatestTodoWrite,
    hideResult,
    isFinalStatus,
  }: {
    isFirstSystem: boolean
    isFirstAccount: boolean
    isLatestTodoWrite: boolean
    hideResult: boolean
    isFinalStatus: boolean
  }
) {
  if (message.hidden) return false

  switch (message.kind) {
    case "system_init":
      return isFirstSystem
    case "account_info":
      return isFirstAccount
    case "tool":
      return message.toolKind !== "todo_write" || isLatestTodoWrite
    case "result":
      return !hideResult
    case "status":
      return isFinalStatus
    default:
      return true
  }
}

function sameStringArray(left: string[] | undefined, right: string[] | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function sameMessage(left: HydratedTranscriptMessage, right: HydratedTranscriptMessage) {
  if (left === right) return true
  if (left.kind !== right.kind || left.id !== right.id || left.hidden !== right.hidden) return false

  switch (left.kind) {
    case "user_prompt":
      return right.kind === "user_prompt"
        && left.content === right.content
        && (left.attachments?.length ?? 0) === (right.attachments?.length ?? 0)
    case "system_init":
      return right.kind === "system_init"
        && left.provider === right.provider
        && left.model === right.model
        && sameStringArray(left.tools, right.tools)
        && sameStringArray(left.agents, right.agents)
        && sameStringArray(left.slashCommands, right.slashCommands)
        && left.debugRaw === right.debugRaw
    case "account_info":
      return right.kind === "account_info" && JSON.stringify(left.accountInfo) === JSON.stringify(right.accountInfo)
    case "assistant_text":
      return right.kind === "assistant_text" && left.text === right.text
    case "tool":
      return right.kind === "tool"
        && left.toolKind === right.toolKind
        && left.toolName === right.toolName
        && left.toolId === right.toolId
        && left.isError === right.isError
        && JSON.stringify(left.input) === JSON.stringify(right.input)
        && JSON.stringify(left.result) === JSON.stringify(right.result)
        && JSON.stringify(left.rawResult) === JSON.stringify(right.rawResult)
    case "result":
      return right.kind === "result"
        && left.success === right.success
        && left.cancelled === right.cancelled
        && left.result === right.result
        && left.durationMs === right.durationMs
        && left.costUsd === right.costUsd
    case "status":
      return right.kind === "status" && left.status === right.status
    case "context_window_updated":
      return right.kind === "context_window_updated" && JSON.stringify(left.usage) === JSON.stringify(right.usage)
    case "compact_summary":
      return right.kind === "compact_summary" && left.summary === right.summary
    case "compact_boundary":
    case "context_cleared":
    case "interrupted":
      return true
    case "unknown":
      return right.kind === "unknown" && left.json === right.json
  }
}

function buildResolvedTranscriptRows(
  messages: HydratedTranscriptMessage[],
  {
    isLoading,
    localPath,
    projectId,
    skills,
    latestToolIds,
  }: {
    isLoading: boolean
    localPath?: string
    projectId?: string
    skills: ProjectSkillSummary[]
    latestToolIds: Record<string, string | null>
  }
): ResolvedTranscriptRow[] {
  const renderItems = buildTranscriptRenderItems(messages)
  const firstSystemIndex = messages.findIndex((entry) => entry.kind === "system_init")
  const firstAccountIndex = messages.findIndex((entry) => entry.kind === "account_info")
  const rows: ResolvedTranscriptRow[] = []

  for (const item of renderItems) {
    if (item.type === "tool-group") {
      rows.push({
        kind: "tool-group",
        id: getTranscriptRenderItemId(item),
        startIndex: item.startIndex,
        messages: item.messages,
        isLoading: isLoading && item.messages.some((message) => message.kind === "tool" && message.result === undefined),
        localPath,
        projectId,
      })
      continue
    }

    const previousMessage = messages[item.index - 1]
    const nextMessage = messages[item.index + 1]
    const row: ResolvedSingleTranscriptRow = {
      kind: "single",
      id: getTranscriptRenderItemId(item),
      message: item.message,
      index: item.index,
      isLoading: item.message.kind === "tool" && item.message.result === undefined && isLoading,
      localPath,
      projectId,
      skills,
      isFirstSystem: firstSystemIndex === item.index,
      isFirstAccount: firstAccountIndex === item.index,
      isLatestAskUserQuestion: item.message.id === latestToolIds.AskUserQuestion,
      isLatestExitPlanMode: item.message.id === latestToolIds.ExitPlanMode,
      isLatestTodoWrite: item.message.id === latestToolIds.TodoWrite,
      hideResult: nextMessage?.kind === "context_cleared" || previousMessage?.kind === "context_cleared",
      isFinalStatus: item.index === messages.length - 1,
    }

    if (shouldRenderTranscriptSingleRow(row.message, row)) {
      rows.push(row)
    }
  }

  return rows
}

function isInteractiveTranscriptRow(row: ResolvedTranscriptRow) {
  return row.kind === "single"
    && row.message.kind === "tool"
    && (
      row.message.toolKind === "ask_user_question"
      || row.message.toolKind === "exit_plan_mode"
      || row.message.toolKind === "todo_write"
    )
}

function estimateTranscriptRowHeight(row: ResolvedTranscriptRow) {
  if (row.kind === "tool-group") {
    return 180
  }

  switch (row.message.kind) {
    case "user_prompt":
      return row.message.attachments?.length ? 220 : 120
    case "assistant_text":
      return 140
    case "tool":
      return row.message.toolKind === "subagent_task" ? 220 : 160
    case "result":
      return 88
    case "system_init":
    case "account_info":
      return 80
    case "status":
    case "context_window_updated":
    case "compact_boundary":
    case "context_cleared":
      return 40
    case "compact_summary":
      return 96
    case "interrupted":
    case "unknown":
      return 72
  }
}

function getPinnedTailStartIndex(rows: ResolvedTranscriptRow[], isLoading: boolean) {
  let tailStartIndex = Math.max(0, rows.length - ALWAYS_UNVIRTUALIZED_TAIL_ROWS)

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (!row) continue
    if (isInteractiveTranscriptRow(row)) {
      tailStartIndex = Math.min(tailStartIndex, index)
      continue
    }
    if (index < tailStartIndex) {
      break
    }
  }

  if (!isLoading) {
    return tailStartIndex
  }

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (!row || row.kind !== "single") continue
    if (row.message.kind === "user_prompt") {
      return Math.min(tailStartIndex, index)
    }
    if (row.message.kind === "assistant_text") {
      break
    }
  }

  return tailStartIndex
}

interface KannaTranscriptProps {
  messages: HydratedTranscriptMessage[]
  isLoading: boolean
  isHistoryLoading?: boolean
  hasOlderHistory?: boolean
  localPath?: string
  projectId?: string
  skills?: ProjectSkillSummary[]
  latestToolIds: Record<string, string | null>
  onLoadOlderHistory?: () => void | Promise<void>
  scrollContainerRef?: RefObject<HTMLDivElement | null>
  onOpenLocalLink: (target: { path: string; line?: number; column?: number }) => void
  onOpenProjectFile?: (path: string) => void
  onAskUserQuestionSubmit: (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap
  ) => void
  onExitPlanModeConfirm: (toolUseId: string, confirmed: boolean, clearContext?: boolean, message?: string) => void
}

interface KannaTranscriptRowProps {
  row: ResolvedTranscriptRow
  onOpenProjectFile?: (filePath: string) => void
  onAskUserQuestionSubmit: (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap
  ) => void
  onExitPlanModeConfirm: (toolUseId: string, confirmed: boolean, clearContext?: boolean, message?: string) => void
}

export function resolveTranscriptPreviewFile(args: {
  localPath?: string
  projectId?: string
  targetPath: string
}) {
  if (!args.localPath || !args.projectId) {
    return null
  }

  const filePath = getProjectRelativeFilePath(args.localPath, args.targetPath)
  if (!filePath) {
    return null
  }

  return {
    projectId: args.projectId,
    filePath,
  }
}

const TranscriptToolGroup = memo(function TranscriptToolGroup({
  row,
  onOpenProjectFile,
}: {
  row: ResolvedToolGroupTranscriptRow
  onOpenProjectFile?: (filePath: string) => void
}) {
  return (
    <div className="group relative" {...{ [CHAT_SELECTION_ZONE_ATTRIBUTE]: "" }}>
      <CollapsedToolGroup
        messages={row.messages}
        isLoading={row.isLoading}
        localPath={row.localPath}
        projectId={row.projectId}
        onOpenProjectFile={onOpenProjectFile}
      />
    </div>
  )
}, (prev, next) => (
  prev.row.id === next.row.id
  && prev.row.isLoading === next.row.isLoading
  && prev.row.localPath === next.row.localPath
  && prev.row.projectId === next.row.projectId
  && prev.row.messages.length === next.row.messages.length
  && prev.row.messages.every((message, index) => sameMessage(message, next.row.messages[index]!))
  && prev.onOpenProjectFile === next.onOpenProjectFile
))

const TranscriptSingleRow = memo(function TranscriptSingleRow({
  row,
  onOpenProjectFile,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
}: {
  row: ResolvedSingleTranscriptRow
  onOpenProjectFile?: (filePath: string) => void
  onAskUserQuestionSubmit: KannaTranscriptRowProps["onAskUserQuestionSubmit"]
  onExitPlanModeConfirm: KannaTranscriptRowProps["onExitPlanModeConfirm"]
}) {
  let rendered: React.ReactNode = null

  if (row.message.kind === "user_prompt") {
    rendered = <UserMessage content={row.message.content} attachments={row.message.attachments} skills={row.skills} />
  } else {
    switch (row.message.kind) {
      case "unknown":
        rendered = <RawJsonMessage json={row.message.json} />
        break
      case "system_init":
        rendered = row.isFirstSystem ? <SystemMessage message={row.message} rawJson={row.message.debugRaw} /> : null
        break
      case "account_info":
        rendered = row.isFirstAccount ? <AccountInfoMessage message={row.message} /> : null
        break
      case "assistant_text":
        rendered = <TextMessage message={row.message} skills={row.skills} />
        break
      case "tool":
        if (row.message.toolKind === "ask_user_question") {
          rendered = (
            <AskUserQuestionMessage
              message={row.message}
              onSubmit={onAskUserQuestionSubmit}
              isLatest={row.isLatestAskUserQuestion}
            />
          )
          break
        }
        if (row.message.toolKind === "exit_plan_mode") {
          rendered = (
            <ExitPlanModeMessage
              message={row.message}
              onConfirm={onExitPlanModeConfirm}
              isLatest={row.isLatestExitPlanMode}
            />
          )
          break
        }
        if (row.message.toolKind === "todo_write") {
          rendered = row.isLatestTodoWrite ? <TodoWriteMessage message={row.message} isActive={row.isLoading} /> : null
          break
        }
        rendered = (
          <ToolCallMessage
            message={row.message}
            isLoading={row.isLoading}
            localPath={row.localPath}
            projectId={row.projectId}
            onOpenProjectFile={onOpenProjectFile}
          />
        )
        break
      case "result":
        rendered = row.hideResult ? null : <ResultMessage message={row.message} />
        break
      case "interrupted":
        rendered = <InterruptedMessage message={row.message} />
        break
      case "compact_boundary":
        rendered = <CompactBoundaryMessage />
        break
      case "context_cleared":
        rendered = <ContextClearedMessage />
        break
      case "compact_summary":
        rendered = <CompactSummaryMessage message={row.message} />
        break
      case "status":
        rendered = row.isFinalStatus ? <StatusMessage message={row.message} /> : null
        break
      case "context_window_updated":
        rendered = null
        break
    }
  }

  if (!rendered) return null

  return (
    <div id={`msg-${row.message.id}`} className="group relative" {...{ [CHAT_SELECTION_ZONE_ATTRIBUTE]: "" }}>
      {rendered}
    </div>
  )
}, (prev, next) => (
  prev.row.id === next.row.id
  && prev.row.index === next.row.index
  && prev.row.isLoading === next.row.isLoading
  && prev.row.localPath === next.row.localPath
  && prev.row.projectId === next.row.projectId
  && prev.row.isFirstSystem === next.row.isFirstSystem
  && prev.row.isFirstAccount === next.row.isFirstAccount
  && prev.row.isLatestAskUserQuestion === next.row.isLatestAskUserQuestion
  && prev.row.isLatestExitPlanMode === next.row.isLatestExitPlanMode
  && prev.row.isLatestTodoWrite === next.row.isLatestTodoWrite
  && prev.row.hideResult === next.row.hideResult
  && prev.row.isFinalStatus === next.row.isFinalStatus
  && sameMessage(prev.row.message, next.row.message)
  && prev.onOpenProjectFile === next.onOpenProjectFile
  && prev.onAskUserQuestionSubmit === next.onAskUserQuestionSubmit
  && prev.onExitPlanModeConfirm === next.onExitPlanModeConfirm
))

const KannaTranscriptRow = memo(function KannaTranscriptRow({
  row,
  onOpenProjectFile,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
}: KannaTranscriptRowProps) {
  if (row.kind === "tool-group") {
    return <TranscriptToolGroup row={row} onOpenProjectFile={onOpenProjectFile} />
  }

  return (
    <TranscriptSingleRow
      row={row}
      onOpenProjectFile={onOpenProjectFile}
      onAskUserQuestionSubmit={onAskUserQuestionSubmit}
      onExitPlanModeConfirm={onExitPlanModeConfirm}
    />
  )
}, (prev, next) => {
  if (prev.onOpenProjectFile !== next.onOpenProjectFile) return false
  if (prev.onAskUserQuestionSubmit !== next.onAskUserQuestionSubmit) return false
  if (prev.onExitPlanModeConfirm !== next.onExitPlanModeConfirm) return false
  if (prev.row.kind !== next.row.kind) return false
  if (prev.row.id !== next.row.id) return false

  if (prev.row.kind === "tool-group" && next.row.kind === "tool-group") {
    const previousMessages = prev.row.messages
    const nextMessages = next.row.messages
    return prev.row.isLoading === next.row.isLoading
      && prev.row.localPath === next.row.localPath
      && prev.row.projectId === next.row.projectId
      && previousMessages.length === nextMessages.length
      && previousMessages.every((message, index) => sameMessage(message, nextMessages[index]!))
  }

  if (prev.row.kind === "single" && next.row.kind === "single") {
    return prev.row.index === next.row.index
      && prev.row.isLoading === next.row.isLoading
      && prev.row.localPath === next.row.localPath
      && prev.row.projectId === next.row.projectId
      && prev.row.isFirstSystem === next.row.isFirstSystem
      && prev.row.isFirstAccount === next.row.isFirstAccount
      && prev.row.isLatestAskUserQuestion === next.row.isLatestAskUserQuestion
      && prev.row.isLatestExitPlanMode === next.row.isLatestExitPlanMode
      && prev.row.isLatestTodoWrite === next.row.isLatestTodoWrite
      && prev.row.hideResult === next.row.hideResult
      && prev.row.isFinalStatus === next.row.isFinalStatus
      && sameMessage(prev.row.message, next.row.message)
  }

  return false
})

export const KannaTranscript = memo(function KannaTranscript({
  messages,
  isLoading,
  isHistoryLoading = false,
  hasOlderHistory = false,
  localPath,
  projectId,
  skills = [],
  latestToolIds,
  onLoadOlderHistory,
  scrollContainerRef,
  onOpenLocalLink,
  onOpenProjectFile,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
}: KannaTranscriptProps) {
  const [previewFile, setPreviewFile] = useState<{ projectId: string; filePath: string } | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [measurementVersion, setMeasurementVersion] = useState(0)
  const measuredHeightsRef = useRef(new Map<string, number>())

  const rows = useMemo(() => buildResolvedTranscriptRows(messages, {
    isLoading,
    localPath,
    projectId,
    skills,
    latestToolIds,
  }), [isLoading, latestToolIds, localPath, messages, projectId, skills])

  const pinnedTailStartIndex = useMemo(
    () => getPinnedTailStartIndex(rows, isLoading),
    [isLoading, rows]
  )
  const virtualizedHeadRows = useMemo(
    () => rows.slice(0, pinnedTailStartIndex),
    [pinnedTailStartIndex, rows]
  )
  const pinnedTailRows = useMemo(
    () => rows.slice(pinnedTailStartIndex),
    [pinnedTailStartIndex, rows]
  )

  const virtualLayout = useMemo(() => {
    const starts: number[] = new Array(virtualizedHeadRows.length)
    const sizes: number[] = new Array(virtualizedHeadRows.length)
    let cursor = 0

    for (let index = 0; index < virtualizedHeadRows.length; index += 1) {
      const row = virtualizedHeadRows[index]!
      starts[index] = cursor
      const size = measuredHeightsRef.current.get(row.id) ?? estimateTranscriptRowHeight(row)
      sizes[index] = size
      cursor += size + 20
    }

    return {
      starts,
      sizes,
      totalHeight: cursor,
    }
  }, [measurementVersion, virtualizedHeadRows])

  const visibleVirtualRange = useMemo(() => {
    const viewportStart = Math.max(0, scrollTop - VIRTUALIZATION_OVERSCAN_PX)
    const viewportEnd = scrollTop + viewportHeight + VIRTUALIZATION_OVERSCAN_PX
    let startIndex = 0
    let endIndex = virtualizedHeadRows.length

    for (let index = 0; index < virtualizedHeadRows.length; index += 1) {
      const rowStart = virtualLayout.starts[index] ?? 0
      const rowEnd = rowStart + (virtualLayout.sizes[index] ?? 0) + 20
      if (rowEnd >= viewportStart) {
        startIndex = index
        break
      }
    }

    for (let index = startIndex; index < virtualizedHeadRows.length; index += 1) {
      const rowStart = virtualLayout.starts[index] ?? 0
      if (rowStart > viewportEnd) {
        endIndex = index
        break
      }
    }

    return { startIndex, endIndex }
  }, [scrollTop, viewportHeight, virtualLayout.sizes, virtualLayout.starts, virtualizedHeadRows.length])

  useLayoutEffect(() => {
    const container = scrollContainerRef?.current
    if (!container) return

    const updateMetrics = () => {
      setScrollTop(container.scrollTop)
      setViewportHeight(container.clientHeight)
    }

    updateMetrics()
    container.addEventListener("scroll", updateMetrics, { passive: true })
    const observer = new ResizeObserver(updateMetrics)
    observer.observe(container)

    return () => {
      container.removeEventListener("scroll", updateMetrics)
      observer.disconnect()
    }
  }, [scrollContainerRef])

  useEffect(() => {
    for (const rowId of [...measuredHeightsRef.current.keys()]) {
      if (!rows.some((row) => row.id === rowId)) {
        measuredHeightsRef.current.delete(rowId)
      }
    }
  }, [rows])

  function handleOpenTranscriptLocalLink(target: { path: string; line?: number; column?: number }) {
    const previewTarget = resolveTranscriptPreviewFile({
      localPath,
      projectId,
      targetPath: target.path,
    })

    if (previewTarget) {
      setPreviewFile(previewTarget)
      return
    }

    onOpenLocalLink(target)
  }

  return (
    <>
      <OpenLocalLinkProvider onOpenLocalLink={handleOpenTranscriptLocalLink}>
        {(hasOlderHistory || isHistoryLoading) && onLoadOlderHistory ? (
          <div className="pb-4">
            <button
              type="button"
              disabled={isHistoryLoading}
              onClick={() => void onLoadOlderHistory()}
              className="w-full rounded-xl border border-border/70 bg-muted/25 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-default disabled:opacity-70"
            >
              {isHistoryLoading ? "Loading more messages..." : "Load older messages"}
            </button>
          </div>
        ) : null}
        {virtualizedHeadRows.length > 0 ? (
          <div className="relative" style={{ height: `${virtualLayout.totalHeight}px` }}>
            {virtualizedHeadRows.slice(visibleVirtualRange.startIndex, visibleVirtualRange.endIndex).map((row, offsetIndex) => {
              const actualIndex = visibleVirtualRange.startIndex + offsetIndex
              const top = virtualLayout.starts[actualIndex] ?? 0

              return (
                <MeasuredTranscriptRow
                  key={`virtual-row:${row.id}`}
                  row={row}
                  top={top}
                  onMeasure={(height) => {
                    const current = measuredHeightsRef.current.get(row.id)
                    if (current === height) return
                    measuredHeightsRef.current.set(row.id, height)
                    setMeasurementVersion((value) => value + 1)
                  }}
                  onOpenProjectFile={onOpenProjectFile}
                  onAskUserQuestionSubmit={onAskUserQuestionSubmit}
                  onExitPlanModeConfirm={onExitPlanModeConfirm}
                />
              )
            })}
          </div>
        ) : null}
        {pinnedTailRows.map((row) => (
          <div key={`tail-row:${row.id}`} className="pb-5">
            <KannaTranscriptRow
              row={row}
              onOpenProjectFile={onOpenProjectFile}
              onAskUserQuestionSubmit={onAskUserQuestionSubmit}
              onExitPlanModeConfirm={onExitPlanModeConfirm}
            />
          </div>
        ))}
      </OpenLocalLinkProvider>
      {previewFile ? (
        <ProjectFilePreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setPreviewFile(null)
            }
          }}
          projectId={previewFile.projectId}
          filePath={previewFile.filePath}
          onOpenInEditor={onOpenProjectFile}
        />
      ) : null}
    </>
  )
})

const MeasuredTranscriptRow = memo(function MeasuredTranscriptRow({
  row,
  top,
  onMeasure,
  onOpenProjectFile,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
}: {
  row: ResolvedTranscriptRow
  top: number
  onMeasure: (height: number) => void
  onOpenProjectFile?: (filePath: string) => void
  onAskUserQuestionSubmit: KannaTranscriptRowProps["onAskUserQuestionSubmit"]
  onExitPlanModeConfirm: KannaTranscriptRowProps["onExitPlanModeConfirm"]
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const element = rowRef.current
    if (!element) return

    const measure = () => {
      onMeasure(element.getBoundingClientRect().height)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [onMeasure])

  return (
    <div
      className="absolute left-0 top-0 w-full"
      style={{ transform: `translateY(${top}px)` }}
    >
      <div ref={rowRef} className="pb-5">
        <KannaTranscriptRow
          row={row}
          onOpenProjectFile={onOpenProjectFile}
          onAskUserQuestionSubmit={onAskUserQuestionSubmit}
          onExitPlanModeConfirm={onExitPlanModeConfirm}
        />
      </div>
    </div>
  )
})
