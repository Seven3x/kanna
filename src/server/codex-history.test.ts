import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { CodexHistoryImporter } from "./codex-history"
import { EventStore } from "./event-store"

const tempDirs: string[] = []

function makeTempDir(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

function writeSession(args: {
  homeDir: string
  sessionId: string
  cwd: string
  threadName?: string
  sessionMeta?: Record<string, unknown>
  fileName?: string
  body?: string[]
}) {
  const sessionsDir = path.join(args.homeDir, ".codex", "sessions", "2026", "03", "27")
  mkdirSync(sessionsDir, { recursive: true })
  mkdirSync(path.join(args.homeDir, ".codex"), { recursive: true })

  writeFileSync(path.join(args.homeDir, ".codex", "session_index.jsonl"), [
    JSON.stringify({
      id: args.sessionId,
      thread_name: args.threadName ?? "Imported thread",
      updated_at: "2026-03-27T09:05:46.532Z",
    }),
  ].join("\n"))

  const filePath = path.join(sessionsDir, args.fileName ?? `rollout-2026-03-27T09-05-46-${args.sessionId}.jsonl`)
  writeFileSync(filePath, [
    JSON.stringify({
      timestamp: "2026-03-27T09:05:46.000Z",
      type: "session_meta",
      payload: {
        id: args.sessionId,
        timestamp: "2026-03-27T09:05:45.000Z",
        cwd: args.cwd,
        source: "vscode",
        ...(args.sessionMeta ?? {}),
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-27T09:05:47.000Z",
      type: "turn_context",
      payload: {
        model: "gpt-5.4",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-27T09:05:48.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "Inspect the failing test.",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-27T09:05:49.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "pwd" }),
        call_id: "call-1",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-27T09:05:50.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: "Command output",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-27T09:05:51.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "I found the issue.",
          },
        ],
      },
    }),
    ...(args.body ?? []),
  ].join("\n"))

  return filePath
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("CodexHistoryImporter", () => {
  test("imports one Codex session into a persisted Kanna chat", async () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const dataDir = makeTempDir("kanna-codex-data-")
    const projectDir = path.join(homeDir, "workspace", "alpha")
    mkdirSync(projectDir, { recursive: true })
    writeSession({
      homeDir,
      sessionId: "session-1",
      cwd: projectDir,
      threadName: "Imported session title",
    })

    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject(projectDir)

    const importer = new CodexHistoryImporter(homeDir)
    const result = await importer.importSessionsForProject(project.localPath, project.id, store)

    expect(result.scannedSessionCount).toBe(1)
    expect(result.importedChatCount).toBe(1)
    expect(store.listChatsByProject(project.id)).toHaveLength(1)

    const chat = store.listChatsByProject(project.id)[0]!
    expect(chat.title).toBe("Imported session title")
    expect(chat.provider).toBe("codex")
    expect(chat.sessionToken).toBe("session-1")
    expect(chat.external?.externalSessionId).toBe("session-1")

    const messages = store.getMessages(chat.id)
    expect(messages.map((entry) => entry.kind)).toEqual([
      "system_init",
      "user_prompt",
      "tool_call",
      "tool_result",
      "assistant_text",
    ])

    const messagesLog = readFileSync(path.join(dataDir, "messages.jsonl"), "utf8")
    expect(messagesLog).toBe("")

    const transcriptFile = readFileSync(path.join(dataDir, "transcripts", `${chat.id}.jsonl`), "utf8")
    expect(transcriptFile).toContain("\"kind\":\"assistant_text\"")
  })

  test("re-importing the same session is idempotent", async () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const dataDir = makeTempDir("kanna-codex-data-")
    const projectDir = path.join(homeDir, "workspace", "beta")
    mkdirSync(projectDir, { recursive: true })
    writeSession({
      homeDir,
      sessionId: "session-2",
      cwd: projectDir,
    })

    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject(projectDir)
    const importer = new CodexHistoryImporter(homeDir)

    await importer.importSessionsForProject(project.localPath, project.id, store)
    const firstChat = store.listChatsByProject(project.id)[0]!
    const firstMessageCount = store.getMessages(firstChat.id).length

    const secondResult = await importer.importSessionsForProject(project.localPath, project.id, store)

    expect(secondResult.importedChatCount).toBe(0)
    expect(secondResult.appendedEntryCount).toBe(0)
    expect(store.listChatsByProject(project.id)).toHaveLength(1)
    expect(store.getMessages(firstChat.id)).toHaveLength(firstMessageCount)
  })

  test("incrementally appends new transcript entries on re-import", async () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const dataDir = makeTempDir("kanna-codex-data-")
    const projectDir = path.join(homeDir, "workspace", "gamma")
    mkdirSync(projectDir, { recursive: true })
    const sessionFile = writeSession({
      homeDir,
      sessionId: "session-3",
      cwd: projectDir,
    })

    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject(projectDir)
    const importer = new CodexHistoryImporter(homeDir)

    await importer.importSessionsForProject(project.localPath, project.id, store)
    const chat = store.listChatsByProject(project.id)[0]!
    const beforeCount = store.getMessages(chat.id).length

    writeFileSync(sessionFile, `${readFileSync(sessionFile, "utf8")}\n${JSON.stringify({
      timestamp: "2026-03-27T09:05:52.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Added one more imported message.",
          },
        ],
      },
    })}`)

    const secondResult = await importer.importSessionsForProject(project.localPath, project.id, store)

    expect(secondResult.importedChatCount).toBe(0)
    expect(secondResult.appendedEntryCount).toBe(1)
    expect(store.getMessages(chat.id)).toHaveLength(beforeCount + 1)
    expect(store.getMessages(chat.id).at(-1)?.kind).toBe("assistant_text")
  })

  test("skips sessions whose cwd does not match the opened project", async () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const dataDir = makeTempDir("kanna-codex-data-")
    const projectDir = path.join(homeDir, "workspace", "delta")
    const otherDir = path.join(homeDir, "workspace", "other")
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(otherDir, { recursive: true })
    writeSession({
      homeDir,
      sessionId: "session-4",
      cwd: otherDir,
    })

    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject(projectDir)
    const importer = new CodexHistoryImporter(homeDir)

    const result = await importer.importSessionsForProject(project.localPath, project.id, store)

    expect(result.scannedSessionCount).toBe(0)
    expect(store.listChatsByProject(project.id)).toHaveLength(0)
  })

  test("best-effort imports survive bad JSON and unknown record types", async () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const dataDir = makeTempDir("kanna-codex-data-")
    const projectDir = path.join(homeDir, "workspace", "epsilon")
    mkdirSync(projectDir, { recursive: true })
    writeSession({
      homeDir,
      sessionId: "session-5",
      cwd: projectDir,
      body: [
        "{this is not valid json",
        JSON.stringify({
          timestamp: "2026-03-27T09:05:52.000Z",
          type: "response_item",
          payload: {
            type: "local_shell_call",
            command: "ls",
          },
        }),
      ],
    })

    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject(projectDir)
    const importer = new CodexHistoryImporter(homeDir)

    const result = await importer.importSessionsForProject(project.localPath, project.id, store)

    expect(result.importedChatCount).toBe(1)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(store.listChatsByProject(project.id)).toHaveLength(1)
    expect(store.getMessages(store.listChatsByProject(project.id)[0]!.id).some((entry) => entry.kind === "assistant_text")).toBe(true)
  })

  test("skips subagent notification user messages embedded in parent threads", async () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const dataDir = makeTempDir("kanna-codex-data-")
    const projectDir = path.join(homeDir, "workspace", "zeta")
    mkdirSync(projectDir, { recursive: true })
    writeSession({
      homeDir,
      sessionId: "session-6",
      cwd: projectDir,
      body: [
        JSON.stringify({
          timestamp: "2026-03-27T09:05:52.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "<subagent_notification>\n{\"status\":{\"completed\":\"Nested agent summary\"}}\n</subagent_notification>",
          },
        }),
      ],
    })

    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject(projectDir)
    const importer = new CodexHistoryImporter(homeDir)

    await importer.importSessionsForProject(project.localPath, project.id, store)

    const chat = store.listChatsByProject(project.id)[0]!
    const messages = store.getMessages(chat.id)

    expect(messages.map((entry) => entry.kind)).toEqual([
      "system_init",
      "user_prompt",
      "tool_call",
      "tool_result",
      "assistant_text",
    ])
    expect(messages.some((entry) => entry.kind === "user_prompt" && entry.content.includes("subagent_notification"))).toBe(false)
  })

  test("skips imported subagent child sessions", async () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const dataDir = makeTempDir("kanna-codex-data-")
    const projectDir = path.join(homeDir, "workspace", "eta")
    mkdirSync(projectDir, { recursive: true })
    writeSession({
      homeDir,
      sessionId: "session-7-parent",
      cwd: projectDir,
      threadName: "Parent thread",
    })
    writeSession({
      homeDir,
      sessionId: "session-7-child",
      cwd: projectDir,
      threadName: "Child thread",
      sessionMeta: {
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "session-7-parent",
              depth: 1,
              agent_nickname: "Euler",
              agent_role: "explorer",
            },
          },
        },
      },
    })

    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject(projectDir)
    const importer = new CodexHistoryImporter(homeDir)

    const result = await importer.importSessionsForProject(project.localPath, project.id, store)

    expect(result.scannedSessionCount).toBe(1)
    expect(result.importedChatCount).toBe(1)
    expect(store.listChatsByProject(project.id)).toHaveLength(1)
    expect(store.listChatsByProject(project.id)[0]?.sessionToken).toBe("session-7-parent")
  })

  test("skips internal Codex title-generation sessions", async () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const dataDir = makeTempDir("kanna-codex-data-")
    const projectDir = path.join(homeDir, "workspace", "theta")
    mkdirSync(projectDir, { recursive: true })
    writeSession({
      homeDir,
      sessionId: "session-8-titlegen",
      cwd: projectDir,
      threadName: "Title generator",
      body: [],
    })

    const sessionPath = path.join(homeDir, ".codex", "sessions", "2026", "03", "27", "rollout-2026-03-27T09-05-46-session-8-titlegen.jsonl")
    writeFileSync(sessionPath, [
      JSON.stringify({
        timestamp: "2026-03-27T09:05:46.000Z",
        type: "session_meta",
        payload: {
          id: "session-8-titlegen",
          timestamp: "2026-03-27T09:05:45.000Z",
          cwd: projectDir,
          source: "vscode",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-27T09:05:47.000Z",
        type: "turn_context",
        payload: {
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-27T09:05:48.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Generate a short, descriptive title (under 30 chars) for a conversation that starts with this message.\n\n阅读当前目录下的md文件\n\nReturn JSON only that matches this schema:\n{\"type\":\"object\"}",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-27T09:05:49.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "{\"title\":\"阅读当前目录MD文件\"}",
            },
          ],
        },
      }),
    ].join("\n"))

    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject(projectDir)
    const importer = new CodexHistoryImporter(homeDir)

    const result = await importer.importSessionsForProject(project.localPath, project.id, store)

    expect(result.scannedSessionCount).toBe(0)
    expect(result.importedChatCount).toBe(0)
    expect(store.listChatsByProject(project.id)).toHaveLength(0)
  })

  test("drops leaked child transcript suffix after interruption in parent session", async () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const dataDir = makeTempDir("kanna-codex-data-")
    const projectDir = path.join(homeDir, "workspace", "iota")
    mkdirSync(projectDir, { recursive: true })
    writeSession({
      homeDir,
      sessionId: "session-9-parent",
      cwd: projectDir,
      threadName: "Parent thread",
      body: [
        JSON.stringify({
          timestamp: "2026-03-27T09:06:00.000Z",
          type: "event_msg",
          payload: {
            type: "turn_aborted",
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-27T09:05:40.000Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-child",
            output: "You are the newly spawned agent. The prior conversation history was forked from your parent agent. Treat the next user message as your new task, and use the forked history only as background context.",
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-27T09:05:41.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Task: literature scout for quadcopter/UAV DeePC.",
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-27T09:05:42.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Leaked child transcript content",
              },
            ],
          },
        }),
      ],
    })

    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject(projectDir)
    const importer = new CodexHistoryImporter(homeDir)

    const result = await importer.importSessionsForProject(project.localPath, project.id, store)

    expect(result.importedChatCount).toBe(1)
    const chat = store.listChatsByProject(project.id)[0]!
    const messages = store.getMessages(chat.id)

    expect(messages.some((entry) => entry.kind === "interrupted")).toBe(true)
    expect(messages.some((entry) => entry.kind === "user_prompt" && entry.content.startsWith("Task: "))).toBe(false)
    expect(messages.some((entry) => entry.kind === "tool_result" && typeof entry.content === "string" && entry.content.startsWith("You are the newly spawned agent."))).toBe(false)
    expect(messages.some((entry) => entry.kind === "assistant_text" && entry.text === "Leaked child transcript content")).toBe(false)
  })

  test("dedupes multiple files that resolve to the same external session", async () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const dataDir = makeTempDir("kanna-codex-data-")
    const projectDir = path.join(homeDir, "workspace", "kappa")
    mkdirSync(projectDir, { recursive: true })

    writeSession({
      homeDir,
      sessionId: "session-10",
      cwd: projectDir,
      threadName: "Canonical session",
      fileName: "rollout-2026-03-27T09-05-46-session-10.jsonl",
      body: [
        JSON.stringify({
          timestamp: "2026-03-27T09:05:52.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Canonical content.",
              },
            ],
          },
        }),
      ],
    })

    writeSession({
      homeDir,
      sessionId: "session-10",
      cwd: projectDir,
      threadName: "Canonical session",
      fileName: "rollout-2026-03-27T09-06-00-random-fragment.jsonl",
      body: [
        JSON.stringify({
          timestamp: "2026-03-27T09:05:52.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Fragment content that should be ignored.",
              },
            ],
          },
        }),
      ],
    })

    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject(projectDir)
    const importer = new CodexHistoryImporter(homeDir)

    const listed = importer.listSessionsForProject(project.localPath)
    expect(listed.sessions).toHaveLength(1)
    expect(path.basename(listed.sessions[0]!.sourceFile)).toBe("rollout-2026-03-27T09-05-46-session-10.jsonl")

    const result = await importer.importSessionsForProject(project.localPath, project.id, store)
    expect(result.scannedSessionCount).toBe(1)

    const chat = store.listChatsByProject(project.id)[0]!
    const messages = store.getMessages(chat.id)
    expect(messages.some((entry) => entry.kind === "assistant_text" && entry.text === "Canonical content.")).toBe(true)
    expect(messages.some((entry) => entry.kind === "assistant_text" && entry.text === "Fragment content that should be ignored.")).toBe(false)
  })
})
