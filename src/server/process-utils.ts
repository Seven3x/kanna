import process from "node:process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"

export function spawnDetached(command: string, args: string[]) {
  spawn(command, args, { stdio: "ignore", detached: true }).unref()
}

export function hasCommand(command: string) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" })
  return result.status === 0
}

export function resolveCommand(command: string): string | null {
  if (hasCommand(command)) {
    return command
  }

  const candidateShells = [process.env.SHELL, "/bin/bash", "/bin/zsh"]
    .filter((shell, index, array): shell is string => Boolean(shell) && array.indexOf(shell) === index)

  for (const shell of candidateShells) {
    const result = spawnSync(shell, ["-lc", `command -v ${command}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    if (result.status !== 0) {
      continue
    }

    const resolved = result.stdout.trim()
    if (resolved) {
      return resolved
    }
  }

  for (const candidate of commonCommandPaths(command)) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export function resolveNodeBackedCommand(command: string): { command: string; args: string[] } | null {
  const resolved = resolveCommand(command)
  if (!resolved) {
    return null
  }
  const isExplicitPath = command.includes("/")

  try {
    const firstLine = readFileSync(resolved, "utf8").split("\n", 1)[0] ?? ""
    const siblingNode = path.join(path.dirname(resolved), "node")
    if (firstLine.includes("/usr/bin/env node") && existsSync(siblingNode)) {
      return {
        command: siblingNode,
        args: [resolved],
      }
    }
  } catch {
    // Fall back to executing the command directly.
  }

  if (resolved === command && !isExplicitPath) {
    return { command: resolved, args: [] }
  }

  return { command: resolved, args: [] }
}

function commonCommandPaths(command: string) {
  const home = homedir()
  const candidates = [
    path.join(home, ".local", "bin", command),
    path.join(home, ".bun", "bin", command),
    "/usr/local/bin/" + command,
    "/opt/homebrew/bin/" + command,
  ]

  const nvmNodeVersionsDir = path.join(home, ".nvm", "versions", "node")
  if (existsSync(nvmNodeVersionsDir)) {
    const versionDirs = readdirSync(nvmNodeVersionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()

    for (const versionDir of versionDirs) {
      candidates.push(path.join(nvmNodeVersionsDir, versionDir, "bin", command))
    }
  }

  return candidates
}

export function canOpenMacApp(appName: string) {
  const result = spawnSync("open", ["-Ra", appName], { stdio: "ignore" })
  return result.status === 0
}
