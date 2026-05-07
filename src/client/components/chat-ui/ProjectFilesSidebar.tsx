import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Download, File, FilePenLine, Folder, FolderOpen, RefreshCcw, Upload } from "lucide-react"
import { buildProjectFileRawUrl, fetchProjectFileList, getParentProjectFilePath, uploadProjectFiles } from "../../lib/projectFiles"
import { cn } from "../../lib/utils"
import type { ProjectFileListResponse } from "../../../shared/project-files"
import { Button, buttonVariants } from "../ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable"
import { ScrollArea } from "../ui/scroll-area"
import { ProjectFilePreviewPanel } from "./ProjectFilePreviewPanel"
import { ProjectFilePreviewDialog } from "../messages/ProjectFilePreviewDialog"
import { ProjectTextFileEditorDialog } from "../messages/ProjectTextFileEditorDialog"

interface ProjectFilesSidebarProps {
  projectId: string
  localPath?: string
  onOpenInEditor?: (filePath: string) => void
  showTitle?: boolean
}

type DirectoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProjectFileListResponse }

export function splitFileNameForDisplay(name: string): { base: string; extension: string } {
  const lastDotIndex = name.lastIndexOf(".")
  if (lastDotIndex <= 0 || lastDotIndex === name.length - 1) {
    return { base: name, extension: "" }
  }

  return {
    base: name.slice(0, lastDotIndex),
    extension: name.slice(lastDotIndex),
  }
}

export function ProjectFilesSidebar({
  projectId,
  localPath,
  onOpenInEditor,
  showTitle = true,
}: ProjectFilesSidebarProps) {
  const [currentPath, setCurrentPath] = useState("")
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [dialogFilePath, setDialogFilePath] = useState<string | null>(null)
  const [agentsDialogOpen, setAgentsDialogOpen] = useState(false)
  const [directoryState, setDirectoryState] = useState<DirectoryState>({ status: "loading" })
  const [refreshKey, setRefreshKey] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setCurrentPath("")
    setSelectedFilePath(null)
    setDialogFilePath(null)
    setRefreshKey(0)
    setUploadError(null)
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
  const hasPreview = selectedFilePath !== null
  const listPane = (
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
            const fileName = splitFileNameForDisplay(entry.name)

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
                  onDoubleClick={() => {
                    if (entry.isDirectory) {
                      setCurrentPath(entry.path)
                      return
                    }
                    setSelectedFilePath(entry.path)
                    setDialogFilePath(entry.path)
                  }}
                >
                  {entry.isDirectory ? (
                    isSelected ? <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex min-w-0 flex-1 items-baseline">
                    <span className="truncate">{fileName.base}</span>
                    {fileName.extension ? <span className="shrink-0">{fileName.extension}</span> : null}
                  </span>
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
  )

  async function handleUploadFiles(fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : []
    if (files.length === 0) {
      return
    }

    setUploadError(null)
    setIsUploading(true)

    try {
      await uploadProjectFiles(projectId, files, currentPath)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {showTitle ? <div className="text-xs text-muted-foreground">Files</div> : null}
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
              size="sm"
              className="h-8 rounded-lg px-2.5"
              aria-label="Open AGENTS.md"
              onClick={() => setAgentsDialogOpen(true)}
            >
              <FilePenLine className="mr-1.5 h-3.5 w-3.5" />
              AGENTS.md
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Upload files"
              title="Upload files"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh file list"
              disabled={isUploading}
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleUploadFiles(event.target.files)
          }}
        />
        {uploadError ? (
          <div className="pt-2 text-xs text-destructive">{uploadError}</div>
        ) : null}
        {isUploading ? (
          <div className="pt-2 text-xs text-muted-foreground">Uploading files...</div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        {hasPreview ? (
          <ResizablePanelGroup orientation="vertical" className="min-h-0">
            <ResizablePanel minSize={25} defaultSize={58} className="min-h-0">
              {listPane}
            </ResizablePanel>
            <ResizableHandle withHandle orientation="vertical" />
            <ResizablePanel minSize={20} defaultSize={42} className="min-h-0 border-t border-border">
              <ProjectFilePreviewPanel
                projectId={projectId}
                filePath={selectedFilePath}
                onOpenInEditor={onOpenInEditor}
                className="h-full"
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          listPane
        )}
      </div>

      {dialogFilePath ? (
        <ProjectFilePreviewDialog
          open={dialogFilePath !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDialogFilePath(null)
            }
          }}
          projectId={projectId}
          filePath={dialogFilePath}
          onOpenInEditor={onOpenInEditor}
        />
      ) : null}
      <ProjectTextFileEditorDialog
        open={agentsDialogOpen}
        onOpenChange={setAgentsDialogOpen}
        projectId={projectId}
        filePath="AGENTS.md"
        title="Edit AGENTS.md"
        onSaved={() => {
          setCurrentPath("")
          setSelectedFilePath("AGENTS.md")
          setRefreshKey((value) => value + 1)
        }}
        onOpenInEditor={onOpenInEditor}
      />
    </div>
  )
}
