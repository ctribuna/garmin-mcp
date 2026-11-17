import { z } from "zod";
import { assertSafePath, type Query } from "@/garmin/client";
import { compact, pick } from "@/lib/compact";
import { getTimezone, isWriteEnabled } from "@/lib/config";
import { today } from "@/lib/dates";
import { defineTool, gather, type ToolContext } from "../tool";

export function registerProfileTools(ctx: ToolContext): void {
  const { api } = ctx;

  defineTool(
    ctx,
    "garmin_status",
    {
      title: "Check Garmin connection",
      description:
        "Check that this server can reach the user's Garmin account. Returns whether tokens are stored, when the session token expires and, if the connection works, the account name. Call this first when other tools fail with authentication errors.",
      input: {},
    },
    async () => {
      const tokens = await api.client.tokenStatus();
      const base = { today: today(), timezone: getTimezone(), writeToolsEnabled: isWriteEnabled(), tokens };
      if (!tokens.stored) {
        return {
          ...base,
          connected: false,
          problem:
            "No Garmin tokens are stored. Run `uv run scripts/garmin_login.py` on your computer to log in and upload them.",
        };
      }
      try {
        const profile = await api.socialProfile();
        return { ...base, connected: true, account: pick(profile, ["displayName", "fullName", "location"]) };
      } catch (error) {
        return { ...base, connected: false, problem: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  defineTool(
    ctx,
    "get_profile",
    {
      title: "Get athlete profile",
      description:
        "The athlete's profile and settings: name, age-related data, height, weight, sex, measurement system, sleep schedule, lactate threshold and VO2 max settings, and primary activity types. Read this once to personalise advice.",
      input: {},
    },
    async () =>
      compact(await gather({ profile: api.socialProfile(), settings: api.userSettings() }), {
        dropKeys: ["garminGUID", "profileId", "id", "userRoles", "allowGolfLiveScoring"],
        longArrays: "drop",
      }),
  );

  defineTool(
    ctx,
    "get_devices",
    {
      title: "Get devices",
      description:
        "Garmin devices registered to the account (watches, bike computers, scales, sensors) with model, software version and which one is the primary training device and last synced. Useful for knowing which metrics the user's hardware can record.",
      input: {},
    },
    async () => {
      const result = await gather({
        devices: api.devices(),
        lastUsed: api.lastUsedDevice(),
        primaryTrainingDevice: api.primaryTrainingDevice(),
      });
      return compact(result, {
        maxArray: 30,
        longArrays: "drop",
        dropKeys: ["imageUrl", "registeredDate", "unitId", "serialNumber", "wifiSetup", "deviceSettingsFile"],
      });
    },
  );

  defineTool(
    ctx,
    "get_gear",
    {
      title: "Get gear",
      description:
        "Shoes, bikes and other gear tracked in Garmin Connect, with total distance and activity count for each, to judge wear (for example running shoes approaching replacement mileage).",
      input: {
        include_stats: z
          .boolean()
          .default(true)
          .describe("Also load total distance and activity count per item (one extra request each)"),
      },
    },
    async ({ include_stats }) => {
      const gear = await api.gear(50);
      if (!include_stats) return compact(gear);
      const withStats = await Promise.all(
        gear.map(async (item) => {
          const uuid = typeof item.uuid === "string" ? item.uuid : null;
          const stats = uuid ? await api.gearStats(uuid).catch(() => null) : null;
          return stats ? { ...item, stats } : item;
        }),
      );
      return compact(withStats);
    },
  );

  defineTool(
    ctx,
    "garmin_api_get",
    {
      title: "Raw Garmin Connect GET",
      description:
        "Escape hatch: perform a read-only GET against any Garmin Connect API path when no dedicated tool covers the data (for example /metrics-service/metrics/runningtolerance/stats or /nutrition-service/meals/2026-01-31). " +
        "Prefer the dedicated tools; use this only when you know the endpoint. Paths needing the display name can use the placeholder {displayName}.",
      input: {
        path: z
          .string()
          .min(2)
          .max(300)
          .describe("API path starting with /, without query string, e.g. /wellness-service/wellness/dailyStress/2026-01-31"),
        params: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query parameters"),
        max_array: z
          .number()
          .int()
          .min(5)
          .max(500)
          .default(60)
          .describe("Arrays longer than this are downsampled"),
      },
    },
    async ({ path, params, max_array }) => {
      let resolved = path;
      if (resolved.includes("{displayName}")) {
        resolved = resolved.replaceAll("{displayName}", await api.client.displayName());
      }
      assertSafePath(resolved);
      return compact(await api.client.get(resolved, params as Query | undefined), { maxArray: max_array });
    },
  );
}
