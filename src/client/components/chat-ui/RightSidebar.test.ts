import { describe, expect, mock, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { RightSidebar } from "./RightSidebar"

describe("RightSidebar", () => {
  test("renders the project files heading", () => {
    const markup = renderToStaticMarkup(RightSidebar({ projectId: "project-1", onClose: () => {} }))

    expect(markup).toContain("Project Files")
  })

  test("renders the close affordance", () => {
    const onClose = mock(() => {})
    const markup = renderToStaticMarkup(RightSidebar({ projectId: "project-1", onClose }))

    expect(markup).toContain("Close right sidebar")
  })
})
