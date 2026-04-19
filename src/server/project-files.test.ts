import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { listProjectDirectory, previewProjectFile, uploadProjectFiles, writeProjectFileContent } from "./project-files"
import type { EventStore } from "./event-store"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function createStore(projectId: string, localPath: string) {
  return {
    getProject(requestedProjectId: string) {
      if (requestedProjectId !== projectId) {
        return null
      }
      return {
        id: projectId,
        localPath,
      }
    },
  } as unknown as EventStore
}

async function createTempProject() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "kanna-project-files-"))
  tempDirs.push(projectRoot)
  return projectRoot
}

describe("project file helpers", () => {
  test("lists project files and skips symlinks", async () => {
    const projectRoot = await createTempProject()
    await mkdir(path.join(projectRoot, "src"))
    await writeFile(path.join(projectRoot, "README.md"), "# kanna\n")
    await writeFile(path.join(projectRoot, "src", "app.ts"), "console.log('hi')\n")
    await symlink("/tmp", path.join(projectRoot, "tmp-link"))

    const result = await listProjectDirectory(createStore("project-1", projectRoot), "project-1", "")

    expect(result.entries.map((entry) => entry.path)).toEqual(["src", "README.md"])
  })

  test("previews a text file inside the project root", async () => {
    const projectRoot = await createTempProject()
    await writeFile(path.join(projectRoot, "src.ts"), "export const answer = 42\n")

    const result = await previewProjectFile(createStore("project-1", projectRoot), "project-1", "src.ts")

    expect(result.kind).toBe("text")
    expect(result.content).toContain("answer = 42")
    expect(result.path).toBe("src.ts")
  })

  test("rejects traversal outside the project root", async () => {
    const projectRoot = await createTempProject()
    await writeFile(path.join(projectRoot, "safe.txt"), "safe\n")

    await expect(previewProjectFile(createStore("project-1", projectRoot), "project-1", "../etc/passwd")).rejects.toThrow(
      "Invalid file path"
    )
  })

  test("uploads files into the selected project directory", async () => {
    const projectRoot = await createTempProject()
    await mkdir(path.join(projectRoot, "assets"))
    const formData = new FormData()
    formData.append("files", new File(["hello"], "greeting.txt", { type: "text/plain" }))

    const result = await uploadProjectFiles(createStore("project-1", projectRoot), "project-1", "assets", formData)

    expect(result.uploaded).toEqual(["assets/greeting.txt"])
    expect(await readFile(path.join(projectRoot, "assets", "greeting.txt"), "utf8")).toBe("hello")
  })

  test("writes and creates a text file inside the project root", async () => {
    const projectRoot = await createTempProject()

    const result = await writeProjectFileContent(createStore("project-1", projectRoot), "project-1", "AGENTS.md", "# Project Agents\n")

    expect(result.path).toBe("AGENTS.md")
    expect(result.created).toBe(true)
    expect(await readFile(path.join(projectRoot, "AGENTS.md"), "utf8")).toBe("# Project Agents\n")
  })
})
