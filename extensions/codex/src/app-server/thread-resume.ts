import {
  assertCodexThreadResumeSubscription,
  CodexAppServerUnsafeSubscriptionError,
} from "./attempt-client-cleanup.js";
/** Owns Codex thread/resume subscription safety and restored usage replay. */
import { CodexAppServerRpcError, type CodexAppServerClient } from "./client.js";
import { readCodexNotificationThreadId } from "./notification-correlation.js";
import { assertCodexThreadResumeResponse } from "./protocol-validators.js";
import {
  isJsonObject,
  type CodexServerNotification,
  type CodexThreadResumeParams,
  type CodexThreadResumeResponse,
  type JsonValue,
} from "./protocol.js";
import type { CodexAppServerThreadBinding } from "./session-binding.js";

const RESTORED_USAGE_WAIT_MS = 5_000;

export type CodexNativeContextUsageUpdate = NonNullable<
  CodexAppServerThreadBinding["nativeContextUsage"]
> & {
  modelContextWindow?: number;
};

/** Resumes one thread and retires the physical client when acceptance is indeterminate. */
export async function resumeCodexAppServerThread(params: {
  client: CodexAppServerClient;
  abandonClient: () => Promise<void>;
  request: CodexThreadResumeParams;
  timeoutMs?: number;
  signal?: AbortSignal;
  refreshNativeContextUsage?: boolean;
}): Promise<{
  response: CodexThreadResumeResponse;
  nativeContextUsage?: CodexNativeContextUsageUpdate;
}> {
  const threadId = params.request.threadId;
  const usageWatch = params.refreshNativeContextUsage
    ? watchCodexNativeContextUsage(params.client, threadId)
    : undefined;
  try {
    let response: CodexThreadResumeResponse;
    try {
      response = assertCodexThreadResumeResponse(
        await params.client.request(
          "thread/resume",
          {
            ...params.request,
            ...(usageWatch ? { excludeTurns: false } : {}),
          },
          {
            ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
            ...(params.signal ? { signal: params.signal } : {}),
          },
        ),
      );
      assertCodexThreadResumeSubscription(threadId, response.thread.id);
    } catch (error) {
      if (error instanceof CodexAppServerRpcError) {
        throw error;
      }
      try {
        await params.abandonClient();
      } catch (abandonError) {
        throw new CodexAppServerUnsafeSubscriptionError(
          `Codex thread/resume client could not be retired for ${threadId}`,
          { cause: abandonError },
        );
      }
      if (error instanceof CodexAppServerUnsafeSubscriptionError) {
        throw error;
      }
      throw new CodexAppServerUnsafeSubscriptionError(
        error instanceof Error
          ? error.message
          : `Codex thread/resume outcome is indeterminate for ${threadId}`,
        { cause: error },
      );
    }
    const hasRestoredTurns = response.thread.turns.length > 0;
    const nativeContextUsage = usageWatch
      ? await usageWatch.wait({
          waitForReplay: hasRestoredTurns,
          timeoutMs: Math.min(params.timeoutMs ?? RESTORED_USAGE_WAIT_MS, RESTORED_USAGE_WAIT_MS),
          signal: params.signal,
        })
      : undefined;
    return {
      response,
      ...(nativeContextUsage ? { nativeContextUsage } : {}),
    };
  } finally {
    usageWatch?.dispose();
  }
}

/** Reads the authoritative per-context usage carried by Codex notifications. */
export function readCodexNativeContextUsage(
  notification: CodexServerNotification,
): CodexNativeContextUsageUpdate | undefined {
  const params = isJsonObject(notification.params) ? notification.params : undefined;
  const tokenUsage = params && isJsonObject(params.tokenUsage) ? params.tokenUsage : undefined;
  const current = tokenUsage && isJsonObject(tokenUsage.last) ? tokenUsage.last : undefined;
  const currentTokens = current ? readNonNegativeFiniteNumber(current.totalTokens) : undefined;
  if (currentTokens === undefined) {
    return undefined;
  }
  const modelContextWindow = readPositiveFiniteNumber(tokenUsage?.modelContextWindow);
  return {
    currentTokens,
    ...(modelContextWindow !== undefined ? { modelContextWindow } : {}),
  };
}

function watchCodexNativeContextUsage(client: CodexAppServerClient, threadId: string) {
  let current: CodexNativeContextUsageUpdate | undefined;
  let resolveUsage!: (usage: CodexNativeContextUsageUpdate) => void;
  const usage = new Promise<CodexNativeContextUsageUpdate>((resolve) => {
    resolveUsage = resolve;
  });
  const dispose = client.addNotificationHandler((notification) => {
    const notificationParams = isJsonObject(notification.params) ? notification.params : undefined;
    if (
      notification.method !== "thread/tokenUsage/updated" ||
      !notificationParams ||
      readCodexNotificationThreadId(notificationParams) !== threadId
    ) {
      return;
    }
    const next = readCodexNativeContextUsage(notification);
    if (!next || current) {
      return;
    }
    current = next;
    resolveUsage(next);
  });
  return {
    dispose,
    async wait(options: {
      waitForReplay: boolean;
      timeoutMs: number;
      signal?: AbortSignal;
    }): Promise<CodexNativeContextUsageUpdate | undefined> {
      if (current || !options.waitForReplay) {
        return current;
      }
      throwIfAborted(options.signal);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let removeAbort: (() => void) | undefined;
      const unavailable = new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), Math.max(1, options.timeoutMs));
        timeout.unref?.();
      });
      const aborted = new Promise<never>((_resolve, reject) => {
        const signal = options.signal;
        if (!signal) {
          return;
        }
        const onAbort = () => reject(abortError(signal));
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbort = () => signal.removeEventListener("abort", onAbort);
      });
      try {
        return await Promise.race([usage, unavailable, aborted]);
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
        removeAbort?.();
      }
    },
  };
}

function readNonNegativeFiniteNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function readPositiveFiniteNumber(value: JsonValue | undefined): number | undefined {
  const number = readNonNegativeFiniteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(String(signal.reason ?? "Codex thread/resume aborted"));
}
