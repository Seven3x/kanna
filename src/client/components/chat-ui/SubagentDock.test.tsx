import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { HydratedTranscriptMessage } from "../../../shared/types"
import { SubagentDock } from "./SubagentDock"

describe("SubagentDock", () => {
  test("renders a compact trigger for subagents in the current thread", () => {
    const html = renderToStaticMarkup(
      <SubagentDock
        messages={[
          {
            id: "tool-1",
            kind: "tool",
            toolKind: "subagent_task",
            toolName: "Task",
            toolId: "agent-1",
            input: {
              subagentType: "spawnAgent",
            },
            timestamp: new Date(0).toISOString(),
            result: {
              status: "success",
              providerStatus: "completed",
              summary: "Inspected the tests and found the broken snapshots.",
              latestMessage: "Inspected the tests and found the broken snapshots.",
              childThreadId: "thread-2",
              childThreadIds: ["thread-2"],
            },
          },
        ] satisfies HydratedTranscriptMessage[]
        }
        isLoading={false}
      />
    )

    expect(html).toContain("Subagents")
    expect(html).toContain("1 in this thread")
    expect(html).not.toContain("Inspected the tests and found the broken snapshots.")
  })
})
