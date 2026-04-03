import type {
  ChatRuntime,
  ChatSnapshot,
  KannaStatus,
  LocalProjectsSnapshot,
  ProjectSkillSummary,
  SidebarChatRow,
  SidebarData,
  SidebarProjectGroup,
} from "../shared/types"
import type { ChatRecord, StoreState } from "./events"
import { discoverProjectSkills } from "./discovery"
import { resolveLocalPath } from "./paths"
import { SERVER_PROVIDERS } from "./provider-catalog"

function discoveredSkillsByPath(
  discoveredProjects: Array<{ localPath: string; skills?: ProjectSkillSummary[] }>
) {
  return new Map(
    discoveredProjects.map((project) => [resolveLocalPath(project.localPath), project.skills ?? []] as const)
  )
}

function resolveProjectSkills(
  projectLocalPath: string,
  skillsByPath: Map<string, ProjectSkillSummary[]>
) {
  const normalizedPath = resolveLocalPath(projectLocalPath)
  const discoveredSkills = skillsByPath.get(normalizedPath)
  if (discoveredSkills && discoveredSkills.length > 0) {
    return discoveredSkills
  }
  return discoverProjectSkills(normalizedPath)
}

export function deriveStatus(chat: ChatRecord, activeStatus?: KannaStatus): KannaStatus {
  if (activeStatus) return activeStatus
  if (chat.lastTurnOutcome === "failed") return "failed"
  return "idle"
}

export function deriveSidebarData(
  state: StoreState,
  activeStatuses: Map<string, KannaStatus>
): SidebarData {
  const projects = [...state.projectsById.values()]
    .filter((project) => !project.deletedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const projectGroups: SidebarProjectGroup[] = projects.map((project) => {
    const chats: SidebarChatRow[] = [...state.chatsById.values()]
      .filter((chat) => chat.projectId === project.id && !chat.deletedAt)
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt))
      .map((chat) => ({
        _id: chat.id,
        _creationTime: chat.createdAt,
        chatId: chat.id,
        title: chat.title,
        status: deriveStatus(chat, activeStatuses.get(chat.id)),
        unread: chat.unread,
        localPath: project.localPath,
        provider: chat.provider,
        lastMessageAt: chat.lastMessageAt,
        hasAutomation: false,
      }))

    return {
      groupKey: project.id,
      localPath: project.localPath,
      chats,
    }
  })

  return { projectGroups }
}

export function deriveLocalProjectsSnapshot(
  state: StoreState,
  discoveredProjects: Array<{ localPath: string; title: string; modifiedAt: number; skills?: ProjectSkillSummary[] }>,
  machineName: string
): LocalProjectsSnapshot {
  const projects = new Map<string, LocalProjectsSnapshot["projects"][number]>()
  const skillsByPath = discoveredSkillsByPath(discoveredProjects)

  for (const project of discoveredProjects) {
    const normalizedPath = resolveLocalPath(project.localPath)
    projects.set(normalizedPath, {
      localPath: normalizedPath,
      title: project.title,
      source: "discovered",
      lastOpenedAt: project.modifiedAt,
      chatCount: 0,
      skills: project.skills ?? [],
    })
  }

  for (const project of [...state.projectsById.values()].filter((entry) => !entry.deletedAt)) {
    const chats = [...state.chatsById.values()].filter((chat) => chat.projectId === project.id && !chat.deletedAt)
    const lastOpenedAt = chats.reduce(
      (latest, chat) => Math.max(latest, chat.lastMessageAt ?? chat.updatedAt ?? 0),
      project.updatedAt
    )

    projects.set(project.localPath, {
      localPath: project.localPath,
      title: project.title,
      source: "saved",
      lastOpenedAt,
      chatCount: chats.length,
      skills: resolveProjectSkills(project.localPath, skillsByPath),
    })
  }

  return {
    machine: {
      id: "local",
      displayName: machineName,
    },
    projects: [...projects.values()].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
  }
}

export function deriveChatSnapshot(
  state: StoreState,
  activeStatuses: Map<string, KannaStatus>,
  drainingChatIds: Set<string>,
  chatId: string,
  getMessages: (chatId: string) => ChatSnapshot["messages"],
  discoveredProjects: Array<{ localPath: string; title?: string; modifiedAt?: number; skills?: ProjectSkillSummary[] }> = []
): ChatSnapshot | null {
  const chat = state.chatsById.get(chatId)
  if (!chat || chat.deletedAt) return null
  const project = state.projectsById.get(chat.projectId)
  if (!project || project.deletedAt) return null
  const skillsByPath = discoveredSkillsByPath(discoveredProjects)

  const runtime: ChatRuntime = {
    chatId: chat.id,
    projectId: project.id,
    localPath: project.localPath,
    title: chat.title,
    status: deriveStatus(chat, activeStatuses.get(chat.id)),
    isDraining: drainingChatIds.has(chat.id),
    provider: chat.provider,
    planMode: chat.planMode,
    sessionToken: chat.sessionToken,
    skills: resolveProjectSkills(project.localPath, skillsByPath),
  }

  return {
    runtime,
    messages: getMessages(chat.id),
    availableProviders: [...SERVER_PROVIDERS],
  }
}
