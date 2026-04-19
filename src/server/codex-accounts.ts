import { promises as fs } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { CodexAuthAccountSummary, CodexAuthMode, CodexAuthSnapshot } from "../shared/types"

interface ParsedAuthFile {
  email: string | null
  plan: string | null
  authMode: CodexAuthMode
  recordKey: string | null
  openaiApiKey: string | null
  lastRefresh: string | null
}

interface CodexAccountFileSummary extends CodexAuthAccountSummary {
  absolutePath: string
  recordKey: string | null
  openaiApiKey: string | null
}

interface RegistryAccountRecord {
  account_key?: unknown
  email?: unknown
  last_used_at?: unknown
  last_local_rollout?: {
    event_timestamp_ms?: unknown
  } | null
}

interface RegistryFile {
  active_account_key?: unknown
  active_account_activated_at_ms?: unknown
  accounts?: RegistryAccountRecord[]
}

interface AccountStateRecord {
  lastActivatedAt?: unknown
}

type AccountsStateFile = Record<string, AccountStateRecord>

function defaultParsedAuthFile(): ParsedAuthFile {
  return {
    email: null,
    plan: null,
    authMode: "chatgpt",
    recordKey: null,
    openaiApiKey: null,
    lastRefresh: null,
  }
}

function resolveCodexHome(homeDir = process.env.HOME ?? homedir()) {
  return path.join(homeDir, ".codex")
}

function normalizeEmail(email: string | null) {
  return email?.trim().toLowerCase() || null
}

function extractJwtPayload(idToken: string) {
  const parts = idToken.split(".")
  if (parts.length < 2) return null

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

function readObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function secondsToMilliseconds(value: number | null) {
  return value === null ? null : Math.trunc(value * 1000)
}

function parseAuthFileContents(contents: string): ParsedAuthFile {
  let payload: unknown
  try {
    payload = JSON.parse(contents)
  } catch {
    return defaultParsedAuthFile()
  }

  const root = readObject(payload)
  if (!root) return defaultParsedAuthFile()

  const openaiApiKey = readString(root.OPENAI_API_KEY)
  if (openaiApiKey) {
    return {
      email: null,
      plan: null,
      authMode: "apikey",
      recordKey: null,
      openaiApiKey,
      lastRefresh: null,
    }
  }

  const tokens = readObject(root.tokens)
  const accountId = readString(tokens?.account_id)
  const idToken = readString(tokens?.id_token)
  const lastRefresh = readString(root.last_refresh)
  const claims = idToken ? extractJwtPayload(idToken) : null
  const authClaims = readObject(claims?.["https://api.openai.com/auth"])
  const email = normalizeEmail(readString(claims?.email))
  const plan = readString(authClaims?.chatgpt_plan_type)
  const userId = readString(authClaims?.chatgpt_user_id) ?? readString(authClaims?.user_id)
  const recordKey = userId && accountId ? `${userId}::${accountId}` : null

  return {
    email,
    plan,
    authMode: "chatgpt",
    recordKey,
    openaiApiKey: null,
    lastRefresh,
  }
}

async function parseAuthFile(authPath: string) {
  const contents = await fs.readFile(authPath, "utf8")
  return {
    contents,
    parsed: parseAuthFileContents(contents),
  }
}

async function readRegistryFile(accountsDir: string) {
  const registryPath = path.join(accountsDir, "registry.json")
  try {
    const contents = await fs.readFile(registryPath, "utf8")
    const payload = JSON.parse(contents) as RegistryFile
    return payload
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return null
    }
    return null
  }
}

async function readAccountsStateFile(codexHome: string): Promise<AccountsStateFile> {
  const statePath = path.join(codexHome, "accounts-state.json")
  try {
    const contents = await fs.readFile(statePath, "utf8")
    const payload = JSON.parse(contents) as unknown
    const root = readObject(payload)
    if (!root) return {}

    const normalized: AccountsStateFile = {}
    for (const [accountId, record] of Object.entries(root)) {
      normalized[accountId] = readObject(record) ?? {}
    }
    return normalized
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return {}
    }
    return {}
  }
}

async function writeAccountsStateFile(codexHome: string, state: AccountsStateFile) {
  const statePath = path.join(codexHome, "accounts-state.json")
  await fs.mkdir(codexHome, { recursive: true })
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8")
}

function isActiveAccount(candidate: CodexAccountFileSummary, activeAuth: ParsedAuthFile | null) {
  if (!activeAuth) return false
  if (candidate.recordKey && activeAuth.recordKey && candidate.recordKey === activeAuth.recordKey) return true
  if (candidate.openaiApiKey && activeAuth.openaiApiKey && candidate.openaiApiKey === activeAuth.openaiApiKey) return true
  if (candidate.email && activeAuth.email && candidate.email === activeAuth.email) return true
  return false
}

async function readAccountsDirectory(accountsDir: string, activeAuth: ParsedAuthFile | null, codexHome: string) {
  const entries = await fs.readdir(accountsDir, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return []
    throw error
  })
  const registry = await readRegistryFile(accountsDir)
  const accountsState = await readAccountsStateFile(codexHome)
  const registryAccounts = Array.isArray(registry?.accounts) ? registry.accounts : []
  const activeAccountKey = readString(registry?.active_account_key)
  const activeActivatedAt = readNumber(registry?.active_account_activated_at_ms)

  const accounts = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".auth.json"))
      .map(async (entry) => {
        const absolutePath = path.join(accountsDir, entry.name)
        const { parsed } = await parseAuthFile(absolutePath)
        const registryRecord = registryAccounts.find((candidate) => {
          const candidateAccountKey = readString(candidate?.account_key)
          if (parsed.recordKey && candidateAccountKey === parsed.recordKey) {
            return true
          }
          const candidateEmail = normalizeEmail(readString(candidate?.email))
          return Boolean(parsed.email && candidateEmail && parsed.email === candidateEmail)
        })
        const savedState = readObject(accountsState[entry.name])
        const savedLastActivatedAt = readNumber(savedState?.lastActivatedAt)
        const lastLocalRollout = readObject(registryRecord?.last_local_rollout)
        const lastUsedAt = secondsToMilliseconds(readNumber(registryRecord?.last_used_at))
        const derivedLastActivatedAt = parsed.recordKey && activeAccountKey === parsed.recordKey ? activeActivatedAt : null
        const summary: CodexAccountFileSummary = {
          id: entry.name,
          email: parsed.email,
          plan: parsed.plan,
          authMode: parsed.authMode,
          isActive: false,
          isAvailable: true,
          lastRefresh: parsed.lastRefresh,
          lastActivatedAt: Math.max(savedLastActivatedAt ?? 0, derivedLastActivatedAt ?? 0) || null,
          lastChattedAt: readNumber(lastLocalRollout?.event_timestamp_ms) ?? lastUsedAt,
          absolutePath,
          recordKey: parsed.recordKey,
          openaiApiKey: parsed.openaiApiKey,
        }
        summary.isActive = isActiveAccount(summary, activeAuth)
        return summary
      })
  )

  return accounts.sort((left, right) => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1
    const leftLabel = left.email ?? left.id
    const rightLabel = right.email ?? right.id
    return leftLabel.localeCompare(rightLabel)
  })
}

export async function readCodexAuthSnapshot(homeDir?: string): Promise<CodexAuthSnapshot> {
  const codexHome = resolveCodexHome(homeDir)
  const authPath = path.join(codexHome, "auth.json")
  const accountsDir = path.join(codexHome, "accounts")

  let activeAuth: ParsedAuthFile | null = null
  try {
    const { parsed } = await parseAuthFile(authPath)
    activeAuth = parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      throw error
    }
  }

  const accounts = await readAccountsDirectory(accountsDir, activeAuth, codexHome)
  const activeAccount = accounts.find((account) => account.isActive) ?? null

  return {
    codexHome,
    hasActiveAuth: activeAuth !== null,
    activeAccountId: activeAccount?.id ?? null,
    activeEmail: activeAccount?.email ?? activeAuth?.email ?? null,
    accounts: accounts.map(({ absolutePath: _absolutePath, recordKey: _recordKey, openaiApiKey: _openaiApiKey, ...account }) => account),
  }
}

export async function switchCodexAuthAccount(accountId: string, homeDir?: string): Promise<CodexAuthSnapshot> {
  const codexHome = resolveCodexHome(homeDir)
  const accountsDir = path.join(codexHome, "accounts")
  const authPath = path.join(codexHome, "auth.json")
  const sourcePath = path.join(accountsDir, accountId)

  const snapshot = await readCodexAuthSnapshot(homeDir)
  if (!snapshot.accounts.some((account) => account.id === accountId)) {
    throw new Error("Codex account snapshot not found.")
  }

  const sourceContents = await fs.readFile(sourcePath, "utf8")
  await fs.mkdir(codexHome, { recursive: true })
  await fs.writeFile(authPath, sourceContents, "utf8")
  const accountState = await readAccountsStateFile(codexHome)
  accountState[accountId] = {
    ...readObject(accountState[accountId]),
    lastActivatedAt: Date.now(),
  }
  await writeAccountsStateFile(codexHome, accountState)
  return readCodexAuthSnapshot(homeDir)
}

function compareAccountOldestActivationFirst(left: CodexAuthAccountSummary, right: CodexAuthAccountSummary) {
  const leftActivatedAt = left.lastActivatedAt
  const rightActivatedAt = right.lastActivatedAt
  if (leftActivatedAt === null && rightActivatedAt !== null) return -1
  if (leftActivatedAt !== null && rightActivatedAt === null) return 1
  if (leftActivatedAt !== null && rightActivatedAt !== null && leftActivatedAt !== rightActivatedAt) {
    return leftActivatedAt - rightActivatedAt
  }

  const leftLabel = left.email ?? left.id
  const rightLabel = right.email ?? right.id
  return leftLabel.localeCompare(rightLabel)
}

export async function switchToNextCodexAuthAccount(homeDir?: string): Promise<{
  snapshot: CodexAuthSnapshot
  switchedAccount: CodexAuthAccountSummary
} | null> {
  const snapshot = await readCodexAuthSnapshot(homeDir)
  const nextAccount = [...snapshot.accounts]
    .filter((account) => account.isAvailable && !account.isActive)
    .sort(compareAccountOldestActivationFirst)[0]

  if (!nextAccount) {
    return null
  }

  const switchedSnapshot = await switchCodexAuthAccount(nextAccount.id, homeDir)
  const switchedAccount = switchedSnapshot.accounts.find((account) => account.isActive && account.id === nextAccount.id)
  if (!switchedAccount) {
    return null
  }

  return {
    snapshot: switchedSnapshot,
    switchedAccount,
  }
}
