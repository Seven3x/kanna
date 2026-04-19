import { useEffect, useMemo, useState } from "react"
import { ExternalLink, RefreshCcw, Save } from "lucide-react"
import { fetchProjectFilePreview, writeProjectFile } from "../../lib/projectFiles"
import { Button } from "../ui/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog"
import { Textarea } from "../ui/textarea"

interface ProjectTextFileEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  filePath: string
  title?: string
  onSaved?: (filePath: string) => void
  onOpenInEditor?: (filePath: string) => void
}

type EditorState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; content: string; exists: boolean; modifiedAt: number | null }

export function ProjectTextFileEditorDialog({
  open,
  onOpenChange,
  projectId,
  filePath,
  title = "Edit File",
  onSaved,
  onOpenInEditor,
}: ProjectTextFileEditorDialogProps) {
  const [state, setState] = useState<EditorState>({ status: "idle" })
  const [draft, setDraft] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const isDirty = useMemo(
    () => state.status === "ready" && draft !== state.content,
    [draft, state]
  )

  useEffect(() => {
    if (!open) {
      setSaveError(null)
      return
    }

    const controller = new AbortController()
    setState({ status: "loading" })
    setSaveError(null)

    void fetchProjectFilePreview(projectId, filePath, controller.signal)
      .then((result) => {
        if (result.kind !== "text") {
          setState({ status: "error", message: "Only text files can be edited inline." })
          return
        }
        const content = result.content ?? ""
        setDraft(content)
        setState({
          status: "ready",
          content,
          exists: true,
          modifiedAt: result.modifiedAt,
        })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        if (message === "File not found") {
          setDraft("")
          setState({
            status: "ready",
            content: "",
            exists: false,
            modifiedAt: null,
          })
          return
        }
        setState({ status: "error", message })
      })

    return () => controller.abort()
  }, [filePath, open, projectId, refreshKey])

  async function handleSave() {
    setIsSaving(true)
    setSaveError(null)
    try {
      const result = await writeProjectFile(projectId, filePath, draft)
      setState({
        status: "ready",
        content: draft,
        exists: true,
        modifiedAt: result.modifiedAt,
      })
      onSaved?.(filePath)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="h-[84vh] min-h-[520px] w-[min(94vw,76rem)] max-w-none overflow-hidden p-0">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate">{filePath}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex min-h-0 flex-col p-0">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <div className="min-w-0">
              <div className="text-sm text-foreground">{state.status === "ready" && !state.exists ? "New file" : "Project file"}</div>
              <div className="truncate text-xs text-muted-foreground">
                {state.status === "ready" && !state.exists
                  ? "AGENTS.md does not exist yet. Saving will create it in the project root."
                  : filePath}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {onOpenInEditor ? (
                <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2.5" onClick={() => onOpenInEditor(filePath)}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Open in editor
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg px-2.5"
                onClick={() => setRefreshKey((value) => value + 1)}
              >
                <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                Reload
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg px-2.5"
                disabled={state.status !== "ready" || !isDirty || isSaving}
                onClick={() => void handleSave()}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>

          {state.status === "loading" ? (
            <div className="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
              Loading file...
            </div>
          ) : null}

          {state.status === "error" ? (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-destructive">
              {state.message}
            </div>
          ) : null}

          {state.status === "ready" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-border px-4 py-2 text-xs text-muted-foreground">
                {state.modifiedAt ? `Last modified ${new Date(state.modifiedAt).toLocaleString()}` : "New unsaved file"}
                {isDirty ? " • Unsaved changes" : ""}
              </div>
              <div className="min-h-0 flex-1 p-4">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck={false}
                  className="h-full min-h-full resize-none rounded-xl border-border bg-background font-mono text-sm leading-6"
                />
              </div>
              {saveError ? (
                <div className="shrink-0 border-t border-border px-4 py-2 text-sm text-destructive">{saveError}</div>
              ) : null}
            </div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
