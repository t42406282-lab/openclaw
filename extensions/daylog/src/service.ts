// Daylog background service: snapshot capture loop, batch analysis, retention.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  OpenClawConfig,
  OpenClawPluginApi,
  PluginLogger,
} from "openclaw/plugin-sdk/plugin-entry";
import {
  CARD_LOOKBACK_MS,
  MAX_FRAMES_PER_CALL,
  parseCardsJson,
  parseObservationSegments,
  pickKeyframeId,
  revisionWindow,
  sampleFrames,
  selectBatchFrames,
} from "./analyze.js";
import { parseModelRef, type DaylogConfig } from "./config.js";
import {
  buildAskPrompt,
  buildCardsCorrectionPrompt,
  buildCardsPrompt,
  buildObservationInstructions,
  buildStandupPrompt,
  OBSERVATION_JSON_SCHEMA,
} from "./prompts.js";
import { dayKeyFor, DaylogStore } from "./store.js";
import type { DaylogBatch, DaylogCard } from "./types.js";

const ANALYSIS_TICK_MS = 60 * 1000;
const PRUNE_TICK_MS = 60 * 60 * 1000;
const CAPTURE_FAILURE_PAUSE_TICKS = 10;
const CAPTURE_FAILURE_THRESHOLD = 3;
const JPEG_QUALITY = 0.6;

type SnapshotPayload = {
  format?: string;
  base64?: string;
  width?: number;
  height?: number;
  error?: string;
};

/** Capture commands in preference order: app nodes first, headless node hosts second. */
const CAPTURE_COMMANDS = ["screen.snapshot", "daylog.snapshot"] as const;

export type DaylogStatus = {
  captureEnabled: boolean;
  capturePaused: boolean;
  captureIntervalSeconds: number;
  analysisIntervalMinutes: number;
  retentionDays: number;
  nodeId?: string;
  nodeName?: string;
  lastCaptureAtMs?: number;
  lastCaptureError?: string;
  pendingFrames: number;
  analysisRunning: boolean;
  lastBatch?: Pick<DaylogBatch, "id" | "day" | "status" | "endMs" | "error">;
  visionModel?: string;
  visionModelSource: "config" | "media-defaults" | "missing";
  today: string;
  todayCards: number;
  dataDir: string;
};

export class DaylogService {
  private store: DaylogStore | null = null;
  private captureTimer: NodeJS.Timeout | null = null;
  private analysisTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private captureInFlight = false;
  private analysisInFlight = false;
  private capturePaused = false;
  private captureFailures = 0;
  private captureBackoffTicks = 0;
  private lastCaptureAtMs: number | undefined;
  private lastCaptureError: string | undefined;
  private cachedNode: { nodeId: string; displayName?: string; command: string } | null = null;

  constructor(
    private readonly config: DaylogConfig,
    private readonly deps: {
      runtime: NonNullable<OpenClawPluginApi["runtime"]>;
      fullConfig: OpenClawConfig;
      logger: PluginLogger;
      dataDir: string;
    },
  ) {}

  start(): void {
    this.store = new DaylogStore(this.deps.dataDir);
    // Batches interrupted by a gateway restart go back to pending.
    this.store.resetRunningBatches();
    this.captureTimer = setInterval(() => {
      void this.captureTick();
    }, this.config.captureIntervalSeconds * 1000);
    this.captureTimer.unref?.();
    this.analysisTimer = setInterval(() => {
      void this.analysisTick();
    }, ANALYSIS_TICK_MS);
    this.analysisTimer.unref?.();
    this.pruneTimer = setInterval(() => {
      this.prune();
    }, PRUNE_TICK_MS);
    this.pruneTimer.unref?.();
    this.prune();
    this.deps.logger.info(
      `daylog: started (capture every ${this.config.captureIntervalSeconds}s, analysis window ${this.config.analysisIntervalMinutes}m, data ${this.deps.dataDir})`,
    );
  }

  stop(): void {
    for (const timer of [this.captureTimer, this.analysisTimer, this.pruneTimer]) {
      if (timer) {
        clearInterval(timer);
      }
    }
    this.captureTimer = null;
    this.analysisTimer = null;
    this.pruneTimer = null;
    this.store?.close();
    this.store = null;
  }

  private requireStore(): DaylogStore {
    if (!this.store) {
      throw new Error("Daylog service is not running");
    }
    return this.store;
  }

  // ── Capture ────────────────────────────────────────────────────────

  setCapturePaused(paused: boolean): void {
    this.capturePaused = paused;
    if (!paused) {
      this.captureBackoffTicks = 0;
      this.captureFailures = 0;
    }
  }

  private async resolveNode(): Promise<{
    nodeId: string;
    displayName?: string;
    command: string;
  } | null> {
    if (this.cachedNode) {
      return this.cachedNode;
    }
    const { nodes } = await this.deps.runtime.nodes.list({ connected: true });
    const captureCommand = (node: { commands?: string[] }) =>
      CAPTURE_COMMANDS.find((command) => (node.commands ?? []).includes(command));
    const candidates = nodes
      .filter((node) => captureCommand(node) !== undefined)
      .toSorted((a, b) => a.nodeId.localeCompare(b.nodeId));
    const wanted = this.config.nodeId?.toLowerCase();
    const picked = wanted
      ? candidates.find(
          (node) =>
            node.nodeId.toLowerCase() === wanted || node.displayName?.toLowerCase() === wanted,
        )
      : candidates[0];
    const command = picked ? captureCommand(picked) : undefined;
    if (!picked || !command) {
      return null;
    }
    this.cachedNode = { nodeId: picked.nodeId, displayName: picked.displayName, command };
    return this.cachedNode;
  }

  private async captureTick(): Promise<void> {
    if (!this.config.captureEnabled || this.capturePaused || this.captureInFlight || !this.store) {
      return;
    }
    if (this.captureBackoffTicks > 0) {
      this.captureBackoffTicks -= 1;
      return;
    }
    this.captureInFlight = true;
    try {
      const node = await this.resolveNode();
      if (!node) {
        this.lastCaptureError = "no connected node exposes screen.snapshot or daylog.snapshot";
        return;
      }
      const raw = (await this.deps.runtime.nodes.invoke({
        nodeId: node.nodeId,
        command: node.command,
        params: {
          screenIndex: this.config.screenIndex,
          maxWidth: this.config.maxWidth,
          quality: JPEG_QUALITY,
          format: "jpeg",
        },
        timeoutMs: 30_000,
      })) as SnapshotPayload | null;
      if (raw?.error) {
        throw new Error(raw.error);
      }
      const base64 = raw?.base64;
      if (!base64) {
        throw new Error(`${node.command} returned no image payload`);
      }
      const buffer = Buffer.from(base64, "base64");
      const capturedAtMs = Date.now();
      const day = dayKeyFor(capturedAtMs);
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      // Unchanged consecutive frames mean the user is idle (or away); they are
      // stored for the filmstrip but excluded from analysis batches.
      const idle = this.store.lastFrame()?.contentHash === contentHash;
      const filePath = this.store.frameFilePath(day, capturedAtMs);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, buffer);
      this.store.insertFrame({
        capturedAtMs,
        day,
        path: filePath,
        screenIndex: this.config.screenIndex,
        width: raw?.width,
        height: raw?.height,
        byteSize: buffer.byteLength,
        contentHash,
        idle,
      });
      this.lastCaptureAtMs = capturedAtMs;
      this.lastCaptureError = undefined;
      this.captureFailures = 0;
    } catch (err) {
      this.captureFailures += 1;
      this.cachedNode = null;
      this.lastCaptureError = err instanceof Error ? err.message : String(err);
      if (this.captureFailures >= CAPTURE_FAILURE_THRESHOLD) {
        this.captureBackoffTicks = CAPTURE_FAILURE_PAUSE_TICKS;
        this.deps.logger.warn(
          `daylog: capture failing (${this.lastCaptureError}); backing off for ${CAPTURE_FAILURE_PAUSE_TICKS} ticks`,
        );
      }
    } finally {
      this.captureInFlight = false;
    }
  }

  // ── Analysis ───────────────────────────────────────────────────────

  private resolveVisionModel(): {
    ref?: { provider: string; model: string };
    source: DaylogStatus["visionModelSource"];
  } {
    if (this.config.visionModel) {
      const ref = parseModelRef(this.config.visionModel);
      return ref ? { ref, source: "config" } : { source: "missing" };
    }
    const media = this.deps.fullConfig.tools?.media;
    const entries = [...(media?.image?.models ?? []), ...(media?.models ?? [])];
    for (const entry of entries) {
      const usable =
        entry.type !== "cli" &&
        typeof entry.provider === "string" &&
        typeof entry.model === "string" &&
        (!entry.capabilities || entry.capabilities.includes("image"));
      if (usable) {
        return {
          ref: { provider: entry.provider as string, model: entry.model as string },
          source: "media-defaults",
        };
      }
    }
    return { source: "missing" };
  }

  async analyzeNow(): Promise<{ started: boolean; reason?: string }> {
    const store = this.requireStore();
    if (this.analysisInFlight) {
      return { started: false, reason: "analysis already running" };
    }
    if (!store.nextPendingBatch()) {
      const frames = store.unbatchedActiveFrames(2000);
      // Force-close the current window so "analyze now" needs no elapsed time.
      const selection = selectBatchFrames({
        frames,
        windowMs: this.config.analysisIntervalMinutes * 60_000,
        nowMs: Number.MAX_SAFE_INTEGER,
      });
      if (!selection) {
        return { started: false, reason: "no unanalyzed activity captured yet" };
      }
      store.createBatch({
        day: dayKeyFor(selection.startMs),
        startMs: selection.startMs,
        endMs: selection.endMs,
        frameIds: selection.frameIds,
      });
    }
    void this.analysisTick();
    return { started: true };
  }

  private async analysisTick(): Promise<void> {
    if (this.analysisInFlight || !this.store) {
      return;
    }
    this.analysisInFlight = true;
    try {
      this.enqueueElapsedWindow();
      for (let i = 0; i < 4; i += 1) {
        const batch = this.store.nextPendingBatch();
        if (!batch) {
          return;
        }
        await this.runBatch(batch);
      }
    } catch (err) {
      this.deps.logger.error(`daylog: analysis tick failed: ${String(err)}`);
    } finally {
      this.analysisInFlight = false;
    }
  }

  private enqueueElapsedWindow(): void {
    const store = this.requireStore();
    // Windows close on elapsed wall-clock or on a capture gap; both cases are
    // resolved by selectBatchFrames against the oldest unbatched frame.
    while (true) {
      const frames = store.unbatchedActiveFrames(2000);
      const selection = selectBatchFrames({
        frames,
        windowMs: this.config.analysisIntervalMinutes * 60_000,
        nowMs: Date.now(),
      });
      if (!selection) {
        return;
      }
      store.createBatch({
        day: dayKeyFor(selection.startMs),
        startMs: selection.startMs,
        endMs: selection.endMs,
        frameIds: selection.frameIds,
      });
    }
  }

  private async runBatch(batch: DaylogBatch): Promise<void> {
    const store = this.requireStore();
    const vision = this.resolveVisionModel();
    if (!vision.ref) {
      store.setBatchStatus(
        batch.id,
        "error",
        "no vision model: set plugins.entries.daylog.config.visionModel or configure tools.media",
      );
      return;
    }
    store.setBatchStatus(
      batch.id,
      "running",
      undefined,
      `${vision.ref.provider}/${vision.ref.model}`,
    );
    try {
      const frames = store.batchFrames(batch.id);
      const sampled = sampleFrames(frames, MAX_FRAMES_PER_CALL);
      const images = sampled.map((frame) => ({
        type: "image" as const,
        buffer: readFileSync(frame.path),
        fileName: path.basename(frame.path),
        mime: "image/jpeg",
      }));
      const observationResult =
        await this.deps.runtime.mediaUnderstanding.extractStructuredWithModel({
          provider: vision.ref.provider,
          model: vision.ref.model,
          input: images,
          instructions: buildObservationInstructions({
            frameTimes: sampled.map((frame) => frame.capturedAtMs),
            startMs: batch.startMs,
            endMs: batch.endMs,
          }),
          schemaName: "daylog.observations",
          jsonSchema: OBSERVATION_JSON_SCHEMA,
          cfg: this.deps.fullConfig,
          timeoutMs: 180_000,
        });
      const segments = parseObservationSegments({
        raw: observationResult.text ?? "",
        day: batch.day,
        startMs: batch.startMs,
        endMs: batch.endMs,
      });
      if (segments.length === 0) {
        store.setBatchStatus(batch.id, "error", "vision model returned no usable segments");
        return;
      }
      store.insertObservations(batch.id, batch.day, segments);
      await this.reviseCards(batch);
      store.setBatchStatus(batch.id, "done");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.setBatchStatus(batch.id, "error", message);
      this.deps.logger.warn(`daylog: batch ${batch.id} failed: ${message}`);
    }
  }

  private async reviseCards(batch: DaylogBatch): Promise<void> {
    const store = this.requireStore();
    const lookbackStart = batch.startMs - CARD_LOOKBACK_MS;
    const previousCards = store
      .cardsForDay(batch.day)
      .filter((card) => card.endMs > lookbackStart && card.startMs < batch.endMs);
    const observations = store.observationsInRange(
      batch.day,
      Math.min(lookbackStart, batch.startMs),
      batch.endMs,
    );
    const window = revisionWindow({
      batchStartMs: batch.startMs,
      batchEndMs: batch.endMs,
      previousCards,
    });
    const prompt = buildCardsPrompt({
      day: batch.day,
      observations,
      previousCards,
      windowStartMs: window.startMs,
      windowEndMs: window.endMs,
    });
    const first = await this.deps.runtime.llm.complete({
      messages: [{ role: "user", content: prompt }],
      purpose: "daylog.cards",
      maxTokens: 4000,
    });
    let parsed = parseCardsJson({
      raw: first.text,
      day: batch.day,
      windowStartMs: window.startMs,
      windowEndMs: window.endMs,
    });
    if (!parsed.ok) {
      const retry = await this.deps.runtime.llm.complete({
        messages: [
          { role: "user", content: prompt },
          { role: "assistant", content: first.text },
          { role: "user", content: buildCardsCorrectionPrompt(parsed.error) },
        ],
        purpose: "daylog.cards.repair",
        maxTokens: 4000,
      });
      parsed = parseCardsJson({
        raw: retry.text,
        day: batch.day,
        windowStartMs: window.startMs,
        windowEndMs: window.endMs,
      });
    }
    if (!parsed.ok) {
      throw new Error(`card synthesis failed validation: ${parsed.error}`);
    }
    const windowFrames = store
      .framesInRange(window.startMs, window.endMs)
      .map((frame) => ({ id: frame.id, capturedAtMs: frame.capturedAtMs }));
    const drafts = parsed.drafts.map((draft) => ({
      ...draft,
      keyframeId: pickKeyframeId(draft, windowFrames),
    }));
    store.replaceCardsInWindow(batch.day, window.startMs, window.endMs, drafts);
  }

  // ── Q&A / standup ──────────────────────────────────────────────────

  async standup(
    day: string,
    refresh: boolean,
  ): Promise<{ day: string; text: string; updatedMs: number }> {
    const store = this.requireStore();
    if (!refresh) {
      const cached = store.getStandup(day);
      if (cached) {
        return cached;
      }
    }
    const previousDay = dayKeyFor(new Date(`${day}T12:00:00`).getTime() - 24 * 60 * 60 * 1000);
    const result = await this.deps.runtime.llm.complete({
      messages: [
        {
          role: "user",
          content: buildStandupPrompt({
            day,
            cards: store.cardsForDay(day),
            previousDayCards: store.cardsForDay(previousDay),
          }),
        },
      ],
      purpose: "daylog.standup",
      maxTokens: 800,
    });
    store.saveStandup(day, result.text.trim());
    const saved = store.getStandup(day);
    if (!saved) {
      throw new Error("standup save failed");
    }
    return saved;
  }

  async ask(day: string, question: string): Promise<string> {
    const store = this.requireStore();
    const observations = store.observationsInRange(day, 0, Number.MAX_SAFE_INTEGER).slice(-200);
    const result = await this.deps.runtime.llm.complete({
      messages: [
        {
          role: "user",
          content: buildAskPrompt({
            day,
            cards: store.cardsForDay(day),
            observations,
            question,
          }),
        },
      ],
      purpose: "daylog.ask",
      maxTokens: 600,
    });
    return result.text.trim();
  }

  // ── Introspection ──────────────────────────────────────────────────

  cardsForDay(day: string): DaylogCard[] {
    return this.requireStore().cardsForDay(day);
  }

  listDays(): ReturnType<DaylogStore["listDays"]> {
    return this.requireStore().listDays();
  }

  dayStats(day: string): ReturnType<DaylogStore["dayStats"]> {
    return this.requireStore().dayStats(day);
  }

  frameById(id: number): ReturnType<DaylogStore["frameById"]> {
    return this.requireStore().frameById(id);
  }

  framesInRange(startMs: number, endMs: number): ReturnType<DaylogStore["framesInRange"]> {
    return this.requireStore().framesInRange(startMs, endMs);
  }

  status(): DaylogStatus {
    const store = this.requireStore();
    const today = dayKeyFor(Date.now());
    const latestBatch = store.latestBatch();
    const vision = this.resolveVisionModel();
    return {
      captureEnabled: this.config.captureEnabled,
      capturePaused: this.capturePaused,
      captureIntervalSeconds: this.config.captureIntervalSeconds,
      analysisIntervalMinutes: this.config.analysisIntervalMinutes,
      retentionDays: this.config.retentionDays,
      nodeId: this.cachedNode?.nodeId ?? this.config.nodeId,
      nodeName: this.cachedNode?.displayName,
      lastCaptureAtMs: this.lastCaptureAtMs,
      lastCaptureError: this.lastCaptureError,
      pendingFrames: store.countUnbatchedActiveFrames(),
      analysisRunning: this.analysisInFlight,
      lastBatch: latestBatch
        ? {
            id: latestBatch.id,
            day: latestBatch.day,
            status: latestBatch.status,
            endMs: latestBatch.endMs,
            error: latestBatch.error,
          }
        : undefined,
      visionModel: vision.ref ? `${vision.ref.provider}/${vision.ref.model}` : undefined,
      visionModelSource: vision.source,
      today,
      todayCards: store.cardsForDay(today).length,
      dataDir: this.deps.dataDir,
    };
  }

  private prune(): void {
    if (!this.store) {
      return;
    }
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const removed = this.store.pruneFrames(cutoff);
    if (removed > 0) {
      this.deps.logger.info(
        `daylog: pruned ${removed} frames older than ${this.config.retentionDays}d`,
      );
    }
  }
}
