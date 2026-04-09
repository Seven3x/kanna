import { useEffect, useState } from "react"
import { Download, EyeOff, FileCode2 } from "lucide-react"
import { buildProjectFileRawUrl, fetchProjectFilePreview } from "../../lib/projectFiles"
import { Button, buttonVariants } from "../ui/button"
import { ScrollArea } from "../ui/scroll-area"
import { cn } from "../../lib/utils"
import type { ProjectFilePreviewResponse } from "../../../shared/project-files"

interface ProjectFilePreviewPanelProps {
  projectId: string
  filePath: string | null
  onOpenInEditor?: (filePath: string) => void
  className?: string
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProjectFilePreviewResponse }

export function ProjectFilePreviewPanel({
  projectId,
  filePath,
  onOpenInEditor,
  className,
}: ProjectFilePreviewPanelProps) {
  const [state, setState] = useState<PreviewState>({ status: "idle" })

  useEffect(() => {
    if (!filePath) {
      setState({ status: "idle" })
      return
    }

    const controller = new AbortController()
    setState({ status: "loading" })

    void fetchProjectFilePreview(projectId, filePath, controller.signal)
      .then((data) => {
        setState({ status: "ready", data })
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setState({ status: "error", message })
      })

    return () => controller.abort()
  }, [filePath, projectId])

  const header = state.status === "ready" ? state.data : null

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm text-foreground">{header?.name ?? "Preview"}</div>
          <div className="truncate text-xs text-muted-foreground">{filePath || "Select a file to preview"}</div>
        </div>
        {filePath ? (
          <div className="flex shrink-0 items-center gap-1">
            {onOpenInEditor ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Open in editor"
                onClick={() => onOpenInEditor(filePath)}
              >
                <FileCode2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            <a
              href={buildProjectFileRawUrl(projectId, filePath, true)}
              download
              aria-label="Download file"
              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : null}
      </div>

      {state.status === "idle" ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          Select a file to preview.
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
          Loading preview...
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-destructive">
          {state.message}
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          {state.data.kind === "image" ? (
            <ScrollArea className="flex-1 min-h-0">
              <div className="flex min-h-full items-center justify-center p-3">
                <img
                  src={buildProjectFileRawUrl(projectId, state.data.path)}
                  alt={state.data.name}
                  className="h-auto max-h-[min(70vh,100%)] max-w-full rounded-lg border border-border object-contain"
                />
              </div>
            </ScrollArea>
          ) : null}

          {state.data.kind === "text" ? (
            <ScrollArea className="flex-1 min-h-0">
              <pre className="min-h-full whitespace-pre-wrap break-words px-3 py-3 text-xs leading-5 text-foreground font-mono">
                {state.data.content}
              </pre>
            </ScrollArea>
          ) : null}

          {state.data.kind === "binary" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
              <EyeOff className="h-4 w-4" />
              <p>No inline preview for this file type.</p>
              <p className="text-xs">{state.data.contentType}</p>
            </div>
          ) : null}

          {state.data.truncated ? (
            <div className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Preview truncated to the first 128 KB.
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
