import { describe, expect, test } from "bun:test"
import {
  applySkillSuggestion,
  createSkillHref,
  dedupeSkillNames,
  getSkillCompletionMatch,
  getSkillSuggestions,
  parseSkillHref,
  splitTextWithSkillMentions,
} from "./skills"

describe("skill helpers", () => {
  test("dedupes skill names", () => {
    expect(dedupeSkillNames([
      { name: "openai-docs" },
      { name: "imagegen" },
      { name: "openai-docs" },
    ])).toEqual(["imagegen", "openai-docs"])
  })

  test("splits text into plain text and skill mentions", () => {
    expect(splitTextWithSkillMentions("Use $openai-docs with $imagegen.", ["openai-docs", "imagegen"])).toEqual([
      { type: "text", value: "Use " },
      { type: "skill", name: "openai-docs", value: "$openai-docs" },
      { type: "text", value: " with " },
      { type: "skill", name: "imagegen", value: "$imagegen" },
      { type: "text", value: "." },
    ])
  })

  test("treats sentence punctuation after a skill mention as a boundary", () => {
    expect(splitTextWithSkillMentions("$imagegen.", ["imagegen"])).toEqual([
      { type: "skill", name: "imagegen", value: "$imagegen" },
      { type: "text", value: "." },
    ])
  })

  test("finds a completion match at the cursor", () => {
    expect(getSkillCompletionMatch("Use $open", 9)).toEqual({
      start: 4,
      end: 9,
      query: "open",
    })
  })

  test("returns null when the selection is not on a skill token", () => {
    expect(getSkillCompletionMatch("Use open", 8)).toBeNull()
    expect(getSkillCompletionMatch("Use $open", 4, 8)).toBeNull()
  })

  test("ranks suggestions by startsWith before includes", () => {
    expect(getSkillSuggestions([
      { name: "openai-docs" },
      { name: "find-openapi" },
      { name: "imagegen" },
    ], "open").map((skill) => skill.name)).toEqual([
      "openai-docs",
      "find-openapi",
    ])
  })

  test("applies a suggestion and moves the caret", () => {
    expect(applySkillSuggestion("Use $open", {
      start: 4,
      end: 9,
      query: "open",
    }, "openai-docs")).toEqual({
      text: "Use $openai-docs ",
      selectionStart: 17,
    })
  })

  test("encodes and parses skill hrefs", () => {
    const href = createSkillHref("openai-docs")
    expect(href).toBe("#skill:openai-docs")
    expect(parseSkillHref(href)).toBe("openai-docs")
    expect(parseSkillHref("https://example.com")).toBeNull()
  })
})
