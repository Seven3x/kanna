import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { getLogDir, getLogFilePath } from "../shared/branding"

const MAX_DETAIL_LENGTH = 6000

function ensureLogDir() {
  mkdirSync(getLogDir(homedir()), { recursive: true })
}

function formatDetails(details: unknown) {
  if (details === undefined) return ""

  try {
    const serialized = JSON.stringify(details)
    if (!serialized) return ""
    return serialized.length > MAX_DETAIL_LENGTH
      ? `${serialized.slice(0, MAX_DETAIL_LENGTH)}... [truncated]`
      : serialized
  } catch {
    return String(details)
  }
}

export function appendLocalLog(scope: string, message: string, details?: unknown) {
  try {
    ensureLogDir()
    const timestamp = new Date().toISOString()
    const detailSuffix = formatDetails(details)
    const line = detailSuffix
      ? `${timestamp} [${scope}] ${message} ${detailSuffix}\n`
      : `${timestamp} [${scope}] ${message}\n`
    appendFileSync(getLogFilePath(homedir()), line, "utf8")
  } catch {
    // Avoid crashing the app because logging failed.
  }
}
