import { lstat, open, readdir, realpath, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  ProjectFileListResponse,
  ProjectFilePreviewKind,
  ProjectFilePreviewResponse,
  ProjectFileUploadResponse,
} from "../shared/project-files"
import { resolveLocalPath } from "./paths"
import { EventStore } from "./event-store"

const PROJECT_FILE_ROUTE = /^\/api\/projects\/(?<projectId>[^/]+)\/(?<resource>files|preview|raw)$/
const MAX_PREVIEW_BYTES = 128 * 1024

class ProjectFileError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

interface ResolvedProjectPath {
  projectId: string
  projectRoot: string
  projectRootRealPath: string
  relativePath: string
  absolutePath: string
  info: Awaited<ReturnType<typeof stat>>
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status })
}

function normalizeRelativeProjectPath(rawPath: string | null) {
  const trimmed = (rawPath ?? "").trim().replaceAll("\\", "/")
  if (!trimmed || trimmed === "." || trimmed === "/") {
    return ""
  }

  const normalized = path.posix.normalize(trimmed)
  const withoutLeadingSlash = normalized.replace(/^\/+/, "")
  if (!withoutLeadingSlash || withoutLeadingSlash === ".") {
    return ""
  }
  if (withoutLeadingSlash === ".." || withoutLeadingSlash.startsWith("../")) {
    throw new ProjectFileError(400, "Invalid file path")
  }

  return withoutLeadingSlash
}

function isWithinRoot(rootPath: string, targetPath: string) {
  const relative = path.relative(rootPath, targetPath)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function getProjectRoot(store: EventStore, projectId: string) {
  const project = store.getProject(projectId)
  if (!project) {
    throw new ProjectFileError(404, "Project not found")
  }

  const projectRoot = resolveLocalPath(project.localPath)
  const info = await stat(projectRoot).catch(() => null)
  if (!info?.isDirectory()) {
    throw new ProjectFileError(404, "Project directory not found")
  }

  return {
    projectId,
    projectRoot,
    projectRootRealPath: await realpath(projectRoot),
  }
}

async function resolveProjectPath(
  store: EventStore,
  projectId: string,
  rawPath: string | null,
  expectedType?: "file" | "directory",
): Promise<ResolvedProjectPath> {
  const { projectRoot, projectRootRealPath } = await getProjectRoot(store, projectId)
  const relativePath = normalizeRelativeProjectPath(rawPath)
  const absolutePath = path.resolve(projectRoot, relativePath || ".")
  const info = await stat(absolutePath).catch(() => null)
  if (!info) {
    throw new ProjectFileError(404, "File not found")
  }

  const absoluteRealPath = await realpath(absolutePath)
  if (!isWithinRoot(projectRootRealPath, absoluteRealPath)) {
    throw new ProjectFileError(403, "File is outside the project root")
  }

  if (expectedType === "file" && !info.isFile()) {
    throw new ProjectFileError(400, "Path must be a file")
  }
  if (expectedType === "directory" && !info.isDirectory()) {
    throw new ProjectFileError(400, "Path must be a directory")
  }

  return {
    projectId,
    projectRoot,
    projectRootRealPath,
    relativePath,
    absolutePath,
    info,
  }
}

function compareEntries(
  left: Pick<ProjectFileListResponse["entries"][number], "isDirectory" | "name">,
  right: Pick<ProjectFileListResponse["entries"][number], "isDirectory" | "name">,
) {
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1
  }
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
}

export async function listProjectDirectory(
  store: EventStore,
  projectId: string,
  rawPath: string | null,
): Promise<ProjectFileListResponse> {
  const { projectRootRealPath, relativePath, absolutePath } = await resolveProjectPath(store, projectId, rawPath, "directory")
  const children = await readdir(absolutePath, { withFileTypes: true })
  const entries = await Promise.all(children.map(async (entry) => {
    const entryRelativePath = relativePath ? path.posix.join(relativePath, entry.name) : entry.name
    const entryAbsolutePath = path.join(absolutePath, entry.name)
    const entryInfo = await lstat(entryAbsolutePath).catch(() => null)
    if (!entryInfo || entryInfo.isSymbolicLink()) {
      return null
    }

    const realEntryPath = await realpath(entryAbsolutePath).catch(() => null)
    if (!realEntryPath || !isWithinRoot(projectRootRealPath, realEntryPath)) {
      return null
    }

    return {
      name: entry.name,
      path: entryRelativePath,
      isDirectory: entryInfo.isDirectory(),
      size: entryInfo.isDirectory() ? null : entryInfo.size,
      modifiedAt: entryInfo.mtimeMs || null,
    }
  }))

  return {
    projectId,
    path: relativePath,
    entries: entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null).sort(compareEntries),
  }
}

function detectPreviewKind(contentType: string, bytes: Uint8Array): ProjectFilePreviewKind {
  if (contentType.startsWith("image/")) {
    return "image"
  }

  if (contentType.startsWith("text/")) {
    return "text"
  }

  for (const byte of bytes) {
    if (byte === 0) {
      return "binary"
    }
  }

  let controlBytes = 0
  for (const byte of bytes) {
    if (byte <= 8 || (byte >= 14 && byte <= 31)) {
      controlBytes += 1
    }
  }

  return bytes.length === 0 || controlBytes / bytes.length < 0.1 ? "text" : "binary"
}

async function readPreviewBytes(filePath: string) {
  const file = await open(filePath, "r")
  try {
    const buffer = Buffer.alloc(MAX_PREVIEW_BYTES + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

export async function previewProjectFile(
  store: EventStore,
  projectId: string,
  rawPath: string | null,
): Promise<ProjectFilePreviewResponse> {
  const { relativePath, absolutePath, info } = await resolveProjectPath(store, projectId, rawPath, "file")
  const bytes = await readPreviewBytes(absolutePath)
  const contentType = Bun.file(absolutePath).type || "application/octet-stream"
  const kind = detectPreviewKind(contentType, bytes)

  return {
    projectId,
    path: relativePath,
    name: path.basename(absolutePath),
    size: Number(info.size),
    modifiedAt: Number(info.mtimeMs),
    contentType,
    kind,
    truncated: Number(info.size) > MAX_PREVIEW_BYTES,
    content: kind === "text" ? new TextDecoder().decode(bytes.subarray(0, MAX_PREVIEW_BYTES)) : null,
  }
}

function encodeContentDispositionFilename(filename: string) {
  return encodeURIComponent(filename).replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29")
}

export async function readProjectFileResponse(
  store: EventStore,
  projectId: string,
  rawPath: string | null,
  download: boolean,
) {
  const { absolutePath, info } = await resolveProjectPath(store, projectId, rawPath, "file")
  const filename = path.basename(absolutePath)
  const contentType = Bun.file(absolutePath).type || "application/octet-stream"
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Length": String(Number(info.size)),
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeContentDispositionFilename(filename)}`,
  })

  return new Response(Bun.file(absolutePath), {
    headers,
  })
}

function normalizeUploadFilename(filename: string) {
  const trimmed = filename.trim()
  if (!trimmed) {
    throw new ProjectFileError(400, "Uploaded file is missing a name")
  }

  const baseName = path.posix.basename(trimmed.replaceAll("\\", "/"))
  if (!baseName || baseName === "." || baseName === "..") {
    throw new ProjectFileError(400, "Uploaded file has an invalid name")
  }

  return baseName
}

export async function uploadProjectFiles(
  store: EventStore,
  projectId: string,
  rawPath: string | null,
  formData: FormData,
): Promise<ProjectFileUploadResponse> {
  const { relativePath, absolutePath } = await resolveProjectPath(store, projectId, rawPath, "directory")
  const files = formData.getAll("files")
  if (files.length === 0) {
    throw new ProjectFileError(400, "No files were provided")
  }

  const uploaded: string[] = []

  for (const entry of files) {
    if (!(entry instanceof File)) {
      throw new ProjectFileError(400, "Invalid upload payload")
    }

    const fileName = normalizeUploadFilename(entry.name)
    const targetPath = path.join(absolutePath, fileName)
    const relativeTargetPath = relativePath ? path.posix.join(relativePath, fileName) : fileName
    await writeFile(targetPath, new Uint8Array(await entry.arrayBuffer()))
    uploaded.push(relativeTargetPath)
  }

  return {
    projectId,
    path: relativePath,
    uploaded,
  }
}

export async function handleProjectFilesRequest(req: Request, store: EventStore) {
  const url = new URL(req.url)
  const match = PROJECT_FILE_ROUTE.exec(url.pathname)
  if (!match?.groups) {
    return null
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET, POST",
      },
    })
  }

  try {
    const { projectId, resource } = match.groups
    const rawPath = url.searchParams.get("path")

    if (resource === "files") {
      if (req.method === "POST") {
        return Response.json(await uploadProjectFiles(store, projectId, rawPath, await req.formData()))
      }
      return Response.json(await listProjectDirectory(store, projectId, rawPath))
    }
    if (req.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: "GET",
        },
      })
    }
    if (resource === "preview") {
      return Response.json(await previewProjectFile(store, projectId, rawPath))
    }
    return await readProjectFileResponse(store, projectId, rawPath, url.searchParams.get("download") === "1")
  } catch (error) {
    if (error instanceof ProjectFileError) {
      return jsonError(error.status, error.message)
    }
    const message = error instanceof Error ? error.message : "Failed to read project file"
    return jsonError(500, message)
  }
}
