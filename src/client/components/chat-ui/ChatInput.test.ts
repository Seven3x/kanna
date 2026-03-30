import { afterEach, describe, expect, test } from "bun:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { getStoredLockedComposerState, resolvePlanModeState, willExceedAttachmentLimit, ChatInput } from "./ChatInput"
import { useChatPreferencesStore } from "../../stores/chatPreferencesStore"
import { useChatInputStore } from "../../stores/chatInputStore"
import { PROVIDERS } from "../../../shared/types"

const INITIAL_STATE = useChatPreferencesStore.getInitialState()

afterEach(() => {
  useChatPreferencesStore.setState(INITIAL_STATE)
  useChatInputStore.setState({ drafts: {}, attachmentDrafts: {} })
})

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

  test("initializes locked Codex state from provider defaults instead of current composer settings", () => {
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
      modelOptions: { reasoningEffort: "high", fastMode: false },
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
