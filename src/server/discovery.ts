import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { AgentProvider, ProjectSkillSummary } from "../shared/types"
import { resolveLocalPath } from "./paths"

export interface DiscoveredProject {
  localPath: string
  title: string
  modifiedAt: number
  skills?: ProjectSkillSummary[]
}

export interface ProviderDiscoveredProject extends DiscoveredProject {
  provider: AgentProvider
}

export interface ProjectDiscoveryAdapter {
  provider: AgentProvider
  scan(homeDir?: string): ProviderDiscoveredProject[]
}

function getEffectiveHomeDir(homeDir?: string) {
  return homeDir ?? process.env.HOME ?? homedir()
}

function resolveEncodedClaudePath(folderName: string) {
  const segments = folderName.replace(/^-/, "").split("-").filter(Boolean)
  let currentPath = ""
  let remainingSegments = [...segments]

  while (remainingSegments.length > 0) {
    let found = false

    for (let index = remainingSegments.length; index >= 1; index -= 1) {
      const segment = remainingSegments.slice(0, index).join("-")
      const candidate = `${currentPath}/${segment}`

      if (existsSync(candidate)) {
        currentPath = candidate
        remainingSegments = remainingSegments.slice(index)
        found = true
        break
      }
    }

    if (!found) {
      const [head, ...tail] = remainingSegments
      currentPath = `${currentPath}/${head}`
      remainingSegments = tail
    }
  }

  return currentPath || "/"
}

function normalizeExistingDirectory(localPath: string) {
  try {
    const normalized = resolveLocalPath(localPath)
    if (!statSync(normalized).isDirectory()) {
      return null
    }
    return normalized
  } catch {
    return null
  }
}

function mergeDiscoveredProjects(projects: Iterable<DiscoveredProject>): DiscoveredProject[] {
  const merged = new Map<string, DiscoveredProject>()

  for (const project of projects) {
    const existing = merged.get(project.localPath)
    if (!existing || project.modifiedAt > existing.modifiedAt) {
      const mergedSkills = mergeSkills(existing?.skills, project.skills)
      merged.set(project.localPath, {
        localPath: project.localPath,
        title: project.title || path.basename(project.localPath) || project.localPath,
        modifiedAt: project.modifiedAt,
        skills: mergedSkills,
      })
      continue
    }

    if (!existing.title && project.title) {
      existing.title = project.title
    }

    existing.skills = mergeSkills(existing.skills, project.skills)
  }

  return [...merged.values()].sort((a, b) => b.modifiedAt - a.modifiedAt)
}

function mergeSkills(
  existing: ProjectSkillSummary[] | undefined,
  incoming: ProjectSkillSummary[] | undefined
) {
  const byName = new Map<string, ProjectSkillSummary>()

  for (const skill of [...(existing ?? []), ...(incoming ?? [])]) {
    const current = byName.get(skill.name)
    if (!current) {
      byName.set(skill.name, { ...skill })
      continue
    }

    byName.set(skill.name, {
      name: current.name,
      description: current.description || skill.description,
      source: current.source || skill.source,
      sourceType: current.sourceType || skill.sourceType,
      scope: current.scope || skill.scope,
      relativePath: current.relativePath || skill.relativePath,
      filePath: current.filePath || skill.filePath,
      pathDisplay: current.pathDisplay || skill.pathDisplay,
    })
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeRelativePath(projectPath: string, targetPath: string) {
  return path.relative(projectPath, targetPath).split(path.sep).join("/")
}

function homeRelativePath(targetPath: string, homeDir?: string) {
  const normalizedHome = path.resolve(getEffectiveHomeDir(homeDir))
  const normalizedTarget = path.resolve(targetPath)
  if (normalizedTarget === normalizedHome) {
    return "~"
  }
  if (normalizedTarget.startsWith(`${normalizedHome}${path.sep}`)) {
    return `~/${path.relative(normalizedHome, normalizedTarget).split(path.sep).join("/")}`
  }
  return normalizedTarget
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function extractSkillDescription(markdown: string) {
  const lines = markdown.split(/\r?\n/)
  let index = 0

  if (lines[index]?.trim() === "---") {
    index += 1
    while (index < lines.length) {
      const line = lines[index]?.trim() ?? ""
      if (line === "---") {
        index += 1
        break
      }
      const descriptionMatch = line.match(/^description:\s*(.+)$/)
      if (descriptionMatch?.[1]) {
        return descriptionMatch[1].trim().replace(/^["']|["']$/g, "")
      }
      index += 1
    }
  }

  for (; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ""
    if (!line || line.startsWith("#") || line.startsWith(">") || line.startsWith("```")) {
      continue
    }
    return line
  }

  return undefined
}

function readSkillMarkdownFile(args: {
  skillName: string
  skillFilePath: string
  projectPath?: string
  scope: ProjectSkillSummary["scope"]
  homeDir?: string
}): ProjectSkillSummary | null {
  try {
    const markdown = readFileSync(args.skillFilePath, "utf8")
    return {
      name: args.skillName,
      description: extractSkillDescription(markdown),
      scope: args.scope,
      ...(args.projectPath
        ? {
            filePath: args.skillFilePath,
            relativePath: normalizeRelativePath(args.projectPath, args.skillFilePath),
            pathDisplay: normalizeRelativePath(args.projectPath, args.skillFilePath),
          }
        : {
            filePath: args.skillFilePath,
            pathDisplay: homeRelativePath(args.skillFilePath, args.homeDir),
          }),
    }
  } catch {
    return null
  }
}

function collectSkillMarkdownPaths(skillsDirectory: string): string[] {
  if (!existsSync(skillsDirectory)) {
    return []
  }

  const skills: string[] = []
  for (const entry of readdirSync(skillsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const entryPath = path.join(skillsDirectory, entry.name)
    const skillFilePath = path.join(entryPath, "SKILL.md")
    if (existsSync(skillFilePath)) {
      skills.push(skillFilePath)
    }
    skills.push(...collectSkillMarkdownPaths(entryPath))
  }
  return skills
}

function collectProjectSkillMarkdownFiles(projectPath: string, skillsDirectory: string): ProjectSkillSummary[] {
  return collectSkillMarkdownPaths(skillsDirectory)
    .map((skillFilePath) => readSkillMarkdownFile({
      skillName: path.basename(path.dirname(skillFilePath)),
      skillFilePath,
      projectPath,
      scope: "project",
    }))
    .filter((skill): skill is ProjectSkillSummary => Boolean(skill))
}

export function discoverGlobalSkills(homeDir?: string) {
  const effectiveHomeDir = getEffectiveHomeDir(homeDir)
  return mergeSkills(undefined, [
    ...collectSkillMarkdownPaths(path.join(effectiveHomeDir, ".codex", "skills")),
    ...collectSkillMarkdownPaths(path.join(effectiveHomeDir, ".agents", "skills")),
  ].map((skillFilePath) => readSkillMarkdownFile({
    skillName: path.basename(path.dirname(skillFilePath)),
    skillFilePath,
    scope: "global",
    homeDir: effectiveHomeDir,
  })).filter((skill): skill is ProjectSkillSummary => Boolean(skill)))
}

function readSkillsLock(projectPath: string): ProjectSkillSummary[] {
  const lockPath = path.join(projectPath, "skills-lock.json")
  if (!existsSync(lockPath)) {
    return []
  }

  try {
    const payload = JSON.parse(readFileSync(lockPath, "utf8"))
    const record = asRecord(payload)
    const skillsRecord = asRecord(record?.skills)
    if (!skillsRecord) {
      return []
    }

    return Object.entries(skillsRecord)
      .map(([name, value]) => {
        const skill = asRecord(value)
        return {
          name,
          source: typeof skill?.source === "string" ? skill.source : undefined,
          sourceType: typeof skill?.sourceType === "string" ? skill.sourceType : undefined,
          scope: "project",
        } satisfies ProjectSkillSummary
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

export function discoverProjectSkills(projectPath: string, homeDir?: string) {
  const effectiveHomeDir = getEffectiveHomeDir(homeDir)
  return mergeSkills(readSkillsLock(projectPath), [
    ...collectProjectSkillMarkdownFiles(projectPath, path.join(projectPath, ".agents", "skills")),
    ...collectProjectSkillMarkdownFiles(projectPath, path.join(projectPath, ".codex", "skills")),
    ...collectProjectSkillMarkdownFiles(projectPath, path.join(projectPath, ".claude", "skills")),
    ...discoverGlobalSkills(effectiveHomeDir),
  ])
}

export class ClaudeProjectDiscoveryAdapter implements ProjectDiscoveryAdapter {
  readonly provider = "claude" as const

  scan(homeDir?: string): ProviderDiscoveredProject[] {
    const effectiveHomeDir = getEffectiveHomeDir(homeDir)
    const projectsDir = path.join(effectiveHomeDir, ".claude", "projects")
    if (!existsSync(projectsDir)) {
      return []
    }

    const entries = readdirSync(projectsDir, { withFileTypes: true })
    const projects: ProviderDiscoveredProject[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const resolvedPath = resolveEncodedClaudePath(entry.name)
      const normalizedPath = normalizeExistingDirectory(resolvedPath)
      if (!normalizedPath) {
        continue
      }

      const stat = statSync(path.join(projectsDir, entry.name))
      projects.push({
        provider: this.provider,
        localPath: normalizedPath,
        title: path.basename(normalizedPath) || normalizedPath,
        modifiedAt: stat.mtimeMs,
        skills: discoverProjectSkills(normalizedPath, effectiveHomeDir),
      })
    }

    const mergedProjects = mergeDiscoveredProjects(projects).map((project) => ({
      provider: this.provider,
      ...project,
    }))

    return mergedProjects
  }
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function readCodexSessionIndex(indexPath: string) {
  const updatedAtById = new Map<string, number>()
  if (!existsSync(indexPath)) {
    return updatedAtById
  }

  for (const line of readFileSync(indexPath, "utf8").split("\n")) {
    if (!line.trim()) continue
    const record = parseJsonRecord(line)
    if (!record) continue

    const id = typeof record.id === "string" ? record.id : null
    const updatedAt = typeof record.updated_at === "string" ? Date.parse(record.updated_at) : Number.NaN
    if (!id || Number.isNaN(updatedAt)) continue

    const existing = updatedAtById.get(id)
    if (existing === undefined || updatedAt > existing) {
      updatedAtById.set(id, updatedAt)
    }
  }

  return updatedAtById
}

function collectCodexSessionFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectCodexSessionFiles(fullPath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath)
    }
  }
  return files
}

function readCodexConfiguredProjects(configPath: string) {
  const projects = new Map<string, number>()
  if (!existsSync(configPath)) {
    return projects
  }

  const configMtime = statSync(configPath).mtimeMs
  for (const line of readFileSync(configPath, "utf8").split("\n")) {
    const match = line.match(/^\[projects\."(.+)"\]$/)
    if (!match?.[1]) continue
    projects.set(match[1], configMtime)
  }

  return projects
}

function readCodexSessionMetadata(sessionsDir: string) {
  const metadataById = new Map<string, { cwd: string; modifiedAt: number }>()

  for (const sessionFile of collectCodexSessionFiles(sessionsDir)) {
    const fileStat = statSync(sessionFile)
    const firstLine = readFileSync(sessionFile, "utf8").split("\n", 1)[0]
    if (!firstLine?.trim()) continue

    const record = parseJsonRecord(firstLine)
    if (!record || record.type !== "session_meta") continue

    const payload = record.payload
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue

    const payloadRecord = payload as Record<string, unknown>
    const sessionId = typeof payloadRecord.id === "string" ? payloadRecord.id : null
    const cwd = typeof payloadRecord.cwd === "string" ? payloadRecord.cwd : null
    if (!sessionId || !cwd) continue

    const recordTimestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN
    const payloadTimestamp = typeof payloadRecord.timestamp === "string" ? Date.parse(payloadRecord.timestamp) : Number.NaN
    const modifiedAt = [recordTimestamp, payloadTimestamp, fileStat.mtimeMs].find((value) => !Number.isNaN(value)) ?? fileStat.mtimeMs

    metadataById.set(sessionId, { cwd, modifiedAt })
  }

  return metadataById
}

export class CodexProjectDiscoveryAdapter implements ProjectDiscoveryAdapter {
  readonly provider = "codex" as const

  scan(homeDir?: string): ProviderDiscoveredProject[] {
    const effectiveHomeDir = getEffectiveHomeDir(homeDir)
    const indexPath = path.join(effectiveHomeDir, ".codex", "session_index.jsonl")
    const sessionsDir = path.join(effectiveHomeDir, ".codex", "sessions")
    const configPath = path.join(effectiveHomeDir, ".codex", "config.toml")
    const updatedAtById = readCodexSessionIndex(indexPath)
    const metadataById = readCodexSessionMetadata(sessionsDir)
    const configuredProjects = readCodexConfiguredProjects(configPath)
    const projects: ProviderDiscoveredProject[] = []

    for (const [sessionId, metadata] of metadataById.entries()) {
      const modifiedAt = updatedAtById.get(sessionId) ?? metadata.modifiedAt
      const cwd = metadata.cwd
      if (!cwd) {
        continue
      }
      if (!path.isAbsolute(cwd)) {
        continue
      }

      const normalizedPath = normalizeExistingDirectory(cwd)
      if (!normalizedPath) {
        continue
      }

      projects.push({
        provider: this.provider,
        localPath: normalizedPath,
        title: path.basename(normalizedPath) || normalizedPath,
        modifiedAt,
        skills: discoverProjectSkills(normalizedPath, effectiveHomeDir),
      })
    }

    for (const [configuredPath, modifiedAt] of configuredProjects.entries()) {
      if (!path.isAbsolute(configuredPath)) {
        continue
      }

      const normalizedPath = normalizeExistingDirectory(configuredPath)
      if (!normalizedPath) {
        continue
      }

      projects.push({
        provider: this.provider,
        localPath: normalizedPath,
        title: path.basename(normalizedPath) || normalizedPath,
        modifiedAt,
        skills: discoverProjectSkills(normalizedPath, effectiveHomeDir),
      })
    }

    const mergedProjects = mergeDiscoveredProjects(projects).map((project) => ({
      provider: this.provider,
      ...project,
    }))

    return mergedProjects
  }
}

export const DEFAULT_PROJECT_DISCOVERY_ADAPTERS: ProjectDiscoveryAdapter[] = [
  new ClaudeProjectDiscoveryAdapter(),
  new CodexProjectDiscoveryAdapter(),
]

export function discoverProjects(
  homeDir: string = homedir(),
  adapters: ProjectDiscoveryAdapter[] = DEFAULT_PROJECT_DISCOVERY_ADAPTERS
): DiscoveredProject[] {
  const mergedProjects = mergeDiscoveredProjects(
    adapters.flatMap((adapter) => adapter.scan(homeDir).map(({ provider: _provider, ...project }) => project))
  )

  return mergedProjects
}
