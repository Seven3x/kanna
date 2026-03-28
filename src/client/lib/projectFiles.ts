import type { ProjectFileListResponse, ProjectFilePreviewResponse } from "../../shared/project-files"

function withPathQuery(basePath: string, filePath?: string) {
  if (!filePath) {
    return basePath
  }
  const search = new URLSearchParams({ path: filePath })
  return `${basePath}?${search.toString()}`
}

export function buildProjectFileListUrl(projectId: string, filePath = "") {
  return withPathQuery(`/api/projects/${encodeURIComponent(projectId)}/files`, filePath)
}

export function buildProjectFilePreviewUrl(projectId: string, filePath: string) {
  return withPathQuery(`/api/projects/${encodeURIComponent(projectId)}/preview`, filePath)
}

export function buildProjectFileRawUrl(projectId: string, filePath: string, download = false) {
  const basePath = withPathQuery(`/api/projects/${encodeURIComponent(projectId)}/raw`, filePath)
  return download
    ? `${basePath}${basePath.includes("?") ? "&" : "?"}download=1`
    : basePath
}

async function readProjectFilesResponse<T>(response: Response, fallbackMessage: string) {
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
    throw new Error("Project files endpoint returned a non-JSON response. Restart the dev server and try again.")
  }

  try {
    return JSON.parse(bodyText) as T
  } catch {
    throw new Error("Project files endpoint returned invalid JSON.")
  }
}

export async function fetchProjectFileList(projectId: string, filePath = "", signal?: AbortSignal) {
  const response = await fetch(buildProjectFileListUrl(projectId, filePath), { signal })
  return readProjectFilesResponse<ProjectFileListResponse>(response, "Failed to load files")
}

export async function fetchProjectFilePreview(projectId: string, filePath: string, signal?: AbortSignal) {
  const response = await fetch(buildProjectFilePreviewUrl(projectId, filePath), { signal })
  return readProjectFilesResponse<ProjectFilePreviewResponse>(response, "Failed to preview file")
}

export function getProjectRelativeFilePath(projectRoot: string | undefined | null, filePath: string | undefined | null) {
  if (!projectRoot || !filePath) {
    return null
  }

  if (filePath === projectRoot) {
    return ""
  }

  const normalizedRoot = projectRoot.endsWith("/") ? projectRoot : `${projectRoot}/`
  return filePath.startsWith(normalizedRoot) ? filePath.slice(normalizedRoot.length) : null
}

export function getParentProjectFilePath(filePath: string) {
  if (!filePath) {
    return ""
  }
  const parts = filePath.split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

export function getProjectFileName(filePath: string) {
  const parts = filePath.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? filePath
}

export function resolveProjectLocalFilePath(projectRoot: string, filePath: string) {
  const normalizedRoot = projectRoot.endsWith("/") ? projectRoot.slice(0, -1) : projectRoot
  return filePath ? `${normalizedRoot}/${filePath}` : normalizedRoot
}
