import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appRouter,
  createApplicationContext,
  startAppRouter,
  type RouteLoadContext,
} from "./app-routes.ts";
import type { RouterOutletSnapshotStore } from "./app/router-outlet.ts";
import type { RouteLocation, RouterHistory } from "./router/index.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startAppRouter", () => {
  it("publishes the initial location before its route starts loading", async () => {
    const initialLocation: RouteLocation = {
      pathname: "/chat",
      search: "?session=agent%3Asupport%3Amain",
      hash: "",
    };
    const history: RouterHistory = {
      location: () => initialLocation,
      push: vi.fn(),
      replace: vi.fn(),
      listen: vi.fn(() => vi.fn()),
    };
    const onLocation = vi.fn();
    vi.spyOn(appRouter, "start").mockImplementation(async (resolvedHistory) => {
      expect(onLocation).toHaveBeenCalledWith(initialLocation);
      expect(resolvedHistory.location()).toEqual(initialLocation);
    });

    await startAppRouter(history, "", {} as RouteLoadContext, onLocation);

    expect(onLocation).toHaveBeenCalledOnce();
  });
});

describe("createApplicationContext", () => {
  it("carries the visible route onto the application state", () => {
    let visibleRouteId: "sessions" | null = null;
    let notifyRouteChange: () => void = () => undefined;
    const routeSnapshot = {
      get: () => ({
        status: "success" as const,
        active: visibleRouteId ? ({ routeId: visibleRouteId } as never) : undefined,
        pending: undefined,
        showPending: false,
      }),
      subscribe: (listener: () => void) => {
        notifyRouteChange = listener;
        return vi.fn();
      },
      dispose: vi.fn(),
    } as unknown as RouterOutletSnapshotStore;
    const host = {
      activeRouteId: null,
      basePath: "",
      navDrawerOpen: false,
      sessionKey: "agent:main:main",
      setChatMobileControlsOpen: vi.fn(),
    };
    const application = createApplicationContext(host as never, routeSnapshot as never);

    visibleRouteId = "sessions";
    notifyRouteChange();

    expect(host.activeRouteId).toBe("sessions");
    application.dispose();
  });
});
