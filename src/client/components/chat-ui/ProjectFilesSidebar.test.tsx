import { describe, expect, test } from "bun:test"
import { splitFileNameForDisplay } from "./ProjectFilesSidebar"

describe("splitFileNameForDisplay", () => {
  test("keeps the final extension visible for long file names", () => {
    expect(splitFileNameForDisplay("very.long.component.spec.tsx")).toEqual({
      base: "very.long.component.spec",
      extension: ".tsx",
    })
  })

  test("leaves hidden files without a suffix split", () => {
    expect(splitFileNameForDisplay(".gitignore")).toEqual({
      base: ".gitignore",
      extension: "",
    })
  })
})
