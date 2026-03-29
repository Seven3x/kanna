import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { deriveChatSnapshot, deriveLocalProjectsSnapshot, deriveSidebarData } from "./read-models"
import { createEmptyState } from "./events"

const tempDirs: string[] = []
const originalHome = process.env.HOME

function makeTempDir() {
  const directory = mkdtempSync(path.join(tmpdir(), "kanna-read-models-"))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  process.env.HOME = originalHome
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("read models", () => {
  test("include provider data in sidebar rows", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Project",
      createdAt: 1,
      updatedAt: 1,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")
    state.chatsById.set("chat-1", {
      id: "chat-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 1,
      updatedAt: 1,
      provider: "codex",
      planMode: false,
      sessionToken: "thread-1",
      lastTurnOutcome: null,
      external: null,
    })

    const sidebar = deriveSidebarData(state, new Map())
    expect(sidebar.projectGroups[0]?.chats[0]?.provider).toBe("codex")
  })

  test("includes available providers in chat snapshots", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Project",
      createdAt: 1,
      updatedAt: 1,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")
    state.chatsById.set("chat-1", {
      id: "chat-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 1,
      updatedAt: 1,
      provider: "claude",
      planMode: true,
      sessionToken: "session-1",
      lastTurnOutcome: null,
      external: null,
    })

    const chat = deriveChatSnapshot(state, new Map(), "chat-1", () => [], [
      {
        localPath: "/tmp/project",
        title: "Project",
        modifiedAt: 1,
        skills: [{ name: "shadcn", source: "shadcn/ui", sourceType: "github" }],
      },
    ])
    expect(chat?.runtime.provider).toBe("claude")
    expect(chat?.runtime.skills).toEqual([{ name: "shadcn", source: "shadcn/ui", sourceType: "github" }])
    expect(chat?.availableProviders.length).toBeGreaterThan(1)
    expect(chat?.availableProviders.find((provider) => provider.id === "codex")?.models.map((model) => model.id)).toEqual([
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
    ])
  })

  test("prefers saved project metadata over discovered entries for the same path", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Saved Project",
      createdAt: 1,
      updatedAt: 50,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")
    state.chatsById.set("chat-1", {
      id: "chat-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 1,
      updatedAt: 75,
      provider: "codex",
      planMode: false,
      sessionToken: null,
      lastMessageAt: 100,
      lastTurnOutcome: null,
      external: null,
    })

    const snapshot = deriveLocalProjectsSnapshot(state, [
      {
        localPath: "/tmp/project",
        title: "Discovered Project",
        modifiedAt: 10,
        skills: [{ name: "shadcn", source: "shadcn/ui", sourceType: "github", scope: "project" }],
      },
    ], "Local Machine")

    expect(snapshot.projects).toEqual([
      {
        localPath: "/tmp/project",
        title: "Saved Project",
        source: "saved",
        lastOpenedAt: 100,
        chatCount: 1,
        skills: [{ name: "shadcn", source: "shadcn/ui", sourceType: "github", scope: "project" }],
      },
    ])
  })

  test("falls back to scanning skills for saved projects that were not discovered", () => {
    const state = createEmptyState()
    const homeDir = makeTempDir()
    process.env.HOME = homeDir
    const projectDir = path.join(homeDir, "manual-project")
    mkdirSync(path.join(projectDir, ".agents", "skills", "local-helper"), { recursive: true })
    mkdirSync(path.join(homeDir, ".codex", "skills", ".system", "openai-docs"), { recursive: true })
    writeFileSync(path.join(projectDir, "skills-lock.json"), JSON.stringify({
      version: 1,
      skills: {
        shadcn: {
          source: "shadcn/ui",
          sourceType: "github",
        },
      },
    }, null, 2))
    writeFileSync(path.join(projectDir, ".agents", "skills", "local-helper", "SKILL.md"), [
      "---",
      "name: local-helper",
      "description: Helps with local project workflows.",
      "---",
    ].join("\n"))
    writeFileSync(path.join(homeDir, ".codex", "skills", ".system", "openai-docs", "SKILL.md"), [
      "---",
      "name: openai-docs",
      "description: Official OpenAI docs helper.",
      "---",
    ].join("\n"))

    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: projectDir,
      title: "Manual Project",
      createdAt: 1,
      updatedAt: 50,
    })
    state.projectIdsByPath.set(projectDir, "project-1")
    state.chatsById.set("chat-1", {
      id: "chat-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 1,
      updatedAt: 75,
      provider: "codex",
      planMode: false,
      sessionToken: null,
      lastMessageAt: 100,
      lastTurnOutcome: null,
      external: null,
    })

    const snapshot = deriveLocalProjectsSnapshot(state, [], "Local Machine")
    const chat = deriveChatSnapshot(state, new Map(), "chat-1", () => [], [])

    expect(snapshot.projects[0]?.skills).toEqual([
      {
        name: "local-helper",
        description: "Helps with local project workflows.",
        scope: "project",
        filePath: path.join(projectDir, ".agents", "skills", "local-helper", "SKILL.md"),
        relativePath: ".agents/skills/local-helper/SKILL.md",
        pathDisplay: ".agents/skills/local-helper/SKILL.md",
      },
      {
        name: "openai-docs",
        description: "Official OpenAI docs helper.",
        scope: "global",
        filePath: path.join(homeDir, ".codex", "skills", ".system", "openai-docs", "SKILL.md"),
        pathDisplay: "~/.codex/skills/.system/openai-docs/SKILL.md",
      },
      {
        name: "shadcn",
        source: "shadcn/ui",
        sourceType: "github",
        scope: "project",
      },
    ])
    expect(chat?.runtime.skills).toEqual(snapshot.projects[0]?.skills)
  })
})
