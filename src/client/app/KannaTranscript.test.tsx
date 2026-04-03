import { describe, expect, test } from "bun:test"
import { resolveTranscriptPreviewFile } from "./KannaTranscript"

describe("resolveTranscriptPreviewFile", () => {
  test("returns a relative project file path for transcript links inside the project", () => {
    expect(resolveTranscriptPreviewFile({
      localPath: "/tmp/project",
      projectId: "project-1",
      targetPath: "/tmp/project/src/app.tsx",
    })).toEqual({
      projectId: "project-1",
      filePath: "src/app.tsx",
    })
  })

  test("returns null for links outside the current project", () => {
    expect(resolveTranscriptPreviewFile({
      localPath: "/tmp/project",
      projectId: "project-1",
      targetPath: "/tmp/other/file.txt",
    })).toBeNull()
  })
})
