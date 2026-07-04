// Daylog node-host command: screen capture for headless node hosts (macOS).
// Nodes without the OpenClaw app (plain `openclaw node host run`) advertise
// daylog.snapshot so capture works anywhere the plugin is enabled.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DaylogSnapshotParams = {
  screenIndex?: number;
  maxWidth?: number;
  quality?: number;
};

export type DaylogSnapshotPayload = { format: "jpeg"; base64: string } | { error: string };

function readParams(value: unknown): DaylogSnapshotParams {
  if (!value || typeof value !== "object") {
    return {};
  }
  const record = value as Record<string, unknown>;
  const num = (key: string) =>
    typeof record[key] === "number" && Number.isFinite(record[key])
      ? (record[key] as number)
      : undefined;
  return { screenIndex: num("screenIndex"), maxWidth: num("maxWidth"), quality: num("quality") };
}

export async function handleDaylogSnapshot(rawParams: unknown): Promise<DaylogSnapshotPayload> {
  if (process.platform !== "darwin") {
    return { error: `daylog.snapshot is not supported on ${process.platform}` };
  }
  const params = readParams(rawParams);
  const screenIndex = Math.max(0, Math.round(params.screenIndex ?? 0));
  const maxWidth = params.maxWidth && params.maxWidth >= 480 ? Math.round(params.maxWidth) : 1440;
  const qualityPct = Math.min(
    100,
    Math.max(
      10,
      Math.round(
        (params.quality && params.quality > 0 && params.quality <= 1 ? params.quality : 0.6) * 100,
      ),
    ),
  );
  const filePath = path.join(tmpdir(), `daylog-snapshot-${randomUUID()}.jpg`);
  try {
    // -x: no capture sound; -C: include cursor; -D is 1-based display index.
    await execFileAsync("screencapture", [
      "-x",
      "-C",
      "-D",
      String(screenIndex + 1),
      "-t",
      "jpg",
      filePath,
    ]);
    await execFileAsync("sips", [
      "--resampleHeightWidthMax",
      String(maxWidth),
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      String(qualityPct),
      filePath,
    ]);
    const buffer = await readFile(filePath);
    return { format: "jpeg", base64: buffer.toString("base64") };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    await rm(filePath, { force: true });
  }
}
