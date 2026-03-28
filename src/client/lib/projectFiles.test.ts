import { afterEach, describe, expect, test } from "bun:test"
import {
  buildProjectFileRawUrl,
  fetchProjectFileList,
  getParentProjectFilePath,
  getProjectRelativeFilePath,
  resolveProjectLocalFilePath,
} from "./projectFiles"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("project file helpers", () => {
  test("builds download URLs for project files", () => {
    expect(buildProjectFileRawUrl("project-1", "src/app.ts", true)).toBe(
      "/api/projects/project-1/raw?path=src%2Fapp.ts&download=1"
    )
  })

  test("maps absolute project files to relative paths", () => {
    expect(getProjectRelativeFilePath("/tmp/demo", "/tmp/demo/src/app.ts")).toBe("src/app.ts")
    expect(getProjectRelativeFilePath("/tmp/demo", "/tmp/other/app.ts")).toBeNull()
  })

  test("returns the parent project path", () => {
    expect(getParentProjectFilePath("src/components/App.tsx")).toBe("src/components")
    expect(getParentProjectFilePath("README.md")).toBe("")
  })

  test("joins project roots and relative paths without double slashes", () => {
    expect(resolveProjectLocalFilePath("/tmp/demo", "src/app.ts")).toBe("/tmp/demo/src/app.ts")
    expect(resolveProjectLocalFilePath("/tmp/demo/", "src/app.ts")).toBe("/tmp/demo/src/app.ts")
  })

  test("surfaces a clear error when the endpoint returns html", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("<!doctype html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }))) as typeof fetch

    await expect(fetchProjectFileList("project-1")).rejects.toThrow(
      "Project files endpoint returned a non-JSON response"
    )
  })
})
