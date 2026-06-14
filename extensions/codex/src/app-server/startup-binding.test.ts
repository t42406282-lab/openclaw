import { beforeEach, describe, expect, it } from "vitest";
import type {
  CodexAppServerBindingIdentity,
  CodexAppServerThreadBinding,
} from "./session-binding.js";
import {
  resetCodexTestBindingStore,
  testCodexAppServerBindingStore,
} from "./session-binding.test-helpers.js";
import { rotateOversizedCodexAppServerStartupBinding, testing } from "./startup-binding.js";

const identity: CodexAppServerBindingIdentity = {
  kind: "session",
  agentId: "main",
  sessionId: "session-1",
};

function binding(
  currentTokens?: number,
  modelContextWindow = 100_000,
): CodexAppServerThreadBinding {
  return {
    threadId: "thread-1",
    cwd: "/workspace",
    ...(currentTokens === undefined
      ? {}
      : { nativeContextUsage: { currentTokens }, modelContextWindow }),
  };
}

async function rotate(
  current: CodexAppServerThreadBinding,
  overrides: Partial<Parameters<typeof rotateOversizedCodexAppServerStartupBinding>[0]> = {},
) {
  return await rotateOversizedCodexAppServerStartupBinding({
    binding: current,
    bindingIdentity: identity,
    bindingStore: testCodexAppServerBindingStore,
    config: undefined,
    ...overrides,
  });
}

describe("Codex app-server startup binding", () => {
  beforeEach(() => resetCodexTestBindingStore());

  it("keeps bindings until app-server usage can be refreshed during resume", async () => {
    const current = binding();
    await testCodexAppServerBindingStore.mutate(identity, { kind: "set", binding: current });

    await expect(rotate(current)).resolves.toEqual(current);
    await expect(testCodexAppServerBindingStore.read(identity)).resolves.toEqual(current);
  });

  it("does not infer covered binding usage from OpenClaw history", async () => {
    const current = {
      ...binding(),
      historyCoveredThrough: "2026-01-01T00:00:00.000Z",
    };
    await testCodexAppServerBindingStore.mutate(identity, { kind: "set", binding: current });

    await expect(rotate(current)).resolves.toEqual(current);
    await expect(testCodexAppServerBindingStore.read(identity)).resolves.toEqual(current);
  });

  it("rotates at the prepared native token fuse", async () => {
    const current = binding(80_000);
    await testCodexAppServerBindingStore.mutate(identity, { kind: "set", binding: current });

    await expect(rotate(current)).resolves.toBeUndefined();
    await expect(testCodexAppServerBindingStore.read(identity)).resolves.toBeUndefined();
  });

  it("reserves room for the projected turn", async () => {
    const current = binding(70_000);
    await testCodexAppServerBindingStore.mutate(identity, { kind: "set", binding: current });

    await expect(rotate(current, { projectedTurnTokens: 10_000 })).resolves.toBeUndefined();
  });

  it("uses the smaller prepared model and agent context windows", async () => {
    const current = binding(60_000, 200_000);
    await testCodexAppServerBindingStore.mutate(identity, { kind: "set", binding: current });

    await expect(rotate(current, { contextWindowTokens: 75_000 })).resolves.toBeUndefined();
  });

  it("preserves a concurrently replaced binding", async () => {
    const stale = binding(80_000);
    const current = { ...binding(1_000), threadId: "thread-2" };
    await testCodexAppServerBindingStore.mutate(identity, { kind: "set", binding: current });

    await expect(rotate(stale)).rejects.toThrow("binding changed while rotating thread-1");
    await expect(testCodexAppServerBindingStore.read(identity)).resolves.toEqual(current);
  });

  it("accepts a concurrently cleared binding as already rotated", async () => {
    const stale = binding(80_000);

    await expect(rotate(stale)).resolves.toBeUndefined();
    await expect(testCodexAppServerBindingStore.read(identity)).resolves.toBeUndefined();
  });

  it("rechecks a concurrently patched binding before rotating the same thread", async () => {
    const stale = binding(80_000);
    const current = { ...binding(1_000), serviceTier: "priority" as const };
    await testCodexAppServerBindingStore.mutate(identity, { kind: "set", binding: current });

    await expect(rotate(stale)).resolves.toEqual(current);
    await expect(testCodexAppServerBindingStore.read(identity)).resolves.toEqual(current);
  });

  it("honors configured reserve tokens and their floor", () => {
    expect(
      testing.resolveNativeThreadReserveTokens({
        agents: {
          defaults: {
            compaction: { reserveTokens: 5_000, reserveTokensFloor: 12_000 },
          },
        },
      } as never),
    ).toBe(12_000);
    expect(
      testing.resolveNativeThreadTokenFuse({
        modelContextWindow: 100_000,
        reserveTokens: 12_000,
      }),
    ).toBe(88_000);
  });
});
