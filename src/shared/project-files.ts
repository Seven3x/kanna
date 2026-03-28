export interface ProjectFileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number | null
  modifiedAt: number | null
}

export interface ProjectFileListResponse {
  projectId: string
  path: string
  entries: ProjectFileEntry[]
}

export type ProjectFilePreviewKind = "text" | "image" | "binary"

export interface ProjectFilePreviewResponse {
  projectId: string
  path: string
  name: string
  size: number
  modifiedAt: number
  contentType: string
  kind: ProjectFilePreviewKind
  truncated: boolean
  content: string | null
}
