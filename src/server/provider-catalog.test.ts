import { describe, expect, test } from "bun:test"
import {
  codexServiceTierFromModelOptions,
  getServerProviderCatalog,
  normalizeClaudeModelOptions,
  normalizeCodexModelOptions,
  normalizeServerModel,
} from "./provider-catalog"
import { resolveClaudeApiModelId } from "../shared/types"

describe("provider catalog normalization", () => {
  test("maps legacy Claude effort into shared model options", () => {
    expect(normalizeClaudeModelOptions("opus", undefined, "max")).toEqual({
      reasoningEffort: "max",
      contextWindow: "200k",
    })
  })

  test("normalizes Claude context window only for supported models", () => {
    expect(normalizeClaudeModelOptions("sonnet", {
      claude: {
        reasoningEffort: "medium",
        contextWindow: "1m",
      },
    })).toEqual({
      reasoningEffort: "medium",
      contextWindow: "1m",
    })

    expect(normalizeClaudeModelOptions("haiku", {
      claude: {
        reasoningEffort: "medium",
        contextWindow: "1m",
      },
    })).toEqual({
      reasoningEffort: "medium",
    })
  })

  test("normalizes Codex model options and fast mode defaults", () => {
    expect(normalizeCodexModelOptions(undefined)).toEqual({
      reasoningEffort: "high",
      fastMode: false,
    })

    const normalized = normalizeCodexModelOptions({
      codex: {
        reasoningEffort: "xhigh",
        fastMode: true,
      },
    })

    expect(normalized).toEqual({
      reasoningEffort: "xhigh",
      fastMode: true,
    })
    expect(codexServiceTierFromModelOptions(normalized)).toBe("fast")
  })

  test("exposes the expanded Codex model catalog and preserves supported selections", () => {
    expect(getServerProviderCatalog("codex").models.map((model) => model.id)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5-codex",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
    ])
    expect(normalizeServerModel("codex", "gpt-5.2-codex")).toBe("gpt-5.2-codex")
    expect(normalizeServerModel("codex", "unknown-model")).toBe("gpt-5.4")
  })

  test("resolves Claude API model ids for 1m context window", () => {
    expect(resolveClaudeApiModelId("opus", "1m")).toBe("opus[1m]")
    expect(resolveClaudeApiModelId("sonnet", "200k")).toBe("sonnet")
  })
})
