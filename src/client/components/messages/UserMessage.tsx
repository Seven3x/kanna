import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { ProjectSkillSummary } from "../../../shared/types"
import { createMarkdownComponents, createSkillMentionsRemarkPlugin } from "./shared"

interface Props {
  content: string
  skills?: ProjectSkillSummary[]
}

export function UserMessage({ content, skills = [] }: Props) {
  return (
    <div className="flex gap-2 justify-end">
      <div className="max-w-[85%] sm:max-w-[80%] rounded-[20px] py-1.5 px-3.5 bg-muted text-primary border border-border prose prose-sm prose-invert [&_p]:whitespace-pre-line">
        <Markdown
          remarkPlugins={[remarkGfm, createSkillMentionsRemarkPlugin(skills.map((skill) => skill.name))]}
          components={createMarkdownComponents({ skills })}
        >
          {content}
        </Markdown>
      </div>
    </div>
  )
}
