import { type ReactNode, useEffect, useState } from "react"
import { ChevronDown, ExternalLink, FilePenLine, GitBranch, History, Sparkles, X } from "lucide-react"
import type { ProjectGitCommitDetail, ProjectGitSnapshot } from "../../../shared/project-git"
import type { ProjectSkillSummary } from "../../../shared/types"
import { fetchProjectGitCommitDetail, fetchProjectGitSnapshot } from "../../lib/projectGit"
import { resolveProjectLocalFilePath } from "../../lib/projectFiles"
import { cn } from "../../lib/utils"
import { Button } from "../ui/button"
import { ScrollArea } from "../ui/scroll-area"
import { ProjectFilesSidebar } from "./ProjectFilesSidebar"
import { ProjectTextFileEditorDialog } from "../messages/ProjectTextFileEditorDialog"

function splitPathForDisplay(filePath: string) {
  const normalized = filePath.replaceAll("\\", "/")
  const lastSlashIndex = normalized.lastIndexOf("/")
  if (lastSlashIndex === -1) {
    return {
      name: normalized,
      directory: "",
    }
  }

  return {
    name: normalized.slice(lastSlashIndex + 1),
    directory: normalized.slice(0, lastSlashIndex),
  }
}

function GitFileRow({
  label,
  toneClassName,
  filePath,
}: {
  label: string
  toneClassName: string
  filePath: string
}) {
  const parts = splitPathForDisplay(filePath)

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/80 bg-background px-2.5 py-2">
      <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", toneClassName)}>
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{parts.name}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {parts.directory || "."}
        </div>
      </div>
    </div>
  )
}

function GitCommitRow({
  active = false,
  onClick,
  shortHash,
  subject,
}: {
  active?: boolean
  onClick?: () => void
  shortHash: string
  subject: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg border border-border/80 bg-background px-2.5 py-2 text-left transition-colors hover:bg-accent/40",
        active && "border-border bg-accent/50"
      )}
    >
      <span className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        {shortHash}
      </span>
      <div className="min-w-0 flex-1 truncate text-sm text-foreground">{subject}</div>
    </button>
  )
}

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
  trailing,
}: {
  title: string
  count?: number
  expanded: boolean
  onToggle: () => void
  icon?: typeof Sparkles
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent/40"
      >
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{title}</span>
        {typeof count === "number" ? (
          <span className="text-[11px] text-muted-foreground">{count}</span>
        ) : null}
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")} />
      </button>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
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
  const [skillsExpanded, setSkillsExpanded] = useState(false)
  const [gitExpanded, setGitExpanded] = useState(false)
  const [gitHistoryExpanded, setGitHistoryExpanded] = useState(false)
  const [filesExpanded, setFilesExpanded] = useState(false)
  const [agentsDialogOpen, setAgentsDialogOpen] = useState(false)
  const [expandedSkillKey, setExpandedSkillKey] = useState<string | null>(null)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null)
  const [gitState, setGitState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: ProjectGitSnapshot }
  >({ status: "loading" })
  const [commitState, setCommitState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: ProjectGitCommitDetail }
  >({ status: "idle" })

  useEffect(() => {
    const controller = new AbortController()
    setGitState({ status: "loading" })

    void fetchProjectGitSnapshot(projectId, controller.signal)
      .then((data) => setGitState({ status: "ready", data }))
      .catch((error) => {
        if (controller.signal.aborted) return
        setGitState({ status: "error", message: error instanceof Error ? error.message : String(error) })
      })

    return () => controller.abort()
  }, [projectId])

  useEffect(() => {
    const commitHash = selectedCommitHash
    if (!commitHash) {
      setCommitState({ status: "idle" })
      return
    }

    const controller = new AbortController()
    setCommitState({ status: "loading" })
    void fetchProjectGitCommitDetail(projectId, commitHash, controller.signal)
      .then((data) => setCommitState({ status: "ready", data }))
      .catch((error) => {
        if (controller.signal.aborted) return
        setCommitState({ status: "error", message: error instanceof Error ? error.message : String(error) })
      })

    return () => controller.abort()
  }, [projectId, selectedCommitHash])

  const gitItemCount = gitState.status === "ready"
    ? gitState.data.stagedFiles.length + gitState.data.modifiedFiles.length + gitState.data.untrackedFiles.length
    : undefined
  const gitHistoryCount = gitState.status === "ready" ? gitState.data.recentCommits.length : undefined

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

        <div className="shrink-0 border-b border-border">
          <SectionHeader
            title="Git"
            count={gitItemCount}
            expanded={gitExpanded}
            onToggle={() => setGitExpanded((current) => !current)}
            icon={GitBranch}
          />
          {gitExpanded ? (
            <ScrollArea className="max-h-[32vh] px-3 pb-3">
              {gitState.status === "loading" ? (
                <div className="py-3 text-sm text-muted-foreground">Loading git status...</div>
              ) : null}
              {gitState.status === "error" ? (
                <div className="py-3 text-sm text-destructive">{gitState.message}</div>
              ) : null}
              {gitState.status === "ready" ? (
                gitState.data.isGitRepository ? (
                  <div className="space-y-3 py-3">
                    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                      <div className="text-xs text-muted-foreground">Branch</div>
                      <div className="mt-1 truncate text-sm font-medium text-foreground">
                        {gitState.data.branch ?? "(detached)"}
                      </div>
                    </div>

                    {gitState.data.stagedFiles.length > 0 ? (
                      <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                        <div className="mb-2 text-xs text-muted-foreground">Staged</div>
                        <div className="space-y-1.5">
                          {gitState.data.stagedFiles.map((filePath) => (
                            <GitFileRow
                              key={`staged:${filePath}`}
                              label="staged"
                              toneClassName="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              filePath={filePath}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {gitState.data.modifiedFiles.length > 0 ? (
                      <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                        <div className="mb-2 text-xs text-muted-foreground">Modified</div>
                        <div className="space-y-1.5">
                          {gitState.data.modifiedFiles.map((filePath) => (
                            <GitFileRow
                              key={`modified:${filePath}`}
                              label="modified"
                              toneClassName="bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              filePath={filePath}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {gitState.data.untrackedFiles.length > 0 ? (
                      <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                        <div className="mb-2 text-xs text-muted-foreground">Untracked</div>
                        <div className="space-y-1.5">
                          {gitState.data.untrackedFiles.map((filePath) => (
                            <GitFileRow
                              key={`untracked:${filePath}`}
                              label="new"
                              toneClassName="bg-sky-500/15 text-sky-700 dark:text-sky-300"
                              filePath={filePath}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {gitState.data.stagedFiles.length === 0
                    && gitState.data.modifiedFiles.length === 0
                    && gitState.data.untrackedFiles.length === 0 ? (
                      <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
                        Working tree clean.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="py-3 text-sm text-muted-foreground">This project is not a git repository.</div>
                )
              ) : null}
            </ScrollArea>
          ) : null}
        </div>

        <div className="shrink-0 border-b border-border">
          <SectionHeader
            title="Git History"
            count={gitHistoryCount}
            expanded={gitHistoryExpanded}
            onToggle={() => setGitHistoryExpanded((current) => !current)}
            icon={History}
          />
          {gitHistoryExpanded ? (
            <ScrollArea className="max-h-[36vh] px-3 pb-3">
              {gitState.status === "loading" ? (
                <div className="py-3 text-sm text-muted-foreground">Loading git history...</div>
              ) : null}
              {gitState.status === "error" ? (
                <div className="py-3 text-sm text-destructive">{gitState.message}</div>
              ) : null}
              {gitState.status === "ready" ? (
                gitState.data.isGitRepository ? (
                  <div className="space-y-3 py-3">
                    <div className="rounded-xl border border-border bg-card p-2">
                      <div className="space-y-1.5">
                        {gitState.data.recentCommits.map((commit) => (
                          <GitCommitRow
                            key={commit.hash}
                            shortHash={commit.shortHash}
                            subject={commit.subject}
                            active={selectedCommitHash === commit.hash}
                            onClick={() => setSelectedCommitHash(commit.hash)}
                          />
                        ))}
                        {gitState.data.recentCommits.length === 0 ? (
                          <div className="px-2 py-2 text-sm text-muted-foreground">No commits yet.</div>
                        ) : null}
                      </div>
                    </div>

                    {commitState.status === "loading" ? (
                      <div className="rounded-xl border border-border bg-card px-3 py-3 text-sm text-muted-foreground">
                        Loading commit details...
                      </div>
                    ) : null}
                    {commitState.status === "error" ? (
                      <div className="rounded-xl border border-border bg-card px-3 py-3 text-sm text-destructive">
                        {commitState.message}
                      </div>
                    ) : null}
                    {commitState.status === "ready" ? (
                      <div className="rounded-xl border border-border bg-card px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {commitState.data.shortHash}
                          </span>
                          <div className="truncate text-sm font-medium text-foreground">{commitState.data.subject}</div>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {[commitState.data.authorName, commitState.data.authoredAt].filter(Boolean).join(" • ")}
                        </div>
                        {commitState.data.body ? (
                          <div className="mt-3 whitespace-pre-wrap text-sm leading-5 text-foreground">
                            {commitState.data.body}
                          </div>
                        ) : null}
                        <div className="mt-3 border-t border-border pt-3">
                          <div className="mb-2 text-xs text-muted-foreground">Changed files</div>
                          <div className="space-y-1.5">
                            {commitState.data.files.map((filePath) => (
                              <GitFileRow
                                key={`commit-file:${commitState.data.hash}:${filePath}`}
                                label="file"
                                toneClassName="bg-muted text-muted-foreground"
                                filePath={filePath}
                              />
                            ))}
                            {commitState.data.files.length === 0 ? (
                              <div className="text-sm text-muted-foreground">No file list available.</div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="py-3 text-sm text-muted-foreground">This project is not a git repository.</div>
                )
              ) : null}
            </ScrollArea>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border">
            <SectionHeader
              title="Files"
              expanded={filesExpanded}
              onToggle={() => setFilesExpanded((current) => !current)}
              trailing={(
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-md px-2 text-xs"
                  onClick={(event) => {
                    event.stopPropagation()
                    setAgentsDialogOpen(true)
                  }}
                >
                  <FilePenLine className="mr-1.5 h-3.5 w-3.5" />
                  AGENTS.md
                </Button>
              )}
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
        <ProjectTextFileEditorDialog
          open={agentsDialogOpen}
          onOpenChange={setAgentsDialogOpen}
          projectId={projectId}
          filePath="AGENTS.md"
          title="Edit AGENTS.md"
          onSaved={() => setFilesExpanded(true)}
          onOpenInEditor={onOpenInEditor && localPath
            ? (filePath) => onOpenInEditor(resolveProjectLocalFilePath(localPath, filePath))
            : undefined}
        />
      </div>
    </div>
  )
}
