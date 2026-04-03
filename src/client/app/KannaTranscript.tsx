import { useState } from "react"
import type { AskUserQuestionItem } from "../components/messages/types"
import type { AskUserQuestionAnswerMap, HydratedTranscriptMessage, ProjectSkillSummary } from "../../shared/types"
import { getProjectRelativeFilePath } from "../lib/projectFiles"
import { ProjectFilePreviewDialog } from "../components/messages/ProjectFilePreviewDialog"
import { OpenLocalLinkProvider } from "../components/messages/shared"
import { TranscriptMessageList } from "../components/messages/TranscriptMessageList"
import { CHAT_SELECTION_ZONE_ATTRIBUTE } from "./chatFocusPolicy"

interface KannaTranscriptProps {
  messages: HydratedTranscriptMessage[]
  isLoading: boolean
  localPath?: string
  projectId?: string
  skills?: ProjectSkillSummary[]
  latestToolIds: Record<string, string | null>
  onOpenLocalLink: (target: { path: string; line?: number; column?: number }) => void
  onOpenProjectFile?: (path: string) => void
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

export function KannaTranscript({
  messages,
  isLoading,
  localPath,
  projectId,
  skills,
  latestToolIds,
  onOpenLocalLink,
  onOpenProjectFile,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
}: KannaTranscriptProps) {
  const [previewFile, setPreviewFile] = useState<{ projectId: string; filePath: string } | null>(null)

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
        <TranscriptMessageList
          messages={messages}
          isLoading={isLoading}
          localPath={localPath}
          projectId={projectId}
          skills={skills}
          latestToolIds={latestToolIds}
          onOpenProjectFile={onOpenProjectFile}
          onAskUserQuestionSubmit={onAskUserQuestionSubmit}
          onExitPlanModeConfirm={onExitPlanModeConfirm}
          domIdPrefix="msg"
          selectionZoneAttribute={CHAT_SELECTION_ZONE_ATTRIBUTE}
        />
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
}
