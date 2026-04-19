import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { RightSidebar } from "./RightSidebar"

describe("RightSidebar", () => {
  test("renders the project files heading", () => {
    const markup = renderToStaticMarkup(createElement(RightSidebar, { projectId: "project-1", onClose: () => {} }))

    expect(markup).toContain("Project Files")
  })

  test("renders the close affordance", () => {
    const onClose = mock(() => {})
    const markup = renderToStaticMarkup(createElement(RightSidebar, { projectId: "project-1", onClose }))

    expect(markup).toContain("Close right sidebar")
  })

  test("renders discovered project skills above project files", () => {
    const markup = renderToStaticMarkup(createElement(RightSidebar, {
      projectId: "project-1",
      localPath: "/tmp/project-1",
      skills: [
        {
          name: "shadcn",
          description: "Component workflow helper.",
          source: "shadcn/ui",
          sourceType: "github",
          relativePath: ".agents/skills/shadcn/SKILL.md",
        },
      ],
      onClose: () => {},
    }))

    expect(markup).toContain("Skills")
    expect(markup).toContain("Files")
    expect(markup).not.toContain("shadcn")
    expect(markup).not.toContain("Component workflow helper.")
    expect(markup).not.toContain(".agents/skills/shadcn/SKILL.md")
  })

  test("renders an AGENTS.md quick action even when files are collapsed", () => {
    const markup = renderToStaticMarkup(createElement(RightSidebar, { projectId: "project-1", onClose: () => {} }))

    expect(markup).toContain("AGENTS.md")
  })
})
