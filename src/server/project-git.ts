import { realpath, stat } from "node:fs/promises"
import path from "node:path"
import type { ProjectGitCommitDetail, ProjectGitCommitSummary, ProjectGitSnapshot } from "../shared/project-git"
import { EventStore } from "./event-store"
import { resolveLocalPath } from "./paths"

const PROJECT_GIT_ROUTE = /^\/api\/projects\/(?<projectId>[^/]+)\/git(?:\/(?<resource>commit))?$/

class ProjectGitError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status })
}

async function getProjectRoot(store: EventStore, projectId: string) {
  const project = store.getProject(projectId)
  if (!project) {
    throw new ProjectGitError(404, "Project not found")
  }

  const projectRoot = resolveLocalPath(project.localPath)
  const info = await stat(projectRoot).catch(() => null)
  if (!info?.isDirectory()) {
    throw new ProjectGitError(404, "Project directory not found")
  }

  return {
    projectId,
    projectRoot,
    projectRootRealPath: await realpath(projectRoot),
  }
}

async function runGit(projectRoot: string, args: string[]) {
  const proc = Bun.spawn({
    cmd: ["git", "-C", projectRoot, ...args],
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return {
    stdout,
    stderr,
    exitCode,
  }
}

function parseStatusLinePath(rawPath: string) {
  const trimmed = rawPath.trim()
  if (!trimmed) return trimmed
  const renamedParts = trimmed.split(" -> ")
  return renamedParts[renamedParts.length - 1] ?? trimmed
}

function parseGitStatus(output: string) {
  const lines = output.split(/\r?\n/).filter(Boolean)
  let branch: string | null = null
  const stagedFiles: string[] = []
  const modifiedFiles: string[] = []
  const untrackedFiles: string[] = []

  for (const line of lines) {
    if (line.startsWith("## ")) {
      branch = line.slice(3).split("...")[0]?.trim() || null
      continue
    }

    const indexStatus = line[0] ?? " "
    const worktreeStatus = line[1] ?? " "
    const filePath = parseStatusLinePath(line.slice(3))
    if (!filePath) continue

    if (indexStatus === "?" && worktreeStatus === "?") {
      untrackedFiles.push(filePath)
      continue
    }

    if (indexStatus !== " ") {
      stagedFiles.push(filePath)
    }
    if (worktreeStatus !== " ") {
      modifiedFiles.push(filePath)
    }
  }

  return {
    branch,
    stagedFiles: [...new Set(stagedFiles)],
    modifiedFiles: [...new Set(modifiedFiles)],
    untrackedFiles: [...new Set(untrackedFiles)],
  }
}

function parseRecentCommits(output: string): ProjectGitCommitSummary[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split("\t")
      const normalizedHash = hash?.trim()
      const normalizedSubject = subject?.trim()
      if (!normalizedHash || !normalizedSubject) {
        return null
      }

      return {
        hash: normalizedHash,
        shortHash: normalizedHash.slice(0, 7),
        subject: normalizedSubject,
      } satisfies ProjectGitCommitSummary
    })
    .filter((entry): entry is ProjectGitCommitSummary => entry !== null)
}

export async function readProjectGitSnapshot(store: EventStore, projectId: string): Promise<ProjectGitSnapshot> {
  const { projectRootRealPath, projectId: resolvedProjectId } = await getProjectRoot(store, projectId)
  const revParse = await runGit(projectRootRealPath, ["rev-parse", "--show-toplevel"])
  if (revParse.exitCode !== 0) {
    return {
      projectId: resolvedProjectId,
      isGitRepository: false,
      repoRoot: null,
      branch: null,
      stagedFiles: [],
      modifiedFiles: [],
      untrackedFiles: [],
      recentCommits: [],
    }
  }

  const repoRoot = revParse.stdout.trim() || projectRootRealPath
  const status = await runGit(repoRoot, ["status", "--short", "--branch", "--untracked-files=all"])
  const commits = await runGit(repoRoot, ["log", "--pretty=format:%H%x09%s", "-n", "8", "--no-show-signature"])
  const parsedStatus = parseGitStatus(status.stdout)

  return {
    projectId: resolvedProjectId,
    isGitRepository: true,
    repoRoot: path.normalize(repoRoot),
    branch: parsedStatus.branch,
    stagedFiles: parsedStatus.stagedFiles,
    modifiedFiles: parsedStatus.modifiedFiles,
    untrackedFiles: parsedStatus.untrackedFiles,
    recentCommits: commits.exitCode === 0 ? parseRecentCommits(commits.stdout) : [],
  }
}

function parseCommitDetail(output: string, hash: string): ProjectGitCommitDetail {
  const [headerLine = "", ...restLines] = output.split(/\r?\n/)
  const [resolvedHash = hash, authorName = "", authoredAt = "", subject = ""] = headerLine.split("\t")
  const bodyLines: string[] = []
  const files: string[] = []
  let inFiles = false

  for (const line of restLines) {
    if (line === "---FILES---") {
      inFiles = true
      continue
    }

    if (inFiles) {
      const normalized = line.trim()
      if (normalized) files.push(normalized)
      continue
    }

    bodyLines.push(line)
  }

  return {
    hash: resolvedHash,
    shortHash: resolvedHash.slice(0, 7),
    subject: subject.trim(),
    authorName: authorName.trim() || null,
    authoredAt: authoredAt.trim() || null,
    body: bodyLines.join("\n").trim(),
    files,
  }
}

export async function readProjectGitCommitDetail(
  store: EventStore,
  projectId: string,
  hash: string,
): Promise<ProjectGitCommitDetail> {
  const { projectRootRealPath } = await getProjectRoot(store, projectId)
  const revParse = await runGit(projectRootRealPath, ["rev-parse", "--show-toplevel"])
  if (revParse.exitCode !== 0) {
    throw new ProjectGitError(400, "Project is not a git repository")
  }

  const repoRoot = revParse.stdout.trim() || projectRootRealPath
  const show = await runGit(repoRoot, [
    "show",
    "--quiet",
    "--format=%H%x09%an%x09%aI%x09%s%n%b%n---FILES---",
    "--name-only",
    "--no-show-signature",
    hash,
  ])

  if (show.exitCode !== 0) {
    throw new ProjectGitError(404, "Commit not found")
  }

  return parseCommitDetail(show.stdout, hash)
}

export async function handleProjectGitRequest(req: Request, store: EventStore) {
  const url = new URL(req.url)
  const match = PROJECT_GIT_ROUTE.exec(url.pathname)
  if (!match?.groups) {
    return null
  }

  if (req.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET",
      },
    })
  }

  try {
    if (match.groups.resource === "commit") {
      const hash = url.searchParams.get("hash")?.trim()
      if (!hash) {
        return jsonError(400, "Missing commit hash")
      }
      return Response.json(await readProjectGitCommitDetail(store, match.groups.projectId, hash))
    }

    return Response.json(await readProjectGitSnapshot(store, match.groups.projectId))
  } catch (error) {
    if (error instanceof ProjectGitError) {
      return jsonError(error.status, error.message)
    }
    const message = error instanceof Error ? error.message : "Failed to read project git state"
    return jsonError(500, message)
  }
}
