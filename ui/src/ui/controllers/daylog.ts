// Control UI controller for the Daylog tab: state, gateway calls, polling.
import type { GatewayBrowserClient } from "../gateway.ts";

export type DaylogStatusPayload = {
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
  lastBatch?: { id: number; day: string; status: string; endMs: number; error?: string };
  visionModel?: string;
  visionModelSource: "config" | "media-defaults" | "missing";
  today: string;
  todayCards: number;
  dataDir: string;
};

export type DaylogDistractionPayload = { startMs: number; endMs: number; title: string };

export type DaylogCardPayload = {
  id: number;
  day: string;
  startMs: number;
  endMs: number;
  title: string;
  summary: string;
  detail: string;
  category: string;
  appPrimary?: string;
  appSecondary?: string;
  distractions: DaylogDistractionPayload[];
  keyframeId?: number;
};

export type DaylogDayStatsPayload = {
  trackedMs: number;
  distractionMs: number;
  categories: Array<{ category: string; ms: number }>;
  apps: Array<{ domain: string; ms: number }>;
};

export type DaylogTimelinePayload = {
  day: string;
  cards: DaylogCardPayload[];
  stats: DaylogDayStatsPayload;
};

export type DaylogDaysPayload = {
  days: Array<{ day: string; cards: number; firstMs: number; lastMs: number }>;
};

export type DaylogUiState = {
  day: string;
  status: DaylogStatusPayload | null;
  days: DaylogDaysPayload["days"];
  timeline: DaylogTimelinePayload | null;
  loading: boolean;
  error: string | null;
  expandedCardIds: Set<number>;
  framePreviews: Map<number, string>;
  frameLoads: Set<number>;
  standup: { day: string; text: string; updatedMs: number } | null;
  standupLoading: boolean;
  askQuestion: string;
  askAnswer: string | null;
  askLoading: boolean;
  actionPending: boolean;
  configRequested: boolean;
  pollTimer: ReturnType<typeof globalThis.setInterval> | null;
  requestUpdate: (() => void) | null;
};

const FRAME_PREVIEW_CACHE_LIMIT = 48;
const POLL_INTERVAL_MS = 30_000;

const daylogStates = new WeakMap<object, DaylogUiState>();

export function localDayKey(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function shiftDay(day: string, deltaDays: number): string {
  const base = new Date(`${day}T12:00:00`);
  base.setDate(base.getDate() + deltaDays);
  return localDayKey(base);
}

export function getDaylogState(host: object): DaylogUiState {
  let state = daylogStates.get(host);
  if (!state) {
    state = {
      day: localDayKey(),
      status: null,
      days: [],
      timeline: null,
      loading: false,
      error: null,
      expandedCardIds: new Set(),
      framePreviews: new Map(),
      frameLoads: new Set(),
      standup: null,
      standupLoading: false,
      askQuestion: "",
      askAnswer: null,
      askLoading: false,
      actionPending: false,
      configRequested: false,
      pollTimer: null,
      requestUpdate: null,
    };
    daylogStates.set(host, state);
  }
  return state;
}

function notify(state: DaylogUiState): void {
  state.requestUpdate?.();
}

export async function loadDaylog(
  state: DaylogUiState,
  client: GatewayBrowserClient | null,
  opts?: { day?: string; silent?: boolean },
): Promise<void> {
  if (!client) {
    return;
  }
  if (opts?.day && opts.day !== state.day) {
    state.day = opts.day;
    state.timeline = null;
    state.standup = null;
    state.askAnswer = null;
    state.expandedCardIds = new Set();
  }
  if (!opts?.silent) {
    state.loading = true;
    state.error = null;
    notify(state);
  }
  try {
    const [status, days, timeline] = await Promise.all([
      client.request<DaylogStatusPayload>("daylog.status", {}),
      client.request<DaylogDaysPayload>("daylog.days", {}),
      client.request<DaylogTimelinePayload>("daylog.timeline", { day: state.day }),
    ]);
    state.status = status;
    state.days = days.days;
    state.timeline = timeline;
    state.error = null;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    notify(state);
  }
}

export function configureDaylogPolling(
  state: DaylogUiState,
  client: GatewayBrowserClient | null,
  active: boolean,
): void {
  if (!active || !client) {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    return;
  }
  if (state.pollTimer) {
    return;
  }
  state.pollTimer = setInterval(() => {
    // Silent refresh keeps the timeline current while analysis batches land.
    void loadDaylog(state, client, { silent: true });
  }, POLL_INTERVAL_MS);
}

export async function loadDaylogFramePreview(
  state: DaylogUiState,
  client: GatewayBrowserClient | null,
  frameId: number,
): Promise<void> {
  if (!client || state.framePreviews.has(frameId) || state.frameLoads.has(frameId)) {
    return;
  }
  state.frameLoads.add(frameId);
  try {
    const payload = await client.request<{ base64: string; format: string }>("daylog.frame", {
      frameId,
    });
    if (state.framePreviews.size >= FRAME_PREVIEW_CACHE_LIMIT) {
      const oldest = state.framePreviews.keys().next().value;
      if (oldest !== undefined) {
        state.framePreviews.delete(oldest);
      }
    }
    state.framePreviews.set(frameId, `data:image/${payload.format};base64,${payload.base64}`);
  } catch {
    // Preview loads are cosmetic; the card stays usable without one.
  } finally {
    state.frameLoads.delete(frameId);
    notify(state);
  }
}

export async function setDaylogCapturePaused(
  state: DaylogUiState,
  client: GatewayBrowserClient | null,
  paused: boolean,
): Promise<void> {
  if (!client || state.actionPending) {
    return;
  }
  state.actionPending = true;
  notify(state);
  try {
    state.status = await client.request<DaylogStatusPayload>("daylog.capture.set", { paused });
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.actionPending = false;
    notify(state);
  }
}

export async function runDaylogAnalysisNow(
  state: DaylogUiState,
  client: GatewayBrowserClient | null,
): Promise<void> {
  if (!client || state.actionPending) {
    return;
  }
  state.actionPending = true;
  notify(state);
  try {
    const result = await client.request<{ started: boolean; reason?: string }>(
      "daylog.analyze.now",
      {},
    );
    if (!result.started && result.reason) {
      state.error = result.reason;
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.actionPending = false;
    notify(state);
    void loadDaylog(state, client, { silent: true });
  }
}

export async function loadDaylogStandup(
  state: DaylogUiState,
  client: GatewayBrowserClient | null,
  refresh: boolean,
): Promise<void> {
  if (!client || state.standupLoading) {
    return;
  }
  state.standupLoading = true;
  notify(state);
  try {
    state.standup = await client.request<{ day: string; text: string; updatedMs: number }>(
      "daylog.standup",
      { day: state.day, refresh },
    );
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.standupLoading = false;
    notify(state);
  }
}

export async function askDaylog(
  state: DaylogUiState,
  client: GatewayBrowserClient | null,
): Promise<void> {
  const question = state.askQuestion.trim();
  if (!client || state.askLoading || question.length === 0) {
    return;
  }
  state.askLoading = true;
  state.askAnswer = null;
  notify(state);
  try {
    const payload = await client.request<{ answer: string }>("daylog.ask", {
      day: state.day,
      question,
    });
    state.askAnswer = payload.answer;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.askLoading = false;
    notify(state);
  }
}
