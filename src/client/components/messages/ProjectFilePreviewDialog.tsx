import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog"
import { ProjectFilePreviewPanel } from "../chat-ui/ProjectFilePreviewPanel"

interface ProjectFilePreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  filePath: string
  onOpenInEditor?: (filePath: string) => void
}

export function ProjectFilePreviewDialog({
  open,
  onOpenChange,
  projectId,
  filePath,
  onOpenInEditor,
}: ProjectFilePreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="h-[80vh] min-h-[420px] w-[min(92vw,72rem)] max-w-none resize overflow-hidden p-0">
        <DialogHeader>
          <DialogTitle>File Preview</DialogTitle>
          <DialogDescription className="truncate">{filePath}</DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 p-0">
          <ProjectFilePreviewPanel
            projectId={projectId}
            filePath={filePath}
            onOpenInEditor={onOpenInEditor}
            className="h-full"
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
