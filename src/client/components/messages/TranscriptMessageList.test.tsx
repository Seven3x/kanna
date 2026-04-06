import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TranscriptMessageList } from "./TranscriptMessageList"

function makeAssistantMessage(index: number) {
  return {
    id: `assistant-${index}`,
    kind: "assistant_text" as const,
    text: `assistant message ${index}`,
    timestamp: new Date(1_700_000_000_000 + index).toISOString(),
  }
}

describe("TranscriptMessageList", () => {
  test("renders a progressive loading control for large transcripts", () => {
    const messages = Array.from({ length: 200 }, (_, index) => makeAssistantMessage(index))
    const html = renderToStaticMarkup(
      <TranscriptMessageList
        messages={messages}
        isLoading={false}
      />
    )

    expect(html).toContain("Show 40 earlier messages (40 hidden)")
    expect(html).not.toContain("assistant message 0")
    expect(html).toContain("assistant message 40")
    expect(html).toContain("assistant message 199")
  })
})
