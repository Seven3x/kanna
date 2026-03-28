import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { resolveCommand, resolveNodeBackedCommand } from "./process-utils"

describe("resolveCommand", () => {
  test("resolves commands that exist", () => {
    expect(resolveCommand("sh")).not.toBeNull()
  })

  test("returns null for commands that do not exist", () => {
    expect(resolveCommand("definitely-not-a-real-command-kanna")).toBeNull()
  })
})

describe("resolveNodeBackedCommand", () => {
  test("returns direct commands when no explicit script path is resolved", () => {
    expect(resolveNodeBackedCommand("sh")).toEqual({ command: "sh", args: [] })
  })

  test("uses a sibling node binary for env-node scripts", () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), "kanna-process-utils-"))
    const binDir = path.join(baseDir, "bin")
    mkdirSync(binDir, { recursive: true })

    const scriptPath = path.join(binDir, "fake-codex")
    const nodePath = path.join(binDir, "node")

    writeFileSync(scriptPath, "#!/usr/bin/env node\nconsole.log('hi')\n")
    writeFileSync(nodePath, "")

    expect(resolveNodeBackedCommand(scriptPath)).toEqual({
      command: nodePath,
      args: [scriptPath],
    })
  })
})
