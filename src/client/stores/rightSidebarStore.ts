import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface ProjectRightSidebarLayout {
  isVisible: boolean
  size: number
}

export interface ProjectRightSidebarUiState {
  viewMode: "changes" | "history"
  collapsedPaths: Record<string, boolean>
  summary: string
  description: string
}

interface RightSidebarState {
  projects: Record<string, ProjectRightSidebarLayout>
  projectUi: Record<string, ProjectRightSidebarUiState>
  toggleVisibility: (projectId: string) => void
  setSize: (projectId: string, size: number) => void
  reconcileCollapsedPaths: (projectId: string, paths: string[]) => void
  toggleCollapsedPath: (projectId: string, path: string) => void
  setViewMode: (projectId: string, viewMode: ProjectRightSidebarUiState["viewMode"]) => void
  setCommitDraft: (projectId: string, draft: Pick<ProjectRightSidebarUiState, "summary" | "description">) => void
  clearCommitDraft: (projectId: string) => void
  clearProject: (projectId: string) => void
}

export const RIGHT_SIDEBAR_MIN_SIZE_PERCENT = 20
export const DEFAULT_RIGHT_SIDEBAR_SIZE = 30
export const RIGHT_SIDEBAR_MIN_WIDTH_PX = 370

function clampSize(size: number) {
  if (!Number.isFinite(size)) return DEFAULT_RIGHT_SIDEBAR_SIZE
  return Math.max(RIGHT_SIDEBAR_MIN_SIZE_PERCENT, size)
}

function createDefaultProjectLayout(): ProjectRightSidebarLayout {
  return {
    isVisible: false,
    size: RIGHT_SIDEBAR_MIN_SIZE_PERCENT,
  }
}

function createDefaultProjectUiState(): ProjectRightSidebarUiState {
  return {
    viewMode: "history",
    collapsedPaths: {},
    summary: "",
    description: "",
  }
}

function getProjectLayout(projects: Record<string, ProjectRightSidebarLayout>, projectId: string): ProjectRightSidebarLayout {
  return projects[projectId] ?? createDefaultProjectLayout()
}

export function migrateRightSidebarStore(persistedState: unknown) {
  if (!persistedState || typeof persistedState !== "object") {
  return { projects: {}, projectUi: {} }
  }

  const state = persistedState as { projects?: Record<string, Partial<ProjectRightSidebarLayout>> }
  const projects = Object.fromEntries(
    Object.entries(state.projects ?? {}).map(([projectId, layout]) => [
      projectId,
      {
        isVisible: false,
        size: clampSize(layout.size ?? DEFAULT_RIGHT_SIDEBAR_SIZE),
      },
    ])
  )

  return { projects, projectUi: {} }
}

export const useRightSidebarStore = create<RightSidebarState>()(
  persist(
    (set) => ({
      projects: {},
      projectUi: {},
      toggleVisibility: (projectId) =>
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...getProjectLayout(state.projects, projectId),
              isVisible: !getProjectLayout(state.projects, projectId).isVisible,
            },
          },
        })),
      setSize: (projectId, size) =>
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...getProjectLayout(state.projects, projectId),
              size: clampSize(size),
            },
          },
        })),
      reconcileCollapsedPaths: (projectId, paths) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        const nextCollapsedPaths = Object.fromEntries(paths.map((path) => [path, current.collapsedPaths[path] ?? true]))
        if (
          Object.keys(current.collapsedPaths).length === Object.keys(nextCollapsedPaths).length
          && Object.entries(nextCollapsedPaths).every(([path, collapsed]) => current.collapsedPaths[path] === collapsed)
        ) {
          return state
        }
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              collapsedPaths: nextCollapsedPaths,
            },
          },
        }
      }),
      toggleCollapsedPath: (projectId, path) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              collapsedPaths: {
                ...current.collapsedPaths,
                [path]: !(current.collapsedPaths[path] ?? true),
              },
            },
          },
        }
      }),
      setViewMode: (projectId, viewMode) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        if (current.viewMode === viewMode) return state
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              viewMode,
            },
          },
        }
      }),
      setCommitDraft: (projectId, draft) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        if (current.summary === draft.summary && current.description === draft.description) return state
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              summary: draft.summary,
              description: draft.description,
            },
          },
        }
      }),
      clearCommitDraft: (projectId) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        if (!current.summary && !current.description) return state
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              summary: "",
              description: "",
            },
          },
        }
      }),
      clearProject: (projectId) =>
        set((state) => {
          const { [projectId]: _removedLayout, ...restProjects } = state.projects
          const { [projectId]: _removedUi, ...restProjectUi } = state.projectUi
          return { projects: restProjects, projectUi: restProjectUi }
        }),
    }),
    {
      name: "right-sidebar-layouts",
      version: 3,
      migrate: migrateRightSidebarStore,
    }
  )
)

export const DEFAULT_PROJECT_RIGHT_SIDEBAR_LAYOUT: ProjectRightSidebarLayout = {
  isVisible: false,
  size: 33,
}

export function getDefaultProjectRightSidebarLayout() {
  return {
    ...DEFAULT_PROJECT_RIGHT_SIDEBAR_LAYOUT,
  }
}
