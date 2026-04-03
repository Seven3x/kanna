import { describe, expect, test } from "bun:test"
import { processTranscriptMessages } from "./parseTranscript"
import { getLatestToolIds } from "../app/derived"
import type { TranscriptEntry } from "../../shared/types"

function entry(partial: Omit<TranscriptEntry, "_id" | "createdAt">): TranscriptEntry {
  return {
    _id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...partial,
  } as TranscriptEntry
}

describe("processTranscriptMessages", () => {
  test("hydrates tool results onto prior tool calls", () => {
    const messages = processTranscriptMessages([
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "bash",
          toolName: "Bash",
          toolId: "tool-1",
          input: { command: "pwd" },
        },
      }),
      entry({
        kind: "tool_result",
        toolId: "tool-1",
        content: "/Users/jake/Projects/kanna\n",
      }),
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0]?.kind).toBe("tool")
    if (messages[0]?.kind !== "tool") throw new Error("unexpected message")
    expect(messages[0].result).toBe("/Users/jake/Projects/kanna\n")
  })

  test("hydrates ask-user-question results with typed answers", () => {
    const messages = processTranscriptMessages([
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "ask_user_question",
          toolName: "AskUserQuestion",
          toolId: "tool-2",
          input: {
            questions: [{ question: "Provider?" }],
          },
        },
      }),
      entry({
        kind: "tool_result",
        toolId: "tool-2",
        content: { answers: { "Provider?": ["Codex"] } },
      }),
    ])

    expect(messages[0]?.kind).toBe("tool")
    if (messages[0]?.kind !== "tool") throw new Error("unexpected message")
    expect(messages[0].result).toEqual({ answers: { "Provider?": ["Codex"] } })
  })

  test("hydrates discarded prompt tool results", () => {
    const messages = processTranscriptMessages([
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "exit_plan_mode",
          toolName: "ExitPlanMode",
          toolId: "tool-3",
          input: {
            plan: "## Plan",
          },
        },
      }),
      entry({
        kind: "tool_result",
        toolId: "tool-3",
        content: { discarded: true },
      }),
    ])

    expect(messages[0]?.kind).toBe("tool")
    if (messages[0]?.kind !== "tool") throw new Error("unexpected message")
    expect(messages[0].result).toEqual({ discarded: true })
  })

  test("preserves attachments on hydrated user prompts", () => {
    const messages = processTranscriptMessages([
      entry({
        kind: "user_prompt",
        content: "Please inspect these.",
        attachments: [{
          id: "file-1",
          kind: "file",
          displayName: "spec.pdf",
          absolutePath: "/tmp/project/.kanna/uploads/spec.pdf",
          relativePath: "./.kanna/uploads/spec.pdf",
          contentUrl: "/api/projects/project-1/uploads/spec.pdf/content",
          mimeType: "application/pdf",
          size: 1234,
        }],
      }),
    ])

    expect(messages[0]?.kind).toBe("user_prompt")
    if (messages[0]?.kind !== "user_prompt") throw new Error("unexpected message")
    expect(messages[0].attachments).toHaveLength(1)
    expect(messages[0].attachments?.[0]?.relativePath).toBe("./.kanna/uploads/spec.pdf")
  })

  test("preserves structured Claude ask-user-question results when a later echoed tool result arrives", () => {
    const messages = processTranscriptMessages([
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "ask_user_question",
          toolName: "AskUserQuestion",
          toolId: "tool-3",
          input: {
            questions: [{ question: "Provider?" }],
          },
        },
      }),
      entry({
        kind: "tool_result",
        toolId: "tool-3",
        content: { answers: { "Provider?": ["Codex"] } },
      }),
      entry({
        kind: "tool_result",
        toolId: "tool-3",
        content: "User has answered your questions: \"Provider?\"=\"Codex\".",
        debugRaw: JSON.stringify({
          type: "user",
          tool_use_result: {
            questions: [{ question: "Provider?" }],
            answers: { "Provider?": "Codex" },
          },
        }),
      }),
    ])

    expect(messages[0]?.kind).toBe("tool")
    if (messages[0]?.kind !== "tool") throw new Error("unexpected message")
    expect(messages[0].result).toEqual({ answers: { "Provider?": ["Codex"] } })
  })

  test("hydrates subagent tool results into structured metadata", () => {
    const messages = processTranscriptMessages([
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "subagent_task",
          toolName: "Task",
          toolId: "agent-1",
          input: {
            subagentType: "spawnAgent",
          },
          rawInput: {
            subagent_type: "spawnAgent",
            prompt: "Inspect tests",
            senderThreadId: "thread-1",
            receiverThreadIds: ["thread-2"],
          },
        },
      }),
      entry({
        kind: "tool_result",
        toolId: "agent-1",
        content: {
          type: "collabAgentToolCall",
          id: "agent-1",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "thread-1",
          receiverThreadIds: ["thread-2"],
          agentsStates: {
            "thread-2": {
              status: "running",
              message: "Inspecting the test suite",
            },
          },
        },
      }),
    ])

    expect(messages[0]?.kind).toBe("tool")
    if (messages[0]?.kind !== "tool" || messages[0].toolKind !== "subagent_task") {
      throw new Error("unexpected message")
    }
    expect(messages[0].rawInput).toEqual({
      subagent_type: "spawnAgent",
      prompt: "Inspect tests",
      senderThreadId: "thread-1",
      receiverThreadIds: ["thread-2"],
    })
    expect(messages[0].result).toEqual({
      status: "success",
      providerStatus: "completed",
      summary: "Inspecting the test suite",
      latestMessage: "Inspecting the test suite",
      resultText: undefined,
      errorText: undefined,
      childThreadId: "thread-2",
      childThreadIds: ["thread-2"],
      childSessionId: undefined,
      childTitle: undefined,
      messageCount: undefined,
      childThreads: [{
        threadId: "thread-2",
        status: "running",
        providerStatus: "running",
        latestMessage: "Inspecting the test suite",
        summary: "Inspecting the test suite",
      }],
      childTranscript: undefined,
    })
  })

  test("prefers child transcript assistant text for subagent summaries", () => {
    const childTranscript = [
      entry({
        kind: "assistant_text",
        text: "Checking the repo layout.",
      }),
      entry({
        kind: "assistant_text",
        text: "Found the failing snapshots and drafted a fix.",
      }),
    ]

    const messages = processTranscriptMessages([
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "subagent_task",
          toolName: "Task",
          toolId: "agent-2",
          input: {
            subagentType: "spawnAgent",
          },
        },
      }),
      entry({
        kind: "tool_result",
        toolId: "agent-2",
        content: {
          type: "collabAgentToolCall",
          id: "agent-2",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: ["thread-3"],
          agentsStates: {
            "thread-3": {
              status: "completed",
              message: "Older state message",
            },
          },
          childTranscript: {
            threadId: "thread-3",
            messages: childTranscript,
          },
        },
      }),
    ])

    expect(messages[0]?.kind).toBe("tool")
    if (messages[0]?.kind !== "tool" || messages[0].toolKind !== "subagent_task") {
      throw new Error("unexpected message")
    }
    expect(messages[0].result?.summary).toBe("Found the failing snapshots and drafted a fix.")
    expect(messages[0].result?.messageCount).toBe(2)
    expect(messages[0].result?.childTranscript?.messages).toHaveLength(2)
    expect(messages[0].result?.childTranscript?.messages[1]).toMatchObject({
      kind: "assistant_text",
      text: "Found the failing snapshots and drafted a fix.",
    })
  })

  test("rehydrates legacy unknown spawn_agent and wait_agent records as subagent tasks", () => {
    const messages = processTranscriptMessages([
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "unknown_tool",
          toolName: "spawn_agent",
          toolId: "agent-legacy-1",
          input: {
            payload: {
              agent_type: "worker",
              message: "Run a quick check",
            },
          },
          rawInput: {
            agent_type: "worker",
            message: "Run a quick check",
          },
        },
      }),
      entry({
        kind: "tool_result",
        toolId: "agent-legacy-1",
        content: {
          agent_id: "child-1",
          nickname: "Euler",
        },
      }),
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "unknown_tool",
          toolName: "wait_agent",
          toolId: "agent-legacy-2",
          input: {
            payload: {
              targets: ["child-1"],
            },
          },
          rawInput: {
            targets: ["child-1"],
          },
        },
      }),
      entry({
        kind: "tool_result",
        toolId: "agent-legacy-2",
        content: {
          status: {
            "child-1": {
              completed: "Command: `python -c \"print(1)\"`",
            },
          },
          timed_out: false,
        },
      }),
    ])

    expect(messages[0]?.kind).toBe("tool")
    if (messages[0]?.kind !== "tool" || messages[0].toolKind !== "subagent_task") {
      throw new Error("expected legacy spawn_agent to be remapped")
    }
    expect(messages[0].input.subagentType).toBe("worker")
    expect(messages[0].result?.childThreadId).toBe("child-1")
    expect(messages[0].result?.childTitle).toBe("Euler")

    expect(messages[1]?.kind).toBe("tool")
    if (messages[1]?.kind !== "tool" || messages[1].toolKind !== "subagent_task") {
      throw new Error("expected legacy wait_agent to be remapped")
    }
    expect(messages[1].result?.childThreadId).toBe("child-1")
    expect(messages[1].result?.childThreads?.[0]).toMatchObject({
      threadId: "child-1",
      providerStatus: "completed",
      latestMessage: "Command: `python -c \"print(1)\"`",
    })
  })

  test("marks errored subagent results as error", () => {
    const messages = processTranscriptMessages([
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "subagent_task",
          toolName: "Task",
          toolId: "agent-3",
          input: {
            subagentType: "wait",
          },
        },
      }),
      entry({
        kind: "tool_result",
        toolId: "agent-3",
        isError: true,
        content: {
          type: "collabAgentToolCall",
          id: "agent-3",
          tool: "wait",
          status: "failed",
          receiverThreadIds: ["thread-4"],
          agentsStates: {
            "thread-4": {
              status: "failed",
              message: "Worker hit a permissions error",
            },
          },
        },
      }),
    ])

    expect(messages[0]?.kind).toBe("tool")
    if (messages[0]?.kind !== "tool" || messages[0].toolKind !== "subagent_task") {
      throw new Error("unexpected message")
    }
    expect(messages[0].isError).toBe(true)
    expect(messages[0].result?.status).toBe("error")
    expect(messages[0].result?.errorText).toBe("Worker hit a permissions error")
  })
})

describe("getLatestToolIds", () => {
  test("returns the latest unresolved special tool ids", () => {
    const messages = processTranscriptMessages([
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "ask_user_question",
          toolName: "AskUserQuestion",
          toolId: "tool-1",
          input: {
            questions: [{ question: "Provider?" }],
          },
        },
      }),
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "todo_write",
          toolName: "TodoWrite",
          toolId: "tool-2",
          input: {
            todos: [{ content: "Implement adapter", status: "in_progress", activeForm: "Implementing adapter" }],
          },
        },
      }),
    ])

    expect(getLatestToolIds(messages)).toEqual({
      AskUserQuestion: messages[0]?.kind === "tool" ? messages[0].id : null,
      ExitPlanMode: null,
      TodoWrite: messages[1]?.kind === "tool" ? messages[1].id : null,
    })
  })

  test("ignores discarded special tools when choosing the latest active id", () => {
    const messages = processTranscriptMessages([
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "ask_user_question",
          toolName: "AskUserQuestion",
          toolId: "tool-1",
          input: {
            questions: [{ question: "Provider?" }],
          },
        },
      }),
      entry({
        kind: "tool_result",
        toolId: "tool-1",
        content: { discarded: true, answers: {} },
      }),
      entry({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "exit_plan_mode",
          toolName: "ExitPlanMode",
          toolId: "tool-2",
          input: {
            plan: "## Plan",
          },
        },
      }),
      entry({
        kind: "tool_result",
        toolId: "tool-2",
        content: { discarded: true },
      }),
    ])

    expect(getLatestToolIds(messages)).toEqual({
      AskUserQuestion: null,
      ExitPlanMode: null,
      TodoWrite: null,
    })
  })
})
