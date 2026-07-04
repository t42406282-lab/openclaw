import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PassiveRoomObservationAdmissionError } from "../harness/passive-runtime.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  loadRunOverflowCompactionHarness,
  mockedResolveModelAsync,
  mockedRunEmbeddedAttempt,
  overflowBaseRunParams,
  resetRunOverflowCompactionHarnessMocks,
} from "./run.overflow-compaction.harness.js";

let runEmbeddedAgent: typeof import("./run.js").runEmbeddedAgent;

const supportedModel = {
  id: "gpt-5.5",
  provider: "openai",
  contextWindow: 200_000,
  api: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  headers: {},
};

const passiveRunParams = {
  ...overflowBaseRunParams,
  provider: "openai",
  model: "gpt-5.5",
  inputProvenance: {
    kind: "room_observation" as const,
    sourceChannel: "slack",
  },
  roomObservationSystemPrompt: "Only make safe, source-bound room comments.",
};

function resolveModelWith(overrides: Partial<typeof supportedModel>) {
  mockedResolveModelAsync.mockResolvedValueOnce({
    model: { ...supportedModel, ...overrides },
    error: null,
    authStorage: { setRuntimeApiKey: vi.fn() },
    modelRegistry: {},
  });
}

describe("runEmbeddedAgent passive resolved-model admission", () => {
  beforeAll(async () => {
    ({ runEmbeddedAgent } = await loadRunOverflowCompactionHarness());
  });

  beforeEach(() => {
    resetRunOverflowCompactionHarnessMocks();
  });

  it.each([
    ["API", { api: "openai-chatgpt-responses" }],
    ["base URL", { baseUrl: "https://proxy.example/v1" }],
    ["headers", { headers: { "X-Proxy": "enabled" } }],
  ])("rejects an unsupported resolved %s before model invocation", async (_label, overrides) => {
    resolveModelWith(overrides);

    const run = runEmbeddedAgent(passiveRunParams);

    await expect(run).rejects.toMatchObject({
      name: "PassiveRoomObservationAdmissionError",
      code: "runtime_model",
      provider: "openai",
      model: "gpt-5.5",
    } satisfies Partial<PassiveRoomObservationAdmissionError>);
    expect(mockedRunEmbeddedAttempt).not.toHaveBeenCalled();
  });

  it("keeps the supported core OpenAI resolved model admitted", async () => {
    resolveModelWith({});
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(makeAttemptResult({ promptError: null }));

    await runEmbeddedAgent(passiveRunParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledOnce();
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        disableTrajectories: true,
        roomObservationSystemPrompt: passiveRunParams.roomObservationSystemPrompt,
      }),
    );
  });

  it("waits for passive transcript approval after the attempt reports persistence", async () => {
    resolveModelWith({});
    const events: string[] = [];
    let releasePersistence: () => void = () => {};
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const persistApproved = vi.fn(async () => {
      events.push("persistence:start");
      await persistenceGate;
      events.push("persistence:end");
      return undefined;
    });
    mockedRunEmbeddedAttempt.mockImplementationOnce(async (params) => {
      const onUserMessagePersisted = (
        params as {
          onUserMessagePersisted?: (message: {
            role: "user";
            content: string;
            timestamp: number;
          }) => void | Promise<void>;
        }
      ).onUserMessagePersisted;
      onUserMessagePersisted?.({ role: "user", content: "observed", timestamp: 1 });
      events.push("attempt:return");
      return makeAttemptResult({ promptError: null });
    });

    let runSettled = false;
    const run = runEmbeddedAgent({
      ...passiveRunParams,
      userTurnTranscriptRecorder: { persistApproved } as never,
    });
    void run.then(
      () => {
        runSettled = true;
      },
      () => {
        runSettled = true;
      },
    );

    await vi.waitFor(() => expect(persistApproved).toHaveBeenCalledOnce());
    expect(events).toEqual(["attempt:return", "persistence:start"]);
    expect(runSettled).toBe(false);

    releasePersistence();
    await run;

    expect(events).toEqual(["attempt:return", "persistence:start", "persistence:end"]);
    expect(runSettled).toBe(true);
  });

  it("fails the passive run when transcript approval fails", async () => {
    resolveModelWith({});
    const persistenceError = new Error("passive transcript approval failed");
    const persistApproved = vi.fn(async () => {
      throw persistenceError;
    });
    mockedRunEmbeddedAttempt.mockImplementationOnce(async (params) => {
      const onUserMessagePersisted = (
        params as {
          onUserMessagePersisted?: (message: {
            role: "user";
            content: string;
            timestamp: number;
          }) => void | Promise<void>;
        }
      ).onUserMessagePersisted;
      onUserMessagePersisted?.({ role: "user", content: "observed", timestamp: 1 });
      return makeAttemptResult({ promptError: null });
    });

    await expect(
      runEmbeddedAgent({
        ...passiveRunParams,
        userTurnTranscriptRecorder: { persistApproved } as never,
      }),
    ).rejects.toBe(persistenceError);
    expect(persistApproved).toHaveBeenCalledOnce();
  });

  it("uses a private temporary directory and file for the passive transcript", async () => {
    resolveModelWith({});
    let transcriptPath: string | undefined;
    let transcriptDirectory: string | undefined;
    mockedRunEmbeddedAttempt.mockImplementationOnce(async (params) => {
      const sessionFile = (params as { sessionFile?: unknown }).sessionFile;
      if (typeof sessionFile !== "string") {
        throw new Error("expected a passive session file");
      }
      transcriptPath = sessionFile;
      transcriptDirectory = path.dirname(sessionFile);

      expect(path.basename(transcriptDirectory)).toMatch(/^openclaw-passive-room-/);
      expect(path.basename(sessionFile)).toBe("session.jsonl");
      if (process.platform !== "win32") {
        const [directoryStat, transcriptStat] = await Promise.all([
          fs.stat(transcriptDirectory),
          fs.stat(sessionFile),
        ]);
        expect(directoryStat.mode & 0o777).toBe(0o700);
        expect(transcriptStat.mode & 0o777).toBe(0o600);
      }

      return makeAttemptResult({ promptError: null });
    });

    await runEmbeddedAgent(passiveRunParams);

    if (!transcriptPath || !transcriptDirectory) {
      throw new Error("expected passive transcript paths");
    }
    await expect(fs.stat(transcriptPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(transcriptDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
