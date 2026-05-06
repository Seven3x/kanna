import { afterEach, describe, expect, test } from "bun:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ChatInput, getClipboardImageFiles, getStoredLockedComposerState, resolveLockedComposerState, resolvePlanModeState, willExceedAttachmentLimit } from "./ChatInput"
import { useChatPreferencesStore } from "../../stores/chatPreferencesStore"
import { useChatInputStore } from "../../stores/chatInputStore"
import { PROVIDERS } from "../../../shared/types"

const INITIAL_STATE = useChatPreferencesStore.getInitialState()

afterEach(() => {
  useChatPreferencesStore.setState(INITIAL_STATE)
  useChatInputStore.setState({ drafts: {}, attachmentDrafts: {} })
})

function createClipboardItem(args: {
  kind?: string
  type: string
  file?: File | null
}) {
  return {
    kind: args.kind ?? "file",
    type: args.type,
    getAsFile: () => args.file ?? null,
  }
}

describe("resolvePlanModeState", () => {
  test("updates composer plan mode when the provider is not locked", () => {
    const result = resolvePlanModeState({
      providerLocked: false,
      planMode: true,
      selectedProvider: "claude",
      composerState: INITIAL_STATE.legacyComposerState!,
      providerDefaults: INITIAL_STATE.providerDefaults,
      lockedComposerState: null,
    })

    expect(result).toEqual({
      composerPlanMode: true,
      lockedComposerState: null,
    })
  })

  test("updates only the locked state when the provider is locked", () => {
    const result = resolvePlanModeState({
      providerLocked: true,
      planMode: true,
      selectedProvider: "claude",
      composerState: {
        provider: "claude",
        model: "opus",
        modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
        planMode: false,
      },
      providerDefaults: INITIAL_STATE.providerDefaults,
      lockedComposerState: null,
    })

    expect(result.composerPlanMode).toBe(false)
    expect(result.lockedComposerState).toEqual({
      provider: "claude",
      model: "opus",
      modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
      planMode: true,
    })
  })

  test("initializes locked Codex state from the stored composer settings when the provider matches", () => {
    const result = resolvePlanModeState({
      providerLocked: true,
      planMode: false,
      selectedProvider: "codex",
      composerState: {
        provider: "codex",
        model: "gpt-5.4",
        modelOptions: { reasoningEffort: "xhigh", fastMode: true },
        planMode: true,
      },
      providerDefaults: {
        ...INITIAL_STATE.providerDefaults,
        codex: {
          model: "gpt-5.4",
          modelOptions: { reasoningEffort: "high", fastMode: false },
          planMode: false,
        },
      },
      lockedComposerState: null,
    })

    expect(result.composerPlanMode).toBe(true)
    expect(result.lockedComposerState).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      modelOptions: { reasoningEffort: "xhigh", fastMode: true },
      planMode: false,
    })
  })

  test("reuses existing locked state instead of resetting to provider defaults", () => {
    const result = resolvePlanModeState({
      providerLocked: true,
      planMode: false,
      selectedProvider: "claude",
      composerState: {
        provider: "claude",
        model: "haiku",
        modelOptions: { reasoningEffort: "low" },
        planMode: true,
      },
      providerDefaults: {
        ...INITIAL_STATE.providerDefaults,
        claude: {
          model: "sonnet",
          modelOptions: { reasoningEffort: "max", contextWindow: "200k" },
          planMode: true,
        },
      },
      lockedComposerState: {
        provider: "claude",
        model: "opus",
        modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
        planMode: true,
      },
    })

    expect(result.composerPlanMode).toBe(true)
    expect(result.lockedComposerState).toEqual({
      provider: "claude",
      model: "opus",
      modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
      planMode: false,
    })
  })
})

describe("resolveLockedComposerState", () => {
  test("prefers the persisted chat composer state when the provider already matches", () => {
    expect(resolveLockedComposerState({
      activeProvider: "codex",
      composerState: {
        provider: "codex",
        model: "gpt-5.4",
        modelOptions: { reasoningEffort: "xhigh", fastMode: true },
        planMode: true,
      },
      providerDefaults: INITIAL_STATE.providerDefaults,
      lockedComposerState: null,
    })).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      modelOptions: { reasoningEffort: "xhigh", fastMode: true },
      planMode: true,
    })
  })

  test("falls back to provider defaults when the stored composer uses another provider", () => {
    expect(resolveLockedComposerState({
      activeProvider: "codex",
      composerState: {
        provider: "claude",
        model: "opus",
        modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
        planMode: false,
      },
      providerDefaults: INITIAL_STATE.providerDefaults,
      lockedComposerState: null,
    })).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      modelOptions: { reasoningEffort: "high", fastMode: false },
      planMode: false,
    })
  })

})

describe("getStoredLockedComposerState", () => {
  test("returns the cached state for the selected chat when the provider matches", () => {
    const result = getStoredLockedComposerState({
      "chat-1": {
        provider: "codex",
        model: "gpt-5.4",
        modelOptions: { reasoningEffort: "low", fastMode: false },
        planMode: false,
      },
    }, "chat-1", "codex")

    expect(result).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      modelOptions: { reasoningEffort: "low", fastMode: false },
      planMode: false,
    })
  })

  test("ignores cached state from another provider", () => {
    const result = getStoredLockedComposerState({
      "chat-1": {
        provider: "claude",
        model: "sonnet",
        modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
        planMode: false,
      },
    }, "chat-1", "codex")

    expect(result).toBeNull()
  })
})

describe("willExceedAttachmentLimit", () => {
  test("rejects a batch that would push the composer above the total attachment limit", () => {
    expect(willExceedAttachmentLimit({
      currentAttachmentCount: 7,
      queuedAttachmentCount: 1,
      incomingAttachmentCount: 3,
    })).toBe(true)
  })

  test("allows a batch that exactly reaches the total attachment limit", () => {
    expect(willExceedAttachmentLimit({
      currentAttachmentCount: 7,
      queuedAttachmentCount: 1,
      incomingAttachmentCount: 2,
    })).toBe(false)
  })

  test("counts pasted files against the same total attachment limit", () => {
    const pastedFiles = getClipboardImageFiles([
      createClipboardItem({ type: "image/png", file: new File(["a"], "", { type: "image/png" }) }),
      createClipboardItem({ type: "image/png", file: new File(["b"], "", { type: "image/png" }) }),
    ], 123)

    expect(willExceedAttachmentLimit({
      currentAttachmentCount: 8,
      queuedAttachmentCount: 0,
      incomingAttachmentCount: pastedFiles.length,
    })).toBe(false)
  })
})

describe("getClipboardImageFiles", () => {
  test("returns image files from clipboard items", () => {
    const files = getClipboardImageFiles([
      createClipboardItem({ type: "image/png", file: new File(["img"], "pasted.png", { type: "image/png" }) }),
    ], 123)

    expect(files).toHaveLength(1)
    expect(files[0]?.name).toBe("pasted.png")
  })

  test("ignores non-image clipboard items", () => {
    const files = getClipboardImageFiles([
      createClipboardItem({ kind: "string", type: "text/plain" }),
      createClipboardItem({ type: "application/pdf", file: new File(["pdf"], "doc.pdf", { type: "application/pdf" }) }),
    ], 123)

    expect(files).toEqual([])
  })

  test("renames unnamed pasted images using the clipboard timestamp", () => {
    const files = getClipboardImageFiles([
      createClipboardItem({ type: "image/png", file: new File(["img"], "", { type: "image/png" }) }),
    ], 456)

    expect(files[0]?.name).toBe("clipboard-456.png")
  })

  test("preserves existing filenames from the browser", () => {
    const files = getClipboardImageFiles([
      createClipboardItem({ type: "image/jpeg", file: new File(["img"], "Screenshot 1.jpg", { type: "image/jpeg" }) }),
    ], 456)

    expect(files[0]?.name).toBe("Screenshot 1.jpg")
  })

  test("rewrites generic browser clipboard filenames", () => {
    const files = getClipboardImageFiles([
      createClipboardItem({ type: "image/png", file: new File(["img"], "image.png", { type: "image/png" }) }),
    ], 456)

    expect(files[0]?.name).toBe("clipboard-456.png")
  })

  test("generates distinct names for multiple unnamed images in one paste event", () => {
    const files = getClipboardImageFiles([
      createClipboardItem({ type: "image/png", file: new File(["a"], "", { type: "image/png" }) }),
      createClipboardItem({ type: "image/webp", file: new File(["b"], "", { type: "image/webp" }) }),
    ], 789)

    expect(files.map((file) => file.name)).toEqual([
      "clipboard-789.png",
      "clipboard-789-1.webp",
    ])
  })
})

describe("ChatInput", () => {
  test("renders highlighted skill badges with hover descriptions for existing skill mentions", () => {
    useChatInputStore.setState({
      drafts: {
        "chat-1": "Use $openai-docs here",
      },
      attachmentDrafts: {},
    })

    const html = renderToStaticMarkup(
      React.createElement(ChatInput, {
        onSubmit: async () => {},
        disabled: false,
        chatId: "chat-1",
        activeProvider: null,
        availableProviders: PROVIDERS,
        skills: [
          {
            name: "openai-docs",
            description: "Official OpenAI docs helper",
          },
        ],
      })
    )

    expect(html).toContain('data-skill-name="openai-docs"')
    expect(html).toContain('data-skill-description="Official OpenAI docs helper"')
    expect(html).toContain('title="Official OpenAI docs helper"')
    expect(html).toContain("$openai-docs")
  })
})
