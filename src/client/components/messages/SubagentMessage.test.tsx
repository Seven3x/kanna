import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { HydratedTranscriptMessage } from "../../../shared/types"
import type { ProcessedToolCall } from "./types"
import { OpenLocalLinkProvider } from "./shared"
import { SubagentMessage } from "./SubagentMessage"
import { ToolCallMessage } from "./ToolCallMessage"

function createSubagentMessage(overrides: Partial<Extract<ProcessedToolCall, { toolKind: "subagent_task" }>> = {}) {
  return {
    id: "tool-subagent",
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
      receiverThreadIds: ["thread-2"],
    },
    timestamp: new Date(0).toISOString(),
    result: {
      status: "success",
      providerStatus: "completed",
      summary: "Found the failing snapshots and drafted a fix.",
      latestMessage: "Found the failing snapshots and drafted a fix.",
      childThreadId: "thread-2",
      childThreadIds: ["thread-2"],
    },
    ...overrides,
  } satisfies Extract<ProcessedToolCall, { toolKind: "subagent_task" }>
}

describe("SubagentMessage", () => {
  test("renders subagent tasks as a dedicated expandable card without child transcript", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage message={createSubagentMessage()} />
    )

    expect(html).toContain("spawnAgent")
    expect(html).toContain("Success")
    expect(html).toContain("provider: completed")
    expect(html).toContain("Found the failing snapshots and drafted a fix.")
  })

  test("renders errored subagent tasks in expanded error state", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        message={createSubagentMessage({
          isError: true,
          result: {
            status: "error",
            providerStatus: "failed",
            summary: "Worker hit a permissions error",
            latestMessage: "Worker hit a permissions error",
            errorText: "Worker hit a permissions error",
            childThreadId: "thread-2",
            childThreadIds: ["thread-2"],
          },
        })}
        defaultExpanded
      />
    )

    expect(html).toContain("Error")
    expect(html).toContain("Result / Error")
    expect(html).toContain("Worker hit a permissions error")
    expect(html).toContain("No child transcript available for thread-2")
  })

  test("renders child transcript previews with the shared transcript renderer", () => {
    const childMessages: HydratedTranscriptMessage[] = [
      {
        id: "child-user",
        kind: "user_prompt",
        content: "Please inspect the test suite",
        timestamp: new Date(0).toISOString(),
      },
      {
        id: "child-assistant",
        kind: "assistant_text",
        text: "I found the failing snapshots and prepared a fix.",
        timestamp: new Date(1).toISOString(),
      },
    ]

    const html = renderToStaticMarkup(
      <OpenLocalLinkProvider>
        <SubagentMessage
          message={createSubagentMessage({
            result: {
              status: "success",
              providerStatus: "completed",
              summary: "I found the failing snapshots and prepared a fix.",
              latestMessage: "I found the failing snapshots and prepared a fix.",
              childThreadId: "thread-2",
              childThreadIds: ["thread-2"],
              childTranscript: {
                threadId: "thread-2",
                title: "Child thread",
                messageCount: 2,
                messages: childMessages,
              },
            },
          })}
          defaultExpanded
        />
      </OpenLocalLinkProvider>
    )

    expect(html).toContain("Child Thread")
    expect(html).toContain("Please inspect the test suite")
    expect(html).toContain("I found the failing snapshots and prepared a fix.")
  })

  test("keeps ordinary tool calls on the existing renderer", () => {
    const html = renderToStaticMarkup(
      <ToolCallMessage
        message={{
          id: "tool-bash",
          kind: "tool",
          toolKind: "bash",
          toolName: "Bash",
          toolId: "bash-1",
          input: {
            command: "pwd",
            description: "Print working directory",
          },
          timestamp: new Date(0).toISOString(),
        }}
      />
    )

    expect(html).toContain("Print working directory")
    expect(html).not.toContain("nested agent task")
    expect(html).not.toContain("Child Thread")
  })
})
