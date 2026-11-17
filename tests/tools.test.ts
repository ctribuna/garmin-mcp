import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GarminApi } from "@/garmin/api";
import { GarminClient } from "@/garmin/client";
import { MemoryTokenStore } from "@/garmin/tokens";
import type { ToolContext } from "@/mcp/tool";
import { registerActivityTools } from "@/mcp/tools/activities";
import { registerHealthTools } from "@/mcp/tools/health";
import { registerInsightTools } from "@/mcp/tools/insights";
import { registerPlanningTools } from "@/mcp/tools/planning";
import { registerProfileTools } from "@/mcp/tools/profile";
import { registerTrainingTools } from "@/mcp/tools/training";
import { jsonResponse, tokensExpiringIn } from "./helpers";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type Route = (url: URL, init: RequestInit) => unknown;

/** Registers every tool against a fake MCP server and a fake Garmin API. */
function setup(routes: Record<string, Route>, writeEnabled = false) {
  const requests: { method: string; path: string; url: URL; body?: unknown }[] = [];
  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    requests.push({
      method: init.method ?? "GET",
      path: url.pathname,
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const key = Object.keys(routes).find((prefix) => url.pathname.startsWith(prefix));
    if (!key) return jsonResponse({}, 404);
    const body = routes[key]!(url, init);
    return body instanceof Response ? body : jsonResponse(body);
  };

  const tools = new Map<string, (args: unknown) => Promise<ToolResult>>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: (args: unknown) => Promise<ToolResult>) => {
      tools.set(name, handler);
    },
  };
  const ctx = {
    server,
    api: new GarminApi(new GarminClient(new MemoryTokenStore(tokensExpiringIn(3600)), fetchImpl)),
    writeEnabled,
  } as unknown as ToolContext;
  for (const register of [
    registerInsightTools,
    registerActivityTools,
    registerHealthTools,
    registerTrainingTools,
    registerPlanningTools,
    registerProfileTools,
  ]) {
    register(ctx);
  }

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const handler = tools.get(name);
    if (!handler) throw new Error(`Tool ${name} is not registered`);
    const result = await handler(args);
    const text = result.content[0]!.text;
    return { isError: Boolean(result.isError), text, data: result.isError || !text.startsWith("{") && !text.startsWith("[") ? null : JSON.parse(text) };
  };
  return { tools, requests, call };
}

const PROFILE = { "/userprofile-service/socialProfile": () => ({ displayName: "athlete" }) };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-15T10:00:00Z"));
  process.env.GARMIN_TIMEZONE = "Europe/Lisbon";
});
afterEach(() => vi.useRealTimers());

describe("tool registration", () => {
  it("hides write tools unless writing is enabled", () => {
    const readOnly = setup({});
    expect(readOnly.tools.has("create_workout")).toBe(false);
    expect(readOnly.tools.has("delete_workout")).toBe(false);
    expect(readOnly.tools.has("list_activities")).toBe(true);

    const writable = setup({}, true);
    for (const name of ["create_workout", "schedule_workout", "unschedule_workout", "delete_workout"]) {
      expect(writable.tools.has(name), name).toBe(true);
    }
  });
});

describe("list_activities", () => {
  it("queries the default 30-day window and returns slim summaries", async () => {
    const { call, requests } = setup({
      "/activitylist-service/activities/search/activities": () => [
        {
          activityId: 42,
          activityName: "Morning Run",
          activityType: { typeKey: "running", typeId: 1 },
          distance: 10000,
          duration: 3000,
          averageHR: 150,
          ownerId: 999,
          maxFtp: null,
        },
      ],
    });

    const { data } = await call("list_activities", { limit: 20, offset: 0 });

    const sent = requests[0]!.url.searchParams;
    expect(sent.get("startDate")).toBe("2026-05-17");
    expect(sent.get("endDate")).toBe("2026-06-15");
    expect(data.activities).toEqual([
      { activityId: 42, activityName: "Morning Run", distance: 10000, duration: 3000, averageHR: 150, type: "running" },
    ]);
    expect(data.hasMore).toBe(false);
  });
});

describe("get_sleep", () => {
  const routes = {
    ...PROFILE,
    "/wellness-service/wellness/dailySleepData/athlete": () => ({
      dailySleepDTO: { sleepTimeSeconds: 27000, deepSleepSeconds: 5400 },
      sleepLevels: Array.from({ length: 300 }, (_, i) => ({ t: i })),
    }),
  };

  it("drops intraday samples in summary mode and keeps them downsampled in timeseries mode", async () => {
    const summary = (await setup(routes).call("get_sleep", { date: "2026-06-14", detail: "summary" })).data;
    expect(summary.dailySleepDTO.sleepTimeSeconds).toBe(27000);
    expect(summary.sleepLevels).toBeUndefined();
    expect(summary.sleepLevelsCount).toBe(300);

    const series = (await setup(routes).call("get_sleep", { date: "2026-06-14", detail: "timeseries" })).data;
    expect(series.sleepLevels).toHaveLength(144);
  });

  it("reports missing data in words rather than as an empty object", async () => {
    const { text, isError } = await setup(PROFILE).call("get_sleep", { date: "2026-06-14", detail: "summary" });
    expect(isError).toBe(false);
    expect(text).toMatch(/No data recorded/);
  });
});

describe("get_health_trends", () => {
  it("chunks long ranges into 28-day requests and merges them", async () => {
    const { call, requests } = setup({
      "/sleep-service/stats/sleep/daily/": (url) => ({
        individualStats: [{ calendarDate: url.pathname.split("/").at(-2) }],
      }),
    });

    const { data } = await call("get_health_trends", {
      metrics: ["sleep"],
      start_date: "2026-04-01",
      end_date: "2026-05-30",
    });

    expect(requests.map((r) => r.path.split("/").slice(-2).join(".."))).toEqual([
      "2026-04-01..2026-04-28",
      "2026-04-29..2026-05-26",
      "2026-05-27..2026-05-30",
    ]);
    expect(data.sleep).toHaveLength(3);
  });
});

describe("get_daily_briefing", () => {
  it("combines the pieces and notes the ones that failed without failing the whole call", async () => {
    const { call } = setup({
      ...PROFILE,
      "/metrics-service/metrics/trainingreadiness/": () => [{ score: 71, level: "HIGH" }, { score: 60 }],
      "/hrv-service/hrv/": () => ({ hrvSummary: { lastNightAvg: 55, status: "BALANCED" }, hrvReadings: [1, 2] }),
      "/usersummary-service/usersummary/daily/athlete": () => ({ restingHeartRate: 48, totalSteps: 9000, rule: { x: 1 } }),
      "/metrics-service/metrics/trainingstatus/": () => jsonResponse({ message: "upstream down" }, 500),
      "/activitylist-service/": () => [],
    });

    const { data, isError } = await call("get_daily_briefing", {});

    expect(isError).toBe(false);
    expect(data.date).toBe("2026-06-15");
    expect(data.trainingReadiness).toEqual({ score: 71, level: "HIGH" });
    expect(data.hrv).toEqual({ lastNightAvg: 55, status: "BALANCED" });
    expect(data.wellness).toEqual({ totalSteps: 9000, restingHeartRate: 48 });
    expect(data.unavailable.trainingStatus).toMatch(/500/);
  });

  it("fails clearly when Garmin is unreachable for every piece", async () => {
    const { call } = setup({ "/": () => jsonResponse({}, 429) });
    const { isError, text } = await call("get_daily_briefing", {});
    expect(isError).toBe(true);
    expect(text).toMatch(/rate limiting/);
  });
});

describe("create_workout", () => {
  it("creates the workout, then schedules it using the returned id", async () => {
    const { call, requests } = setup(
      {
        "/workout-service/workout": () => ({ workoutId: 777, workoutName: "Easy 30" }),
        "/workout-service/schedule/777": () => ({ workoutScheduleId: 888 }),
      },
      true,
    );

    const { data } = await call("create_workout", {
      workout: { name: "Easy 30", sport: "running", steps: [{ type: "interval", duration: { type: "time", seconds: 1800 } }] },
      schedule_date: "2026-06-20",
    });

    expect(data).toEqual({ workoutId: 777, workoutName: "Easy 30", scheduledFor: "2026-06-20", scheduleId: 888 });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /workout-service/workout",
      "POST /workout-service/schedule/777",
    ]);
    expect((requests[0]!.body as any).workoutSegments[0].workoutSteps).toHaveLength(1);
    expect(requests[1]!.body).toEqual({ date: "2026-06-20" });
  });
});

describe("garmin_api_get", () => {
  it("substitutes the display name and refuses unsafe paths without calling Garmin", async () => {
    const { call, requests } = setup({ ...PROFILE, "/metrics-service/metrics/racepredictions/latest/athlete": () => ({ time5K: 1500 }) });

    const ok = await call("garmin_api_get", { path: "/metrics-service/metrics/racepredictions/latest/{displayName}", max_array: 60 });
    expect(ok.data).toEqual({ time5K: 1500 });

    const before = requests.length;
    const bad = await call("garmin_api_get", { path: "/a/../../oauth/token", max_array: 60 });
    expect(bad.isError).toBe(true);
    expect(requests).toHaveLength(before);
  });
});
