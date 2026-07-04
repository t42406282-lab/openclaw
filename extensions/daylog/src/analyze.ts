import { CARD_CATEGORIES } from "./prompts.js";
// Daylog analysis pipeline: frames -> observations -> revised timeline cards.
// Pure parsing/validation lives here so tests can cover it without the SDK.
import type { DaylogCard, DaylogCardDraft, DaylogDistraction } from "./types.js";

/** Cards within this window before a batch are treated as a revisable draft. */
export const CARD_LOOKBACK_MS = 45 * 60 * 1000;
/** Frame gap that splits one analysis window into separate batches. */
export const BATCH_MAX_GAP_MS = 2 * 60 * 1000;
/** Upper bound of images sent to the vision model per batch. */
export const MAX_FRAMES_PER_CALL = 16;

export type ParsedSegment = { startMs: number; endMs: number; text: string };

/** Parses "HH:MM:SS" (or "H:MM", with optional am/pm) on a local day into epoch ms. */
export function clockToMs(day: string, clock: string): number | null {
  const match = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(clock);
  if (!match) {
    return null;
  }
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? "0");
  const meridiem = match[4]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) {
    hours += 12;
  }
  if (meridiem === "am" && hours === 12) {
    hours = 0;
  }
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }
  const base = new Date(`${day}T00:00:00`);
  if (Number.isNaN(base.getTime())) {
    return null;
  }
  return base.getTime() + ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

/** Strips code fences and extracts the outermost JSON array/object from model text. */
export function extractJsonPayload(raw: string): string {
  const cleaned = raw.replaceAll("```json", "").replaceAll("```", "").trim();
  const firstBracket = cleaned.search(/[[{]/);
  if (firstBracket < 0) {
    return cleaned;
  }
  const open = cleaned[firstBracket];
  const close = open === "[" ? "]" : "}";
  const lastClose = cleaned.lastIndexOf(close);
  if (lastClose > firstBracket) {
    return cleaned.slice(firstBracket, lastClose + 1);
  }
  return cleaned;
}

export function parseObservationSegments(params: {
  raw: string;
  day: string;
  startMs: number;
  endMs: number;
}): ParsedSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(params.raw));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { segments?: unknown }).segments)
      ? (parsed as { segments: unknown[] }).segments
      : [];
  const segments: ParsedSegment[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const description = typeof record.description === "string" ? record.description.trim() : "";
    const startMs = typeof record.start === "string" ? clockToMs(params.day, record.start) : null;
    const endMs = typeof record.end === "string" ? clockToMs(params.day, record.end) : null;
    if (!description || startMs === null || endMs === null) {
      continue;
    }
    const clampedStart = Math.max(params.startMs, Math.min(startMs, params.endMs));
    const clampedEnd = Math.max(clampedStart, Math.min(endMs, params.endMs));
    segments.push({ startMs: clampedStart, endMs: clampedEnd, text: description });
  }
  return segments.toSorted((a, b) => a.startMs - b.startMs);
}

type RawCard = {
  startTime?: unknown;
  endTime?: unknown;
  category?: unknown;
  title?: unknown;
  summary?: unknown;
  detailedSummary?: unknown;
  distractions?: unknown;
  appSites?: unknown;
};

export type CardParseResult =
  | { ok: true; drafts: DaylogCardDraft[] }
  | { ok: false; error: string };

function normalizeCategory(value: unknown): string {
  const category = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (CARD_CATEGORIES as readonly string[]).includes(category) ? category : "other";
}

function normalizeDomain(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/)[0];
  return domain && domain.length <= 100 ? domain : undefined;
}

function parseDistractions(day: string, value: unknown): DaylogDistraction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const distractions: DaylogDistraction[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const startMs = typeof record.startTime === "string" ? clockToMs(day, record.startTime) : null;
    const endMs = typeof record.endTime === "string" ? clockToMs(day, record.endTime) : null;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (startMs === null || endMs === null || !title || endMs <= startMs) {
      continue;
    }
    distractions.push({ startMs, endMs, title });
  }
  return distractions;
}

export function parseCardsJson(params: {
  raw: string;
  day: string;
  windowStartMs: number;
  windowEndMs: number;
}): CardParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(params.raw));
  } catch (err) {
    return { ok: false, error: `Output is not valid JSON: ${(err as Error).message}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Output must be a JSON array of cards." };
  }
  const drafts: DaylogCardDraft[] = [];
  const problems: string[] = [];
  parsed.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      problems.push(`Card ${index}: not an object.`);
      return;
    }
    const raw = entry as RawCard;
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
    const startMs = typeof raw.startTime === "string" ? clockToMs(params.day, raw.startTime) : null;
    const endMs = typeof raw.endTime === "string" ? clockToMs(params.day, raw.endTime) : null;
    if (startMs === null || endMs === null) {
      problems.push(`Card ${index}: startTime/endTime must be HH:MM:SS local time.`);
      return;
    }
    if (endMs <= startMs) {
      problems.push(`Card ${index}: endTime must be after startTime.`);
      return;
    }
    if (!title || !summary) {
      problems.push(`Card ${index}: title and summary are required.`);
      return;
    }
    const appSites =
      raw.appSites && typeof raw.appSites === "object"
        ? (raw.appSites as Record<string, unknown>)
        : {};
    drafts.push({
      day: params.day,
      startMs,
      endMs,
      title,
      summary,
      detail: typeof raw.detailedSummary === "string" ? raw.detailedSummary.trim() : "",
      category: normalizeCategory(raw.category),
      appPrimary: normalizeDomain(appSites.primary),
      appSecondary: normalizeDomain(appSites.secondary),
      distractions: parseDistractions(params.day, raw.distractions),
      keyframeId: undefined,
    });
  });
  if (problems.length > 0) {
    return { ok: false, error: problems.join("\n") };
  }
  if (drafts.length === 0) {
    return { ok: false, error: "Output contained no valid cards." };
  }
  const sorted = drafts.toSorted((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < sorted.length; i += 1) {
    const overlapMs = sorted[i - 1].endMs - sorted[i].startMs;
    if (overlapMs > 60 * 1000) {
      return {
        ok: false,
        error: `Cards ${i - 1} and ${i} overlap by ${Math.round(overlapMs / 60000)} minutes; adjacent cards must meet cleanly.`,
      };
    }
    if (overlapMs > 0) {
      // Trim sub-minute overlaps instead of round-tripping to the model again.
      sorted[i] = { ...sorted[i], startMs: sorted[i - 1].endMs };
    }
  }
  return { ok: true, drafts: sorted };
}

/** Union of the revision window: previous draft cards plus the new batch range. */
export function revisionWindow(params: {
  batchStartMs: number;
  batchEndMs: number;
  previousCards: DaylogCard[];
}): { startMs: number; endMs: number } {
  let startMs = params.batchStartMs;
  let endMs = params.batchEndMs;
  for (const card of params.previousCards) {
    startMs = Math.min(startMs, card.startMs);
    endMs = Math.max(endMs, card.endMs);
  }
  return { startMs, endMs };
}

/** Groups pending frames into one batch window, splitting on large gaps. */
export function selectBatchFrames(params: {
  frames: Array<{ id: number; capturedAtMs: number }>;
  windowMs: number;
  nowMs: number;
}): { frameIds: number[]; startMs: number; endMs: number } | null {
  if (params.frames.length === 0) {
    return null;
  }
  const first = params.frames[0];
  const windowEnd = first.capturedAtMs + params.windowMs;
  const selected: Array<{ id: number; capturedAtMs: number }> = [];
  let previousTs = first.capturedAtMs;
  for (const frame of params.frames) {
    if (frame.capturedAtMs >= windowEnd) {
      break;
    }
    if (selected.length > 0 && frame.capturedAtMs - previousTs > BATCH_MAX_GAP_MS) {
      break;
    }
    selected.push(frame);
    previousTs = frame.capturedAtMs;
  }
  if (selected.length === 0) {
    return null;
  }
  const last = selected[selected.length - 1];
  // Only close a batch once its window has elapsed (or a gap ended it), so a
  // window in progress keeps accumulating frames instead of fragmenting.
  const windowElapsed = params.nowMs >= windowEnd;
  const endedByGap = selected.length < params.frames.length;
  if (!windowElapsed && !endedByGap) {
    return null;
  }
  return {
    frameIds: selected.map((frame) => frame.id),
    startMs: first.capturedAtMs,
    endMs: last.capturedAtMs + 1,
  };
}

/** Evenly samples frames so a batch stays within the per-call image budget. */
export function sampleFrames<T>(frames: T[], max: number): T[] {
  if (frames.length <= max) {
    return frames;
  }
  const sampled: T[] = [];
  const step = (frames.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    sampled.push(frames[Math.round(i * step)]);
  }
  return [...new Set(sampled)];
}

/** Picks the frame closest to a card's midpoint as its keyframe. */
export function pickKeyframeId(
  card: { startMs: number; endMs: number },
  frames: Array<{ id: number; capturedAtMs: number }>,
): number | undefined {
  if (frames.length === 0) {
    return undefined;
  }
  const midpoint = card.startMs + (card.endMs - card.startMs) / 2;
  let best = frames[0];
  for (const frame of frames) {
    if (Math.abs(frame.capturedAtMs - midpoint) < Math.abs(best.capturedAtMs - midpoint)) {
      best = frame;
    }
  }
  return best.id;
}
