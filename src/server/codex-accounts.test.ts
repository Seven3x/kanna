import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  markActiveCodexAccountChatted,
  readCodexAuthSnapshot,
  setCodexAccountAutoSwitchDisabled,
  switchCodexAuthAccount,
  switchToNextCodexAuthAccount,
} from "./codex-accounts"

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url")
}

function buildChatgptAuthJson(email: string, plan: string, accountId: string, userId: string) {
  const payload = {
    email,
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId,
      chatgpt_plan_type: plan,
      chatgpt_user_id: userId,
    },
  }

  return JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      id_token: `${encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${encodeBase64Url(JSON.stringify(payload))}.sig`,
      access_token: `access-${email}`,
      refresh_token: `refresh-${email}`,
      account_id: accountId,
    },
    last_refresh: "2026-04-11T10:00:00Z",
  }, null, 2)
}

describe("codex-accounts", () => {
  let homeDir = ""

  afterEach(async () => {
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true })
    }
  })

  test("reads saved account snapshots and marks the active one", async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), "kanna-codex-auth-"))
    const codexHome = path.join(homeDir, ".codex")
    const accountsDir = path.join(codexHome, "accounts")
    await mkdir(accountsDir, { recursive: true })

    const alpha = buildChatgptAuthJson("alpha@example.com", "pro", "acc-alpha", "user-alpha")
    const beta = buildChatgptAuthJson("beta@example.com", "team", "acc-beta", "user-beta")

    await writeFile(path.join(accountsDir, "alpha.auth.json"), alpha, "utf8")
    await writeFile(path.join(accountsDir, "beta.auth.json"), beta, "utf8")
    await writeFile(path.join(accountsDir, "registry.json"), JSON.stringify({
      active_account_key: "user-beta::acc-beta",
      active_account_activated_at_ms: 1_777_000_000_000,
      accounts: [
        {
          account_key: "user-alpha::acc-alpha",
          email: "alpha@example.com",
          last_used_at: 1_777_100_000,
          last_local_rollout: { event_timestamp_ms: 1_777_100_111_000 },
        },
        {
          account_key: "user-beta::acc-beta",
          email: "beta@example.com",
          last_used_at: 1_777_200_000,
          last_local_rollout: { event_timestamp_ms: 1_777_200_222_000 },
        },
      ],
    }, null, 2), "utf8")
    await writeFile(path.join(codexHome, "auth.json"), beta, "utf8")

    const snapshot = await readCodexAuthSnapshot(homeDir)

    expect(snapshot.hasActiveAuth).toBe(true)
    expect(snapshot.activeEmail).toBe("beta@example.com")
    expect(snapshot.activeAccountId).toBe("beta.auth.json")
    expect(snapshot.accounts[0]?.lastActivatedAt).toBe(1_777_000_000_000)
    expect(snapshot.accounts[0]?.lastChattedAt).toBe(1_777_200_222_000)
    expect(snapshot.accounts[0]?.autoSwitchDisabled).toBe(false)
    expect(snapshot.accounts[1]?.lastActivatedAt).toBeNull()
    expect(snapshot.accounts[1]?.lastChattedAt).toBe(1_777_100_111_000)
    expect(snapshot.accounts[1]?.autoSwitchDisabled).toBe(false)
    expect(snapshot.accounts.map((account) => [account.id, account.isActive])).toEqual([
      ["beta.auth.json", true],
      ["alpha.auth.json", false],
    ])
  })

  test("does not mark multiple same-email snapshots active when record keys differ", async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), "kanna-codex-same-email-"))
    const codexHome = path.join(homeDir, ".codex")
    const accountsDir = path.join(codexHome, "accounts")
    await mkdir(accountsDir, { recursive: true })

    const plus = buildChatgptAuthJson("shared@example.com", "plus", "acc-plus", "user-shared")
    const team = buildChatgptAuthJson("shared@example.com", "team", "acc-team", "user-shared")

    await writeFile(path.join(accountsDir, "plus.auth.json"), plus, "utf8")
    await writeFile(path.join(accountsDir, "team.auth.json"), team, "utf8")
    await writeFile(path.join(codexHome, "auth.json"), team, "utf8")

    const snapshot = await readCodexAuthSnapshot(homeDir)

    expect(snapshot.activeAccountId).toBe("team.auth.json")
    expect(snapshot.accounts.map((account) => [account.id, account.isActive])).toEqual([
      ["team.auth.json", true],
      ["plus.auth.json", false],
    ])
  })

  test("switches auth.json to the requested snapshot", async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), "kanna-codex-switch-"))
    const codexHome = path.join(homeDir, ".codex")
    const accountsDir = path.join(codexHome, "accounts")
    await mkdir(accountsDir, { recursive: true })

    const alpha = buildChatgptAuthJson("alpha@example.com", "pro", "acc-alpha", "user-alpha")
    const beta = buildChatgptAuthJson("beta@example.com", "team", "acc-beta", "user-beta")

    await writeFile(path.join(accountsDir, "alpha.auth.json"), alpha, "utf8")
    await writeFile(path.join(accountsDir, "beta.auth.json"), beta, "utf8")
    await writeFile(path.join(codexHome, "auth.json"), alpha, "utf8")

    const snapshot = await switchCodexAuthAccount("beta.auth.json", homeDir)

    expect(snapshot.activeAccountId).toBe("beta.auth.json")
    expect(snapshot.activeEmail).toBe("beta@example.com")
    expect(snapshot.accounts.find((account) => account.id === "beta.auth.json")?.isActive).toBe(true)
    expect(snapshot.accounts.find((account) => account.id === "beta.auth.json")?.lastActivatedAt).toEqual(expect.any(Number))
  })

  test("switches to the least recently activated alternate account", async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), "kanna-codex-next-"))
    const codexHome = path.join(homeDir, ".codex")
    const accountsDir = path.join(codexHome, "accounts")
    await mkdir(accountsDir, { recursive: true })

    const alpha = buildChatgptAuthJson("alpha@example.com", "pro", "acc-alpha", "user-alpha")
    const beta = buildChatgptAuthJson("beta@example.com", "team", "acc-beta", "user-beta")
    const gamma = buildChatgptAuthJson("gamma@example.com", "pro", "acc-gamma", "user-gamma")

    await writeFile(path.join(accountsDir, "alpha.auth.json"), alpha, "utf8")
    await writeFile(path.join(accountsDir, "beta.auth.json"), beta, "utf8")
    await writeFile(path.join(accountsDir, "gamma.auth.json"), gamma, "utf8")
    await writeFile(path.join(accountsDir, "registry.json"), JSON.stringify({
      active_account_key: "user-alpha::acc-alpha",
      active_account_activated_at_ms: 1_777_000_000_000,
      accounts: [
        {
          account_key: "user-alpha::acc-alpha",
          email: "alpha@example.com",
          last_local_rollout: { event_timestamp_ms: 1_777_000_000_000 },
        },
        {
          account_key: "user-beta::acc-beta",
          email: "beta@example.com",
          last_local_rollout: { event_timestamp_ms: 1_777_200_000_000 },
        },
        {
          account_key: "user-gamma::acc-gamma",
          email: "gamma@example.com",
          last_local_rollout: { event_timestamp_ms: 1_777_100_000_000 },
        },
      ],
    }, null, 2), "utf8")
    await writeFile(path.join(codexHome, "accounts-state.json"), JSON.stringify({
      "beta.auth.json": {
        lastActivatedAt: 1_777_200_000_000,
      },
      "gamma.auth.json": {
        lastActivatedAt: 1_777_100_000_000,
      },
    }, null, 2), "utf8")
    await writeFile(path.join(codexHome, "auth.json"), alpha, "utf8")

    const result = await switchToNextCodexAuthAccount(homeDir)

    expect(result).not.toBeNull()
    expect(result?.switchedAccount.id).toBe("gamma.auth.json")
    expect(result?.switchedAccount.email).toBe("gamma@example.com")
    expect(result?.snapshot.activeAccountId).toBe("gamma.auth.json")
  })

  test("prefers accounts that have never been activated before dated ones", async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), "kanna-codex-never-"))
    const codexHome = path.join(homeDir, ".codex")
    const accountsDir = path.join(codexHome, "accounts")
    await mkdir(accountsDir, { recursive: true })

    const alpha = buildChatgptAuthJson("alpha@example.com", "pro", "acc-alpha", "user-alpha")
    const beta = buildChatgptAuthJson("beta@example.com", "team", "acc-beta", "user-beta")
    const gamma = buildChatgptAuthJson("gamma@example.com", "pro", "acc-gamma", "user-gamma")

    await writeFile(path.join(accountsDir, "alpha.auth.json"), alpha, "utf8")
    await writeFile(path.join(accountsDir, "beta.auth.json"), beta, "utf8")
    await writeFile(path.join(accountsDir, "gamma.auth.json"), gamma, "utf8")
    await writeFile(path.join(codexHome, "accounts-state.json"), JSON.stringify({
      "beta.auth.json": {
        lastActivatedAt: 1_777_200_000_000,
      },
    }, null, 2), "utf8")
    await writeFile(path.join(codexHome, "auth.json"), alpha, "utf8")

    const result = await switchToNextCodexAuthAccount(homeDir)

    expect(result).not.toBeNull()
    expect(result?.switchedAccount.id).toBe("gamma.auth.json")
  })

  test("can disable auto-switch for a specific account", async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), "kanna-codex-disable-"))
    const codexHome = path.join(homeDir, ".codex")
    const accountsDir = path.join(codexHome, "accounts")
    await mkdir(accountsDir, { recursive: true })

    const alpha = buildChatgptAuthJson("alpha@example.com", "pro", "acc-alpha", "user-alpha")
    const beta = buildChatgptAuthJson("beta@example.com", "team", "acc-beta", "user-beta")

    await writeFile(path.join(accountsDir, "alpha.auth.json"), alpha, "utf8")
    await writeFile(path.join(accountsDir, "beta.auth.json"), beta, "utf8")
    await writeFile(path.join(codexHome, "auth.json"), alpha, "utf8")

    const snapshot = await setCodexAccountAutoSwitchDisabled("beta.auth.json", true, homeDir)

    expect(snapshot.accounts.find((account) => account.id === "beta.auth.json")?.autoSwitchDisabled).toBe(true)
  })

  test("prefers locally tracked chatted timestamps over stale registry rollout timestamps", async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), "kanna-codex-chatted-"))
    const codexHome = path.join(homeDir, ".codex")
    const accountsDir = path.join(codexHome, "accounts")
    await mkdir(accountsDir, { recursive: true })

    const alpha = buildChatgptAuthJson("alpha@example.com", "pro", "acc-alpha", "user-alpha")

    await writeFile(path.join(accountsDir, "alpha.auth.json"), alpha, "utf8")
    await writeFile(path.join(accountsDir, "registry.json"), JSON.stringify({
      active_account_key: "user-alpha::acc-alpha",
      active_account_activated_at_ms: 1_777_000_000_000,
      accounts: [{
        account_key: "user-alpha::acc-alpha",
        email: "alpha@example.com",
        last_local_rollout: { event_timestamp_ms: 1_777_100_000_000 },
      }],
    }, null, 2), "utf8")
    await writeFile(path.join(codexHome, "accounts-state.json"), JSON.stringify({
      "alpha.auth.json": {
        lastChattedAt: 1_777_200_000_000,
      },
    }, null, 2), "utf8")
    await writeFile(path.join(codexHome, "auth.json"), alpha, "utf8")

    const snapshot = await readCodexAuthSnapshot(homeDir)

    expect(snapshot.accounts[0]?.lastChattedAt).toBe(1_777_200_000_000)
  })

  test("records chatted time for the active account", async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), "kanna-codex-mark-chatted-"))
    const codexHome = path.join(homeDir, ".codex")
    const accountsDir = path.join(codexHome, "accounts")
    await mkdir(accountsDir, { recursive: true })

    const alpha = buildChatgptAuthJson("alpha@example.com", "pro", "acc-alpha", "user-alpha")

    await writeFile(path.join(accountsDir, "alpha.auth.json"), alpha, "utf8")
    await writeFile(path.join(codexHome, "auth.json"), alpha, "utf8")

    const snapshot = await markActiveCodexAccountChatted(homeDir, 1_777_300_000_000)

    expect(snapshot.activeAccountId).toBe("alpha.auth.json")
    expect(snapshot.accounts[0]?.lastChattedAt).toBe(1_777_300_000_000)
  })

  test("skips auto-switch-disabled accounts during automatic rotation", async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), "kanna-codex-skip-disabled-"))
    const codexHome = path.join(homeDir, ".codex")
    const accountsDir = path.join(codexHome, "accounts")
    await mkdir(accountsDir, { recursive: true })

    const alpha = buildChatgptAuthJson("alpha@example.com", "pro", "acc-alpha", "user-alpha")
    const beta = buildChatgptAuthJson("beta@example.com", "team", "acc-beta", "user-beta")
    const gamma = buildChatgptAuthJson("gamma@example.com", "pro", "acc-gamma", "user-gamma")

    await writeFile(path.join(accountsDir, "alpha.auth.json"), alpha, "utf8")
    await writeFile(path.join(accountsDir, "beta.auth.json"), beta, "utf8")
    await writeFile(path.join(accountsDir, "gamma.auth.json"), gamma, "utf8")
    await writeFile(path.join(codexHome, "accounts-state.json"), JSON.stringify({
      "beta.auth.json": {
        lastActivatedAt: 1_777_100_000_000,
        autoSwitchDisabled: true,
      },
      "gamma.auth.json": {
        lastActivatedAt: 1_777_200_000_000,
      },
    }, null, 2), "utf8")
    await writeFile(path.join(codexHome, "auth.json"), alpha, "utf8")

    const result = await switchToNextCodexAuthAccount(homeDir)

    expect(result).not.toBeNull()
    expect(result?.switchedAccount.id).toBe("gamma.auth.json")
  })
})
