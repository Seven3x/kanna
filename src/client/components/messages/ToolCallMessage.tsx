import { Download, Eye, X } from "lucide-react"
import type { ProcessedToolCall } from "./types"
import { MetaRow, MetaLabel, MetaCodeBlock, ExpandableRow, VerticalLineContainer, MetaText, getToolIcon } from "./shared"
import { useMemo, useState } from "react"
import { stripWorkspacePath } from "../../lib/pathUtils"
import { AnimatedShinyText } from "../ui/animated-shiny-text"
import { formatBashCommandTitle, toTitleCase } from "../../lib/formatters"
import { FileContentView } from "./FileContentView"
import { SubagentMessage } from "./SubagentMessage"
import { buildProjectFileRawUrl, getProjectRelativeFilePath } from "../../lib/projectFiles"
import { Button } from "../ui/button"
import { ProjectFilePreviewDialog } from "./ProjectFilePreviewDialog"

interface Props {
  message: ProcessedToolCall
  isLoading?: boolean
  localPath?: string | null
  projectId?: string | null
  onOpenProjectFile?: (filePath: string) => void
}

function readFileChangePaths(value: unknown, localPath?: string | null): string[] {
  if (!value || typeof value !== "object") return []
  const record = value as Record<string, unknown>

  if (typeof record.filePath === "string") {
    return [stripWorkspacePath(record.filePath, localPath)]
  }

  const payload = record.payload
  if (!payload || typeof payload !== "object") return []
  const payloadRecord = payload as Record<string, unknown>
  const changes = Array.isArray(payloadRecord.changes) ? payloadRecord.changes : []

  return changes
    .map((change) => {
      if (!change || typeof change !== "object") return null
      const changeRecord = change as Record<string, unknown>
      const path = typeof changeRecord.path === "string" ? stripWorkspacePath(changeRecord.path, localPath) : ""
      const kind = changeRecord.kind
      const movePath =
        kind && typeof kind === "object" && typeof (kind as { move_path?: unknown }).move_path === "string"
          ? stripWorkspacePath((kind as { move_path: string }).move_path, localPath)
          : ""
      if (path && movePath) return `${path} -> ${movePath}`
      return path || null
    })
    .filter((entry): entry is string => Boolean(entry))
}

export function ToolCallMessage({ message, isLoading = false, localPath, projectId, onOpenProjectFile }: Props) {
  if (message.toolKind === "subagent_task") {
    return <SubagentMessage message={message} isLoading={isLoading} localPath={localPath} />
  }

  const [previewOpen, setPreviewOpen] = useState(false)
  const hasResult = message.result !== undefined
  const showLoadingState = !hasResult && isLoading

  const name = useMemo(() => {
    if (message.toolKind === "skill") {
      return message.input.skill
    }
    if (message.toolKind === "glob") {
      return `Search files ${message.input.pattern === "**/*" ? "in all directories" : `matching ${message.input.pattern}`}`
    }
    if (message.toolKind === "grep") {
      const pattern = message.input.pattern
      const outputMode = message.input.outputMode
      if (outputMode === "count") {
        return `Count \`${pattern}\` occurrences`
      }
      if (outputMode === "content") {
        return `Find \`${pattern}\` in text`
      }
      return `Find \`${pattern}\` in files`
    }
    if (message.toolKind === "bash") {
      return message.input.description || (message.input.command ? formatBashCommandTitle(message.input.command) : "Bash")
    }
    if (message.toolKind === "web_search") {
      return message.input.query || "Web Search"
    }
    if (message.toolKind === "read_file") {
      return `Read ${stripWorkspacePath(message.input.filePath, localPath)}`
    }
    if (message.toolKind === "write_file") {
      return `Write ${stripWorkspacePath(message.input.filePath, localPath)}`
    }
    if (message.toolKind === "edit_file") {
      return `Edit ${stripWorkspacePath(message.input.filePath, localPath)}`
    }
    if (message.toolKind === "mcp_generic") {
      return `${toTitleCase(message.input.tool)} from ${toTitleCase(message.input.server)}`
    }
    return message.toolName
  }, [message.input, message.toolName, localPath])

  const description = useMemo(() => {
    if (message.toolKind === "skill") {
      return message.input.skill
    }
  }, [message.input, message.toolKind])

  const displayPaths = useMemo(() => {
    if (message.toolKind === "read_file" || message.toolKind === "write_file" || message.toolKind === "edit_file") {
      return [stripWorkspacePath(message.input.filePath, localPath)]
    }

    return readFileChangePaths(message.rawInput ?? message.input, localPath)
  }, [localPath, message.input, message.rawInput, message.toolKind])

  const displayPathText = useMemo(() => {
    if (displayPaths.length === 0) return ""
    if (displayPaths.length === 1) return displayPaths[0]
    return `${displayPaths[0]} +${displayPaths.length - 1} more`
  }, [displayPaths])

  const isBashTool = message.toolKind === "bash"
  const isWriteTool = message.toolKind === "write_file"
  const isEditTool = message.toolKind === "edit_file"
  const isReadTool = message.toolKind === "read_file"
  const projectFilePath = useMemo(() => {
    if (message.toolKind !== "read_file" && message.toolKind !== "write_file" && message.toolKind !== "edit_file") {
      return null
    }
    return getProjectRelativeFilePath(localPath, message.input.filePath)
  }, [localPath, message])
  const canPreviewProjectFile = Boolean(projectId && projectFilePath)

  const resultText = useMemo(() => {
    if (typeof message.result === "string") return message.result
    if (!message.result) return ""
    if (typeof message.result === "object" && message.result !== null && "content" in message.result) {
      const content = (message.result as { content?: unknown }).content
      if (typeof content === "string") return content
    }
    return JSON.stringify(message.result, null, 2)
  }, [message.result])

  const inputText = useMemo(() => {
    switch (message.toolKind) {
      case "bash":
        return message.input.command
      case "write_file":
        return message.input.content
      default:
        return JSON.stringify(message.input, null, 2)
    }
  }, [message])

  return (
    <MetaRow className="w-full">
      <ExpandableRow
        trailingContent={canPreviewProjectFile ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Preview file"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <a
              href={buildProjectFileRawUrl(projectId!, projectFilePath!, true)}
              download
              aria-label="Download file"
              className="touch-manipulation inline-flex h-5.5 w-5.5 items-center justify-center rounded-md border border-border/0 text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-accent-foreground"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          </>
        ) : null}
        expandedContent={
          <VerticalLineContainer className="my-4 text-sm">
            <div className="flex flex-col gap-2">
              {isEditTool ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">File</span>
                    <MetaText>{stripWorkspacePath(message.input.filePath, localPath)}</MetaText>
                  </div>
                  <FileContentView
                    content=""
                    isDiff
                    oldString={message.input.oldString}
                    newString={message.input.newString}
                  />
                </>
              ) : !isReadTool && !isWriteTool && (
                <MetaCodeBlock label={
                  isBashTool ? (
                    <span className="flex items-center gap-2 w-full">
                      <span>Command</span>
                      {!!message.input.timeoutMs && (
                        <span className="text-muted-foreground">timeout: {String(message.input.timeoutMs)}ms</span>
                      )}
                      {!!message.input.runInBackground && (
                        <span className="text-muted-foreground">background</span>
                      )}
                    </span>
                  ) : isWriteTool ? "Contents" : "Input"
                } copyText={inputText}>
                  {inputText}
                </MetaCodeBlock>
              )}
              {hasResult && isReadTool && !message.isError && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">File</span>
                    <MetaText>{stripWorkspacePath(message.input.filePath, localPath)}</MetaText>
                  </div>
                  <FileContentView
                    content={resultText}
                  />
                </>
              )}
              {isWriteTool && !message.isError && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">File</span>
                    <MetaText>{stripWorkspacePath(message.input.filePath, localPath)}</MetaText>
                  </div>
                  <FileContentView
                    content={message.input.content}
                  />
                </>
              )}
              {hasResult && !isReadTool && !(isWriteTool && !message.isError) && !(isEditTool && !message.isError) && (
                <MetaCodeBlock label={message.isError ? "Error" : "Result"} copyText={resultText}>
                  {resultText}
                </MetaCodeBlock>
              )}
            </div>
          </VerticalLineContainer>
        }
      >

        <div className={`w-5 h-5 relative flex items-center justify-center`}>
          {(() => {
            if (message.isError) {
              return <X className="size-4 text-destructive" />
            }
            const Icon = getToolIcon(message.toolName)

            return <Icon className="size-4 text-muted-icon" />
          })()}
        </div>
        <div className="min-w-0">
          <MetaLabel className="block text-left transition-opacity duration-200 truncate">
            <AnimatedShinyText
              animate={showLoadingState}
              shimmerWidth={Math.max(20, ((description || name)?.length ?? 33) * 3)}
            >
              {description || name}
            </AnimatedShinyText>
          </MetaLabel>
          {displayPathText ? (
            <div className="truncate text-xs text-muted-foreground">
              {displayPathText}
            </div>
          ) : null}
        </div>



      </ExpandableRow>
      {canPreviewProjectFile ? (
        <ProjectFilePreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          projectId={projectId!}
          filePath={projectFilePath!}
          onOpenInEditor={onOpenProjectFile}
        />
      ) : null}
    </MetaRow>
  )
}
