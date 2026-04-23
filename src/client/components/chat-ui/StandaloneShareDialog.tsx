import { Check, Copy, ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogGhostButton,
  DialogHeader,
  DialogPrimaryButton,
  DialogTitle,
} from "../ui/dialog"

interface Props {
  open: boolean
  shareUrl: string
  onOpenChange: (open: boolean) => void
  onOpenLink: () => void
  onCopyLink: () => Promise<boolean>
}

export function StandaloneShareDialog({
  open,
  shareUrl,
  onOpenChange,
  onOpenLink,
  onCopyLink,
}: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) {
      setCopied(false)
    }
  }, [open, shareUrl])

  const handleCopyLink = async () => {
    const didCopy = await onCopyLink()
    if (!didCopy) {
      return
    }

    setCopied(true)
    window.setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Share ready</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3">
            <p className="break-all font-mono text-sm text-foreground">{shareUrl}</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogGhostButton type="button" onClick={() => void handleCopyLink()}>
            {copied ? <Check className="mr-2 h-4 w-4 text-green-400" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied ? "Copied" : "Copy Link"}
          </DialogGhostButton>
          <DialogPrimaryButton type="button" onClick={onOpenLink}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Link
          </DialogPrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
