import type { ProjectSkillSummary } from "../../shared/types"

export interface SkillMentionPartText {
  type: "text"
  value: string
}

export interface SkillMentionPartSkill {
  type: "skill"
  name: string
  value: string
}

export type SkillMentionPart = SkillMentionPartText | SkillMentionPartSkill

export interface SkillCompletionMatch {
  start: number
  end: number
  query: string
}

function isSkillChar(value: string | undefined) {
  return Boolean(value && /[A-Za-z0-9_.-]/.test(value))
}

function isSkillMentionContinuation(text: string, index: number) {
  const nextChar = text[index]
  if (!nextChar) return false
  if (/[A-Za-z0-9_-]/.test(nextChar)) return true
  if (nextChar === ".") {
    return /[A-Za-z0-9_-]/.test(text[index + 1] ?? "")
  }
  return false
}

export function dedupeSkillNames(skills: ProjectSkillSummary[] | undefined): string[] {
  return [...new Set((skills ?? []).map((skill) => skill.name).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export function splitTextWithSkillMentions(text: string, skillNames: string[]): SkillMentionPart[] {
  const dedupedSkillNames = [...new Set(skillNames)].sort((a, b) => b.length - a.length)
  if (dedupedSkillNames.length === 0 || !text.includes("$")) {
    return [{ type: "text", value: text }]
  }

  const parts: SkillMentionPart[] = []
  let cursor = 0

  while (cursor < text.length) {
    const markerIndex = text.indexOf("$", cursor)
    if (markerIndex === -1) {
      break
    }

    const previousChar = text[markerIndex - 1]
    if (markerIndex > 0 && isSkillChar(previousChar)) {
      cursor = markerIndex + 1
      continue
    }

    const matchedSkill = dedupedSkillNames.find((name) => {
      if (!text.startsWith(name, markerIndex + 1)) {
        return false
      }
      return !isSkillMentionContinuation(text, markerIndex + 1 + name.length)
    })

    if (!matchedSkill) {
      cursor = markerIndex + 1
      continue
    }

    if (markerIndex > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, markerIndex) })
    }

    parts.push({
      type: "skill",
      name: matchedSkill,
      value: `$${matchedSkill}`,
    })
    cursor = markerIndex + matchedSkill.length + 1
  }

  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) })
  }

  return parts.length > 0 ? parts : [{ type: "text", value: text }]
}

export function getSkillCompletionMatch(text: string, selectionStart: number | null | undefined, selectionEnd?: number | null) {
  if (selectionStart === null || selectionStart === undefined) return null
  if (selectionEnd !== undefined && selectionEnd !== null && selectionEnd !== selectionStart) return null

  let cursor = selectionStart - 1
  while (cursor >= 0 && isSkillChar(text[cursor])) {
    cursor -= 1
  }

  if (text[cursor] !== "$") {
    return null
  }

  const previousChar = text[cursor - 1]
  if (cursor > 0 && isSkillChar(previousChar)) {
    return null
  }

  return {
    start: cursor,
    end: selectionStart,
    query: text.slice(cursor + 1, selectionStart),
  } satisfies SkillCompletionMatch
}

export function getSkillSuggestions(skills: ProjectSkillSummary[] | undefined, query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  return [...(skills ?? [])]
    .sort((left, right) => left.name.localeCompare(right.name))
    .sort((left, right) => {
      const leftName = left.name.toLowerCase()
      const rightName = right.name.toLowerCase()
      const leftStarts = normalizedQuery ? leftName.startsWith(normalizedQuery) : false
      const rightStarts = normalizedQuery ? rightName.startsWith(normalizedQuery) : false
      if (leftStarts !== rightStarts) {
        return leftStarts ? -1 : 1
      }

      const leftIncludes = normalizedQuery ? leftName.includes(normalizedQuery) : true
      const rightIncludes = normalizedQuery ? rightName.includes(normalizedQuery) : true
      if (leftIncludes !== rightIncludes) {
        return leftIncludes ? -1 : 1
      }

      return left.name.localeCompare(right.name)
    })
    .filter((skill) => {
      if (!normalizedQuery) return true
      const name = skill.name.toLowerCase()
      return name.startsWith(normalizedQuery) || name.includes(normalizedQuery)
    })
}

export function applySkillSuggestion(text: string, match: SkillCompletionMatch, skillName: string) {
  const suffix = text.slice(match.end)
  const nextChar = suffix[0]
  const needsTrailingSpace = !nextChar || !/\s|[.,!?;:)\]}]/.test(nextChar)
  const replacement = `$${skillName}${needsTrailingSpace ? " " : ""}`
  const nextText = `${text.slice(0, match.start)}${replacement}${suffix}`

  return {
    text: nextText,
    selectionStart: match.start + replacement.length,
  }
}

export function createSkillHref(skillName: string) {
  return `#skill:${encodeURIComponent(skillName)}`
}

export function parseSkillHref(href: string | undefined | null) {
  if (!href?.startsWith("#skill:")) {
    return null
  }

  try {
    return decodeURIComponent(href.slice("#skill:".length))
  } catch {
    return null
  }
}
