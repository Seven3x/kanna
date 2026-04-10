export interface ProjectGitCommitSummary {
  hash: string
  shortHash: string
  subject: string
}

export interface ProjectGitCommitDetail {
  hash: string
  shortHash: string
  subject: string
  authorName: string | null
  authoredAt: string | null
  body: string
  files: string[]
}

export interface ProjectGitSnapshot {
  projectId: string
  isGitRepository: boolean
  repoRoot: string | null
  branch: string | null
  stagedFiles: string[]
  modifiedFiles: string[]
  untrackedFiles: string[]
  recentCommits: ProjectGitCommitSummary[]
}
