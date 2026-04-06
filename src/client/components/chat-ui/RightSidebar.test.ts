import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { RightSidebar } from "./RightSidebar"
import { TooltipProvider } from "../ui/tooltip"

describe("RightSidebar", () => {
  test("renders the empty-state copy", () => {
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(RightSidebar, {
        chatId: "chat-1",
        diffs: { status: "unknown", files: [] },
        diffRenderMode: "unified",
        wrapLines: false,
        onOpenFile: () => {},
        onGenerateCommitMessage: async () => ({ subject: "", body: "" }),
        onCommit: async () => {},
        onDiffRenderModeChange: () => {},
        onWrapLinesChange: () => {},
        onClose: () => {},
      })
    ))

    expect(markup).toContain("No file changes.")
  })

  test("renders the close affordance", () => {
    const onClose = mock(() => {})
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(RightSidebar, {
        chatId: "chat-1",
        diffs: { status: "unknown", files: [] },
        diffRenderMode: "unified",
        wrapLines: false,
        onOpenFile: () => {},
        onGenerateCommitMessage: async () => ({ subject: "", body: "" }),
        onCommit: async () => {},
        onDiffRenderModeChange: () => {},
        onWrapLinesChange: () => {},
        onClose,
      })
    ))

    expect(markup).toContain("Close right sidebar")
  })
})
