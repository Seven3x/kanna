import type { ProjectGitCommitDetail, ProjectGitSnapshot } from "../../shared/project-git"

async function readProjectGitResponse<T>(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get("content-type") || ""
  const bodyText = await response.text()

  if (!response.ok) {
    let parsedError: string | null = null
    try {
      const payload = JSON.parse(bodyText) as { error?: unknown }
      if (typeof payload.error === "string" && payload.error.trim()) {
        parsedError = payload.error
      }
    } catch {
      parsedError = null
    }
    throw new Error(parsedError || bodyText || fallbackMessage)
  }

  if (!contentType.includes("application/json")) {
    throw new Error("Project git endpoint returned a non-JSON response.")
  }

  try {
    return JSON.parse(bodyText) as T
  } catch {
    throw new Error("Project git endpoint returned invalid JSON.")
  }
}

export async function fetchProjectGitSnapshot(projectId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/git`, { signal })
  return readProjectGitResponse<ProjectGitSnapshot>(response, "Failed to load git state")
}

export async function fetchProjectGitCommitDetail(projectId: string, hash: string, signal?: AbortSignal) {
  const search = new URLSearchParams({ hash })
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/git/commit?${search.toString()}`, { signal })
  return readProjectGitResponse<ProjectGitCommitDetail>(response, "Failed to load commit details")
}
