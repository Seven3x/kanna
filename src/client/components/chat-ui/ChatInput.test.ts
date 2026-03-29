import { afterEach, describe, expect, test } from "bun:test"
import { getStoredLockedComposerState, resolvePlanModeState } from "./ChatInput"
import { useChatPreferencesStore } from "../../stores/chatPreferencesStore"

const INITIAL_STATE = useChatPreferencesStore.getInitialState()

afterEach(() => {
  useChatPreferencesStore.setState(INITIAL_STATE)
})

describe("resolvePlanModeState", () => {
  test("updates composer plan mode when the provider is not locked", () => {
    const result = resolvePlanModeState({
      providerLocked: false,
      planMode: true,
      selectedProvider: "claude",
      composerState: INITIAL_STATE.composerState,
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
