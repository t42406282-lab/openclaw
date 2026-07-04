// Shared Daylog domain shapes used by the store, pipeline, and gateway methods.

export type DaylogFrame = {
  id: number;
  capturedAtMs: number;
  day: string;
  path: string;
  screenIndex: number;
  width?: number;
  height?: number;
  byteSize: number;
  idle: boolean;
};

export type DaylogBatchStatus = "pending" | "running" | "done" | "error";

export type DaylogBatch = {
  id: number;
  day: string;
  startMs: number;
  endMs: number;
  status: DaylogBatchStatus;
  error?: string;
  frameCount: number;
  model?: string;
};

export type DaylogObservation = {
  id: number;
  batchId: number;
  day: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type DaylogDistraction = {
  startMs: number;
  endMs: number;
  title: string;
};

export type DaylogCard = {
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
  distractions: DaylogDistraction[];
  keyframeId?: number;
};

export type DaylogCardDraft = Omit<DaylogCard, "id">;

export type DaylogDayStats = {
  trackedMs: number;
  distractionMs: number;
  categories: Array<{ category: string; ms: number }>;
  apps: Array<{ domain: string; ms: number }>;
};
