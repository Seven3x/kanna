import { useState } from "react"
import { ChevronDown, ExternalLink, Sparkles, X } from "lucide-react"
import type { ProjectSkillSummary } from "../../../shared/types"
import { resolveProjectLocalFilePath } from "../../lib/projectFiles"
import { cn } from "../../lib/utils"
import { Button } from "../ui/button"
import { ScrollArea } from "../ui/scroll-area"
import { ProjectFilesSidebar } from "./ProjectFilesSidebar"

interface RightSidebarProps {
  projectId: string
  localPath?: string
  skills?: ProjectSkillSummary[]
  onClose: () => void
  onOpenInEditor?: (localPath: string) => void
}

function SectionHeader({
  title,
  count,
  expanded,
  onToggle,
  icon: Icon,
}: {
  title: string
  count?: number
  expanded: boolean
  onToggle: () => void
  icon?: typeof Sparkles
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/40"
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{title}</span>
      {typeof count === "number" ? (
        <span className="text-[11px] text-muted-foreground">{count}</span>
      ) : null}
      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")} />
    </button>
  )
}

function SkillDetails({
  skill,
  localPath,
  onOpenInEditor,
}: {
  skill: ProjectSkillSummary
  localPath?: string
  onOpenInEditor?: (localPath: string) => void
}) {
  const absolutePath = skill.filePath
    ?? (localPath && skill.relativePath ? resolveProjectLocalFilePath(localPath, skill.relativePath) : null)
  const pathLabel = skill.pathDisplay ?? skill.relativePath ?? skill.filePath

  return (
    <div className="rounded-b-xl border-x border-b border-border bg-card px-3 pb-3">
      {skill.description ? (
        <div className="pt-2 text-xs leading-5 text-muted-foreground">{skill.description}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {skill.scope ? (
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
            {skill.scope}
          </span>
        ) : null}
        {skill.sourceType ? (
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
            {skill.sourceType}
          </span>
        ) : null}
        {skill.source ? (
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
            {skill.source}
          </span>
        ) : null}
        {pathLabel ? (
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
            {pathLabel}
          </span>
        ) : null}
      </div>
      {absolutePath && onOpenInEditor ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-lg px-2.5"
            onClick={() => onOpenInEditor(absolutePath)}
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Open Skill
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function SkillItem({
  skill,
  localPath,
  expanded,
  onToggle,
  onOpenInEditor,
}: {
  skill: ProjectSkillSummary
  localPath?: string
  expanded: boolean
  onToggle: () => void
  onOpenInEditor?: (localPath: string) => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/30",
          expanded && "rounded-b-none"
        )}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{skill.name}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")} />
      </button>
      {expanded ? (
        <SkillDetails
          skill={skill}
          localPath={localPath}
          onOpenInEditor={onOpenInEditor}
        />
      ) : null}
    </div>
  )
}

export function RightSidebar({ projectId, localPath, skills = [], onClose, onOpenInEditor }: RightSidebarProps) {
  const [skillsExpanded, setSkillsExpanded] = useState(true)
  const [filesExpanded, setFilesExpanded] = useState(true)
  const [expandedSkillKey, setExpandedSkillKey] = useState<string | null>(null)

  return (
    <div className="h-full min-h-0 border-l border-border bg-background md:min-w-[300px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Project Files</div>
          <button
            type="button"
            aria-label="Close right sidebar"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {skills.length > 0 ? (
          <div className="shrink-0 border-b border-border">
            <SectionHeader
              title="Skills"
              count={skills.length}
              expanded={skillsExpanded}
              onToggle={() => setSkillsExpanded((current) => !current)}
              icon={Sparkles}
            />
            {skillsExpanded ? (
              <ScrollArea className="max-h-[32vh] px-3 pb-3">
                <div className="space-y-2">
                  {skills.map((skill) => {
                    const skillKey = `${skill.scope ?? "unknown"}:${skill.name}:${skill.pathDisplay ?? skill.relativePath ?? skill.filePath ?? ""}`
                    return (
                      <SkillItem
                        key={skillKey}
                        skill={skill}
                        localPath={localPath}
                        expanded={expandedSkillKey === skillKey}
                        onToggle={() => setExpandedSkillKey((current) => current === skillKey ? null : skillKey)}
                        onOpenInEditor={onOpenInEditor}
                      />
                    )
                  })}
                </div>
              </ScrollArea>
            ) : null}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border">
            <SectionHeader
              title="Files"
              expanded={filesExpanded}
              onToggle={() => setFilesExpanded((current) => !current)}
            />
          </div>
          {filesExpanded ? (
            <div className="min-h-0 flex-1">
              <ProjectFilesSidebar
                projectId={projectId}
                localPath={localPath}
                showTitle={false}
                onOpenInEditor={onOpenInEditor && localPath
                  ? (filePath) => onOpenInEditor(resolveProjectLocalFilePath(localPath, filePath))
                  : undefined}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
