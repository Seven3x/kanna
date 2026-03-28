import type {
  HydratedSubagentTaskStatus,
  HydratedSubagentTaskToolCall,
} from "../../shared/types"

export function inferSubagentStatus(
  message: HydratedSubagentTaskToolCall,
  isLoading: boolean
): HydratedSubagentTaskStatus {
  if (message.isError) return "error"
  if (message.result?.status) return message.result.status
  if (!message.result && isLoading) return "running"
  if (message.result) return "success"
  return "waiting"
}

export function getSubagentTitle(message: HydratedSubagentTaskToolCall) {
  return message.result?.childTitle || message.input.subagentType || message.toolName
}

export function getSubagentLatestAssistantSummary(message: HydratedSubagentTaskToolCall): string | undefined {
  const messages = message.result?.childTranscript?.messages
  if (!messages?.length) return undefined

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index]
    if (candidate.kind === "assistant_text" && candidate.text.trim()) {
      return candidate.text.trim()
    }
  }

  return undefined
}

export function getSubagentSummary(
  message: HydratedSubagentTaskToolCall,
  fallback = "No summary available yet"
) {
  const text = (
    getSubagentLatestAssistantSummary(message)
    ?? message.result?.summary
    ?? message.result?.latestMessage
    ?? message.result?.resultText
    ?? message.result?.errorText
  )?.trim()

  if (!text) return fallback
  return text.length > 180 ? `${text.slice(0, 177)}...` : text
}
