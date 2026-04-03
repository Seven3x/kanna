import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TodoWriteMessage } from "./TodoWriteMessage"
import type { ProcessedToolCall } from "./types"

function createTodoMessage(): Extract<ProcessedToolCall, { toolKind: "todo_write" }> {
  return {
    id: "todo-1",
    kind: "tool",
    toolKind: "todo_write",
    toolName: "TodoWrite",
    toolId: "todo-write-1",
    input: {
      todos: [
        {
          content: "Completed step",
          status: "completed",
          activeForm: "Completed step",
        },
        {
          content: "Running step",
          status: "in_progress",
          activeForm: "Running step",
        },
        {
          content: "Pending step",
          status: "pending",
          activeForm: "Pending step",
        },
      ],
    },
    timestamp: new Date(0).toISOString(),
  }
}

describe("TodoWriteMessage", () => {
  test("animates in-progress steps while the chat is active", () => {
    const html = renderToStaticMarkup(
      <TodoWriteMessage message={createTodoMessage()} isActive />
    )

    expect(html).toContain("animate-spin")
    expect(html).toContain("Running step")
  })

  test("stops animating in-progress steps after the chat is idle", () => {
    const html = renderToStaticMarkup(
      <TodoWriteMessage message={createTodoMessage()} isActive={false} />
    )

    expect(html).not.toContain("animate-spin")
    expect(html).toContain("text-amber-500")
    expect(html).toContain("Running step")
  })
})
