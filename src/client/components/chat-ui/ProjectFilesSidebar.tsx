import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, Download, File, Folder, FolderOpen, RefreshCcw } from "lucide-react"
import { buildProjectFileRawUrl, fetchProjectFileList, getParentProjectFilePath } from "../../lib/projectFiles"
import { cn } from "../../lib/utils"
import type { ProjectFileListResponse } from "../../../shared/project-files"
import { Button, buttonVariants } from "../ui/button"
import { ScrollArea } from "../ui/scroll-area"
import { ProjectFilePreviewPanel } from "./ProjectFilePreviewPanel"

interface ProjectFilesSidebarProps {
  projectId: string
  localPath?: string
  onOpenInEditor?: (filePath: string) => void
}

type DirectoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProjectFileListResponse }

export function ProjectFilesSidebar({
  projectId,
  localPath,
  onOpenInEditor,
}: ProjectFilesSidebarProps) {
  const [currentPath, setCurrentPath] = useState("")
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [directoryState, setDirectoryState] = useState<DirectoryState>({ status: "loading" })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setCurrentPath("")
    setSelectedFilePath(null)
    setRefreshKey(0)
  }, [projectId])

  useEffect(() => {
    const controller = new AbortController()
    setDirectoryState({ status: "loading" })

    void fetchProjectFileList(projectId, currentPath, controller.signal)
      .then((data) => {
        setDirectoryState({ status: "ready", data })
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return
        }
        setDirectoryState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        })
      })

    return () => controller.abort()
  }, [currentPath, projectId, refreshKey])

  const canGoUp = currentPath.length > 0
  const currentLocationLabel = currentPath ? `/${currentPath}` : localPath ?? "Project files"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Files</div>
            <div className="truncate text-sm text-foreground">{currentLocationLabel}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Go to parent directory"
              disabled={!canGoUp}
              onClick={() => setCurrentPath(getParentProjectFilePath(currentPath))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh file list"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(220px,40%)]">
        <ScrollArea className="min-h-0">
          {directoryState.status === "loading" ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">Loading files...</div>
          ) : null}

          {directoryState.status === "error" ? (
            <div className="px-3 py-4 text-sm text-destructive">{directoryState.message}</div>
          ) : null}

          {directoryState.status === "ready" ? (
            <div className="py-2">
              {directoryState.data.entries.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">This folder is empty.</div>
              ) : null}

              {directoryState.data.entries.map((entry) => {
                const isSelected = entry.path === selectedFilePath

                return (
                  <div
                    key={entry.path}
                    className={cn(
                      "group flex items-center gap-2 px-2 py-1.5",
                      isSelected && "bg-accent/60"
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-foreground transition-colors hover:bg-accent"
                      onClick={() => {
                        if (entry.isDirectory) {
                          setCurrentPath(entry.path)
                          return
                        }
                        setSelectedFilePath(entry.path)
                      }}
                    >
                      {entry.isDirectory ? (
                        isSelected ? <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{entry.name}</span>
                      {entry.isDirectory ? <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
                    </button>

                    {!entry.isDirectory ? (
                      <a
                        href={buildProjectFileRawUrl(projectId, entry.path, true)}
                        download
                        aria-label={`Download ${entry.name}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "opacity-0 transition-opacity group-hover:opacity-100")}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </ScrollArea>

        <div className="min-h-0 border-t border-border">
          <ProjectFilePreviewPanel
            projectId={projectId}
            filePath={selectedFilePath}
            onOpenInEditor={onOpenInEditor}
          />
        </div>
      </div>
    </div>
  )
}
