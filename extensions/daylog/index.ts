// Daylog plugin entrypoint: automatic work journal built from screen snapshots.
import { readFileSync } from "node:fs";
import path from "node:path";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import {
  ErrorCodes,
  errorShape,
  type GatewayRequestHandlerOptions,
} from "openclaw/plugin-sdk/gateway-runtime";
import {
  definePluginEntry,
  type OpenClawPluginApi,
  type OpenClawPluginNodeHostCommand,
} from "openclaw/plugin-sdk/plugin-entry";
import { resolveDaylogConfig } from "./src/config.js";
import { DaylogService } from "./src/service.js";
import { dayKeyFor } from "./src/store.js";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const daylogConfigSchema = {
  parse(value: unknown) {
    return resolveDaylogConfig(value);
  },
};

function readDayParam(params: unknown): string {
  const day = (params as { day?: unknown } | undefined)?.day;
  if (day === undefined) {
    return dayKeyFor(Date.now());
  }
  if (typeof day !== "string" || !DAY_PATTERN.test(day)) {
    throw new Error("day must be YYYY-MM-DD");
  }
  return day;
}

function readNumberParam(params: unknown, key: string): number {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number`);
  }
  return value;
}

const daylogNodeHostCommands: OpenClawPluginNodeHostCommand[] = [
  {
    command: "daylog.snapshot",
    cap: "screen",
    dangerous: false,
    handle: async (paramsJSON) => {
      const { handleDaylogSnapshot } = await import("./src/node-host.js");
      let params: unknown;
      try {
        params = paramsJSON ? JSON.parse(paramsJSON) : undefined;
      } catch {
        params = undefined;
      }
      return JSON.stringify(await handleDaylogSnapshot(params));
    },
  },
];

export default definePluginEntry({
  id: "daylog",
  name: "Daylog",
  description: "Automatic work journal built from periodic screen snapshots",
  configSchema: daylogConfigSchema,
  nodeHostCommands: daylogNodeHostCommands,
  register(api: OpenClawPluginApi) {
    const config = daylogConfigSchema.parse(api.pluginConfig);
    let service: DaylogService | null = null;

    const requireService = () => {
      if (!service) {
        throw new Error("Daylog service is not running");
      }
      return service;
    };

    const sendError = (respond: GatewayRequestHandlerOptions["respond"], err: unknown) => {
      const message = formatErrorMessage(err);
      respond(false, { error: message }, errorShape(ErrorCodes.UNAVAILABLE, message));
    };

    const handle =
      (run: (params: unknown) => Promise<unknown> | unknown) =>
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          respond(true, await run(params));
        } catch (err) {
          sendError(respond, err);
        }
      };

    api.registerService({
      id: "daylog",
      start: (ctx) => {
        service = new DaylogService(config, {
          runtime: api.runtime,
          fullConfig: ctx.config,
          logger: ctx.logger,
          dataDir: path.join(ctx.stateDir, "daylog"),
        });
        service.start();
      },
      stop: () => {
        service?.stop();
        service = null;
      },
    });

    api.registerGatewayMethod(
      "daylog.status",
      handle(() => requireService().status()),
    );

    api.registerGatewayMethod(
      "daylog.days",
      handle(() => ({ days: requireService().listDays() })),
    );

    api.registerGatewayMethod(
      "daylog.timeline",
      handle((params) => {
        const day = readDayParam(params);
        const svc = requireService();
        return { day, cards: svc.cardsForDay(day), stats: svc.dayStats(day) };
      }),
    );

    api.registerGatewayMethod(
      "daylog.frames",
      handle((params) => {
        const startMs = readNumberParam(params, "startMs");
        const endMs = readNumberParam(params, "endMs");
        const frames = requireService()
          .framesInRange(startMs, endMs)
          .map((frame) => ({ id: frame.id, capturedAtMs: frame.capturedAtMs, idle: frame.idle }));
        return { frames };
      }),
    );

    api.registerGatewayMethod(
      "daylog.frame",
      handle((params) => {
        const frameId = readNumberParam(params, "frameId");
        const frame = requireService().frameById(frameId);
        if (!frame) {
          throw new Error(`frame ${frameId} not found`);
        }
        return {
          frameId: frame.id,
          capturedAtMs: frame.capturedAtMs,
          width: frame.width,
          height: frame.height,
          format: "jpeg",
          base64: readFileSync(frame.path).toString("base64"),
        };
      }),
    );

    api.registerGatewayMethod(
      "daylog.standup",
      handle((params) => {
        const refresh = (params as { refresh?: unknown } | undefined)?.refresh === true;
        return requireService().standup(readDayParam(params), refresh);
      }),
    );

    api.registerGatewayMethod(
      "daylog.ask",
      handle(async (params) => {
        const question = (params as { question?: unknown } | undefined)?.question;
        if (typeof question !== "string" || question.trim().length === 0) {
          throw new Error("question is required");
        }
        const answer = await requireService().ask(readDayParam(params), question.trim());
        return { answer };
      }),
    );

    api.registerGatewayMethod(
      "daylog.capture.set",
      handle((params) => {
        const paused = (params as { paused?: unknown } | undefined)?.paused === true;
        const svc = requireService();
        svc.setCapturePaused(paused);
        return svc.status();
      }),
    );

    api.registerGatewayMethod(
      "daylog.analyze.now",
      handle(() => requireService().analyzeNow()),
    );
  },
});
