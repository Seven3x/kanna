import { beforeEach, describe, expect, test } from "bun:test"
import { getDefaultProjectRightSidebarLayout, migrateRightSidebarStore, RIGHT_SIDEBAR_MIN_WIDTH_PX, useRightSidebarStore } from "./rightSidebarStore"

const PROJECT_ID = "project-1"

describe("rightSidebarStore", () => {
  beforeEach(() => {
    useRightSidebarStore.setState({ projects: {}, projectUi: {} })
  })

  test("defaults to a closed drawer", () => {
    const layout = useRightSidebarStore.getState().projects[PROJECT_ID] ?? getDefaultProjectRightSidebarLayout()
    expect(layout.isVisible).toBe(false)
    expect(layout.size).toBe(33)
  })

  test("exports the expected pixel min width", () => {
    expect(RIGHT_SIDEBAR_MIN_WIDTH_PX).toBe(370)
  })

  test("keeps layouts isolated per project", () => {
    useRightSidebarStore.getState().toggleVisibility(PROJECT_ID)
    useRightSidebarStore.getState().setSize(PROJECT_ID, 34)
    useRightSidebarStore.getState().toggleVisibility("project-2")
    useRightSidebarStore.getState().setSize("project-2", 26)

    expect(useRightSidebarStore.getState().projects[PROJECT_ID]).toEqual({
      isVisible: true,
      size: 34,
    })
    expect(useRightSidebarStore.getState().projects["project-2"]).toEqual({
      isVisible: true,
      size: 26,
    })
  })

  test("clamps resized widths", () => {
    useRightSidebarStore.getState().setSize(PROJECT_ID, 4)
    expect(useRightSidebarStore.getState().projects[PROJECT_ID]?.size).toBe(20)

    useRightSidebarStore.getState().setSize(PROJECT_ID, 80)
    expect(useRightSidebarStore.getState().projects[PROJECT_ID]?.size).toBe(80)
  })

  test("clearing a project removes its saved drawer state", () => {
    useRightSidebarStore.getState().toggleVisibility(PROJECT_ID)
    useRightSidebarStore.getState().setViewMode(PROJECT_ID, "changes")
    useRightSidebarStore.getState().clearProject(PROJECT_ID)

    const layout = useRightSidebarStore.getState().projects[PROJECT_ID] ?? getDefaultProjectRightSidebarLayout()
    expect(layout.isVisible).toBe(false)
    expect(layout.size).toBe(33)
    expect(useRightSidebarStore.getState().projectUi[PROJECT_ID]).toBeUndefined()
  })

  test("migration closes persisted sidebars while preserving valid sizes", async () => {
    const migrated = await migrateRightSidebarStore({
        projects: {
          [PROJECT_ID]: {
            isVisible: true,
            size: 34,
          },
        },
      })

    expect(migrated).toEqual({
      projects: {
        [PROJECT_ID]: {
          isVisible: false,
          size: 34,
        },
      },
      projectUi: {},
    })
  })

  test("keeps sidebar ui state isolated per project", () => {
    useRightSidebarStore.getState().setViewMode(PROJECT_ID, "changes")
    useRightSidebarStore.getState().setCommitDraft(PROJECT_ID, { summary: "feat: one", description: "body" })
    useRightSidebarStore.getState().reconcileCollapsedPaths(PROJECT_ID, ["a.ts"])
    useRightSidebarStore.getState().toggleCollapsedPath(PROJECT_ID, "a.ts")

    useRightSidebarStore.getState().setViewMode("project-2", "history")
    useRightSidebarStore.getState().setCommitDraft("project-2", { summary: "feat: two", description: "" })

    expect(useRightSidebarStore.getState().projectUi[PROJECT_ID]).toEqual({
      viewMode: "changes",
      summary: "feat: one",
      description: "body",
      collapsedPaths: { "a.ts": false },
    })
    expect(useRightSidebarStore.getState().projectUi["project-2"]).toEqual({
      viewMode: "history",
      summary: "feat: two",
      description: "",
      collapsedPaths: {},
    })
  })
})
