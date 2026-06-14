/** Rotates Codex threads from persisted app-server usage, without polling rollout files. */
import {
  embeddedAgentLog,
  type EmbeddedRunAttemptParams,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import { isJsonObject } from "./protocol.js";
import type {
  CodexAppServerBindingIdentity,
  CodexAppServerBindingStore,
  CodexAppServerThreadBinding,
} from "./session-binding.js";

const DEFAULT_NATIVE_THREAD_MAX_TOKENS = 300_000;
const DEFAULT_NATIVE_THREAD_RESERVE_TOKENS = 20_000;
const MIN_PROMPT_BUDGET_TOKENS = 8_000;
const MIN_PROMPT_BUDGET_RATIO = 0.5;
const PROJECTED_CHARS_PER_TOKEN = 4;

export type CodexAppServerStartupTokenGuard = {
  contextWindowTokens?: number;
  projectedTurnTokens?: number;
};

/** Conservative prompt-size estimate used by both harness and bound turns. */
export function estimateCodexAppServerProjectedTurnTokens(params: {
  prompt: string;
  developerInstructions?: string;
}): number {
  const inputChars = params.prompt.length + (params.developerInstructions?.length ?? 0);
  return Math.max(1, Math.ceil(inputChars / PROJECTED_CHARS_PER_TOKEN));
}

function toNonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function readCompactionConfig(config: EmbeddedRunAttemptParams["config"] | undefined) {
  return isJsonObject(config?.agents?.defaults?.compaction)
    ? config.agents.defaults.compaction
    : undefined;
}

function resolveNativeThreadReserveTokens(
  config: EmbeddedRunAttemptParams["config"] | undefined,
): number {
  const compaction = readCompactionConfig(config);
  const reserveTokens = toNonNegativeInt(compaction?.reserveTokens);
  const reserveTokensFloor = toNonNegativeInt(compaction?.reserveTokensFloor);
  if (reserveTokens !== undefined) {
    return Math.max(reserveTokens, reserveTokensFloor ?? DEFAULT_NATIVE_THREAD_RESERVE_TOKENS);
  }
  return reserveTokensFloor ?? DEFAULT_NATIVE_THREAD_RESERVE_TOKENS;
}

function resolveNativeThreadTokenFuse(params: {
  modelContextWindow?: number;
  reserveTokens: number;
  projectedTurnTokens?: number;
}): number {
  const projectedTurnTokens = toNonNegativeInt(params.projectedTurnTokens) ?? 0;
  const contextWindow = params.modelContextWindow ?? DEFAULT_NATIVE_THREAD_MAX_TOKENS;
  const minPromptBudget = Math.min(
    MIN_PROMPT_BUDGET_TOKENS,
    Math.max(1, Math.floor(contextWindow * MIN_PROMPT_BUDGET_RATIO)),
  );
  const effectiveReserveTokens = Math.min(
    params.reserveTokens,
    Math.max(0, contextWindow - minPromptBudget),
  );
  return Math.max(1, contextWindow - effectiveReserveTokens - projectedTurnTokens);
}

function minPositive(values: Array<number | undefined>): number | undefined {
  const present = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  return present.length > 0 ? Math.min(...present) : undefined;
}

async function rotateCodexAppServerStartupBinding(params: {
  binding: CodexAppServerThreadBinding;
  bindingIdentity: CodexAppServerBindingIdentity;
  bindingStore: CodexAppServerBindingStore;
  message: string;
  details?: Record<string, unknown>;
}): Promise<undefined> {
  const cleared = await params.bindingStore.mutate(params.bindingIdentity, {
    kind: "clear",
    threadId: params.binding.threadId,
  });
  if (!cleared) {
    throw new Error(`Codex thread binding changed while rotating ${params.binding.threadId}`);
  }
  embeddedAgentLog.warn(params.message, {
    threadId: params.binding.threadId,
    ...params.details,
  });
  return undefined;
}

/** Clears a binding when the last app-server usage snapshot leaves too little turn headroom. */
export async function rotateOversizedCodexAppServerStartupBinding(params: {
  binding: CodexAppServerThreadBinding | undefined;
  bindingIdentity: CodexAppServerBindingIdentity;
  bindingStore: CodexAppServerBindingStore;
  config: EmbeddedRunAttemptParams["config"] | undefined;
  contextWindowTokens?: number;
  projectedTurnTokens?: number;
  refreshedNativeContextUsage?: {
    currentTokens: number;
    modelContextWindow?: number;
  };
}): Promise<CodexAppServerThreadBinding | undefined> {
  const expectedBinding = params.binding;
  if (!expectedBinding?.threadId) {
    return expectedBinding;
  }
  return await params.bindingStore.withLease(params.bindingIdentity, async () => {
    const currentBinding = await params.bindingStore.read(params.bindingIdentity);
    if (!currentBinding) {
      // A concurrent reset already completed the rotation. Continue on the
      // canonical empty state instead of reviving or rejecting its stale thread.
      return undefined;
    }
    if (currentBinding.threadId !== expectedBinding.threadId) {
      throw new Error(`Codex thread binding changed while rotating ${expectedBinding.threadId}`);
    }
    const refreshedUsage = params.refreshedNativeContextUsage;
    const binding = refreshedUsage
      ? {
          ...currentBinding,
          nativeContextUsage: { currentTokens: refreshedUsage.currentTokens },
          ...(refreshedUsage.modelContextWindow !== undefined
            ? { modelContextWindow: refreshedUsage.modelContextWindow }
            : {}),
        }
      : currentBinding;
    const usage = binding.nativeContextUsage;
    if (!usage) {
      return binding;
    }
    const modelContextWindow = minPositive([
      binding.modelContextWindow,
      params.contextWindowTokens,
    ]);
    const reserveTokens = resolveNativeThreadReserveTokens(params.config);
    const maxTokens = resolveNativeThreadTokenFuse({
      modelContextWindow,
      reserveTokens,
      projectedTurnTokens: params.projectedTurnTokens,
    });
    if (usage.currentTokens < maxTokens) {
      return binding;
    }
    return await rotateCodexAppServerStartupBinding({
      binding,
      bindingIdentity: params.bindingIdentity,
      bindingStore: params.bindingStore,
      message:
        "codex app-server thread usage left too little prompt headroom; starting a fresh thread",
      details: {
        currentTokens: usage.currentTokens,
        maxTokens,
        modelContextWindow,
        reserveTokens,
        projectedTurnTokens: params.projectedTurnTokens,
      },
    });
  });
}

export const testing = {
  resolveNativeThreadReserveTokens,
  resolveNativeThreadTokenFuse,
};
