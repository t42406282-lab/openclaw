// Built-in provider registration tests cover lazy provider wrapper behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context, Model } from "../types.js";

function makeHostileMistralModel(): Model<"mistral-conversations"> {
  const model = {
    id: "mistral-large-latest",
    name: "Mistral Large",
    api: "mistral-conversations",
    provider: "mistral",
    baseUrl: "https://api.mistral.ai",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8192,
  } satisfies Model<"mistral-conversations">;

  for (const key of ["api", "provider", "id"] as const) {
    Object.defineProperty(model, key, {
      enumerable: true,
      get() {
        throw new Error(`revoked ${key}`);
      },
    });
  }

  return model;
}

const context = {
  messages: [{ role: "user", content: "hello", timestamp: 0 }],
} satisfies Context;

describe("built-in lazy provider streams", () => {
  afterEach(() => {
    vi.doUnmock("./mistral.js");
    vi.resetModules();
  });

  it.each([
    ["stream", "streamMistral"],
    ["simple stream", "streamSimpleMistral"],
  ] as const)("keeps lazy-load %s errors reachable with hostile model identity", async (_, key) => {
    vi.doMock("./mistral.js", () => ({
      get streamMistral() {
        throw new Error("lazy provider export exploded");
      },
      get streamSimpleMistral() {
        throw new Error("lazy provider export exploded");
      },
    }));

    const providers = await import("./register-builtins.js");
    const stream = providers[key](makeHostileMistralModel(), context);

    const result = await stream.result();

    expect(result.stopReason).toBe("error");
    expect(result.api).toBe("mistral-conversations");
    expect(result.provider).toBe("unknown");
    expect(result.model).toBe("unknown");
    expect(result.errorMessage).toBe("lazy provider export exploded");
  });
});
