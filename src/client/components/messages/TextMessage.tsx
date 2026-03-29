import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { ProjectSkillSummary } from "../../../shared/types"
import { createSkillMentionsRemarkPlugin } from "./shared"
import type { ProcessedTextMessage } from "./types"
import { createMarkdownComponents } from "./shared"

interface Props {
  message: ProcessedTextMessage
  skills?: ProjectSkillSummary[]
}

export function TextMessage({ message, skills = [] }: Props) {
  return (
    // <VerticalLineContainer className="w-full">
      <div className="text-pretty prose prose-sm dark:prose-invert px-0.5 w-full max-w-full space-y-4">
        <Markdown
          remarkPlugins={[remarkGfm, createSkillMentionsRemarkPlugin(skills.map((skill) => skill.name))]}
          components={createMarkdownComponents({ skills })}
        >
          {message.text}
        </Markdown>
      </div>
    // </VerticalLineContainer>
  )
}
