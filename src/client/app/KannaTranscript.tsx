import type { AskUserQuestionItem } from "../components/messages/types"
import type { AskUserQuestionAnswerMap, HydratedTranscriptMessage } from "../../shared/types"
import { OpenLocalLinkProvider } from "../components/messages/shared"
import { TranscriptMessageList } from "../components/messages/TranscriptMessageList"
import { CHAT_SELECTION_ZONE_ATTRIBUTE } from "./chatFocusPolicy"

interface KannaTranscriptProps {
  messages: HydratedTranscriptMessage[]
  isLoading: boolean
  localPath?: string
  projectId?: string
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

export function KannaTranscript({
  messages,
  isLoading,
  localPath,
  projectId,
  latestToolIds,
  onOpenLocalLink,
  onOpenProjectFile,
  onAskUserQuestionSubmit,
  onExitPlanModeConfirm,
}: KannaTranscriptProps) {
  return (
    <OpenLocalLinkProvider onOpenLocalLink={onOpenLocalLink}>
      <TranscriptMessageList
        messages={messages}
        isLoading={isLoading}
        localPath={localPath}
        projectId={projectId}
        latestToolIds={latestToolIds}
        onOpenProjectFile={onOpenProjectFile}
        onAskUserQuestionSubmit={onAskUserQuestionSubmit}
        onExitPlanModeConfirm={onExitPlanModeConfirm}
        domIdPrefix="msg"
        selectionZoneAttribute={CHAT_SELECTION_ZONE_ATTRIBUTE}
      />
    </OpenLocalLinkProvider>
  )
}
