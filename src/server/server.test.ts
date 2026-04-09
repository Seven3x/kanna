import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import { cleanupStaleTemporaryProjects, isAllowedClientIpAddress, isStaleTemporaryProjectPath, normalizeClientIpAddress } from "./server"

describe("normalizeClientIpAddress", () => {
  test("normalizes ipv4-mapped ipv6 addresses", () => {
    expect(normalizeClientIpAddress("::ffff:10.156.8.9")).toBe("10.156.8.9")
  })

  test("strips ipv6 zone ids", () => {
    expect(normalizeClientIpAddress("fe80::1%lo0")).toBe("fe80::1")
  })
})

describe("isAllowedClientIpAddress", () => {
  test("allows loopback and 10.156 lan addresses", () => {
    expect(isAllowedClientIpAddress("127.0.0.1")).toBe(true)
    expect(isAllowedClientIpAddress("::1")).toBe(true)
    expect(isAllowedClientIpAddress("10.156.12.34")).toBe(true)
    expect(isAllowedClientIpAddress("::ffff:10.156.12.34")).toBe(true)
  })

  test("rejects other addresses", () => {
    expect(isAllowedClientIpAddress(null)).toBe(false)
    expect(isAllowedClientIpAddress("10.157.12.34")).toBe(false)
    expect(isAllowedClientIpAddress("192.168.1.1")).toBe(false)
    expect(isAllowedClientIpAddress("fe80::1")).toBe(false)
  })
})

describe("normalize temporary project handling", () => {
  test("matches kanna upload temp project directories under the system tmp dir", () => {
    const systemTmp = os.tmpdir()
    const sample = path.join(systemTmp, "kanna-project-delete-gdOSZV")

    expect(isStaleTemporaryProjectPath(sample)).toBe(true)
    expect(isStaleTemporaryProjectPath("/home/roxy/kanna")).toBe(false)
  })

  test("removes stale temporary projects from the event store", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "kanna-server-store-"))

    try {
      const store = new EventStore(dataDir)
      await store.initialize()

      const staleProjectPath = path.join(os.tmpdir(), "kanna-project-delete-gdOSZV")
      const staleProject = await store.openProject(staleProjectPath, "Temp Project")
      const realProjectRoot = await mkdtemp(path.join(os.tmpdir(), "kanna-server-project-"))

      try {
        const realProject = await store.openProject(realProjectRoot, "Real Project")

        expect(store.getProject(staleProject.id)?.localPath).toBe(staleProjectPath)
        expect(store.getProject(realProject.id)?.localPath).toBe(realProjectRoot)

        await cleanupStaleTemporaryProjects(store)

        expect(store.getProject(staleProject.id)).toBeNull()
        expect(store.getProject(realProject.id)?.localPath).toBe(realProjectRoot)
      } finally {
        await rm(realProjectRoot, { recursive: true, force: true })
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
