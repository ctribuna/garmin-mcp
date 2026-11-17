import { z } from "zod";
import { compact } from "@/lib/compact";
import { resolveDate, resolveRange } from "@/lib/dates";
import { dateParam, defineTool, endParam, gather, startParam, type ToolContext } from "../tool";

/** Most activities get_training_load reads in one request. */
const LOAD_ACTIVITY_LIMIT = 400;

export function registerTrainingTools(ctx: ToolContext): void {
  const { api } = ctx;

  defineTool(
    ctx,
    "get_training_readiness",
    {
      title: "Get training readiness",
      description:
        "Training Readiness score (0-100) for a date with the factors behind it: sleep score, recovery time remaining, HRV status, acute training load, sleep history and stress history, plus Garmin's feedback. The first entry is the most recent reading of the day.",
      input: { date: dateParam() },
    },
    async ({ date }) => compact(await api.trainingReadiness(resolveDate(date))),
  );

  defineTool(
    ctx,
    "get_training_status",
    {
      title: "Get training status",
      description:
        "Training Status for a date: the status label (productive, maintaining, peaking, recovery, unproductive, strained, overreaching, detraining), acute vs chronic load and their ratio, load focus balance (low aerobic / high aerobic / anaerobic against targets), VO2 max and heat/altitude acclimation.",
      input: { date: dateParam() },
    },
    async ({ date }) => compact(await api.trainingStatus(resolveDate(date)), { maxArray: 40 }),
  );

  defineTool(
    ctx,
    "get_fitness_metrics",
    {
      title: "Get fitness metrics",
      description:
        "Current performance markers in one call: VO2 max (running and cycling), fitness age, endurance score, hill score, lactate threshold (heart rate and pace) and cycling FTP. Metrics the watch does not support come back absent.",
      input: { date: dateParam() },
    },
    async ({ date }) => {
      const day = resolveDate(date);
      const result = await gather({
        vo2max: api.maxMetrics(day),
        fitnessAge: api.fitnessAge(day),
        enduranceScore: api.enduranceScore(day),
        hillScore: api.hillScore(day),
        lactateThreshold: api.lactateThreshold(),
        cyclingFtp: api.cyclingFtp(),
      });
      return compact(result, { maxArray: 20 });
    },
  );

  defineTool(
    ctx,
    "get_race_predictions",
    {
      title: "Get race predictions",
      description:
        "Garmin's predicted finish times for 5K, 10K, half marathon and marathon, in seconds. Without dates it returns the current prediction; with a range it returns one prediction per day to show how fitness is trending.",
      input: {
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .optional()
          .describe("First day of a history range (YYYY-MM-DD). Omit for the current prediction only."),
        end_date: endParam(),
      },
    },
    async ({ start_date, end_date }) => {
      if (!start_date) return compact(await api.racePredictions());
      const range = resolveRange(start_date, end_date, 90, 366);
      return compact({ range, predictions: await api.racePredictionsRange(range) }, { maxArray: 120 });
    },
  );

  defineTool(
    ctx,
    "get_training_zones",
    {
      title: "Get training zones",
      description:
        "The heart-rate zones (per sport, with max and resting heart rate and lactate threshold heart rate) and power zones configured in Garmin Connect. Use these to interpret time-in-zone data and to prescribe workout targets.",
      input: {},
    },
    async () =>
      compact(await gather({ heartRateZones: api.heartRateZones(), powerZones: api.powerZones() })),
  );

  defineTool(
    ctx,
    "get_personal_records",
    {
      title: "Get personal records",
      description:
        "Personal records held in Garmin Connect: fastest 1K, mile, 5K, 10K, half marathon and marathon, longest run and ride, biggest climb, best power and step records. `typeId` identifies the record; times are seconds and distances metres.",
      input: {},
    },
    async () => compact(await api.personalRecords(), { maxArray: 100 }),
  );

  defineTool(
    ctx,
    "get_training_load",
    {
      title: "Get training load history",
      description:
        "Per-activity training load, aerobic and anaerobic training effect and type over a date range, for reasoning about load progression, monotony and week-over-week ramp. Complements get_training_status, which gives Garmin's own acute/chronic summary.",
      input: { start_date: startParam(42), end_date: endParam() },
    },
    async ({ start_date, end_date }) => {
      const range = resolveRange(start_date, end_date, 42, 366);
      const activities = await api.activities({
        startDate: range.start,
        endDate: range.end,
        start: 0,
        limit: LOAD_ACTIVITY_LIMIT,
      });
      const rows = activities.map((a) => ({
        date: typeof a.startTimeLocal === "string" ? a.startTimeLocal.slice(0, 10) : undefined,
        type: (a.activityType as Record<string, unknown> | undefined)?.typeKey,
        durationSec: a.duration,
        distanceM: a.distance,
        load: a.activityTrainingLoad,
        aerobicTE: a.aerobicTrainingEffect,
        anaerobicTE: a.anaerobicTrainingEffect,
        label: a.trainingEffectLabel,
      }));
      const totalLoad = rows.reduce((sum, r) => sum + (typeof r.load === "number" ? r.load : 0), 0);
      return compact(
        {
          range,
          activityCount: rows.length,
          // Garmin returned a full page, so older activities in the range may be missing.
          ...(rows.length === LOAD_ACTIVITY_LIMIT ? { truncated: true } : {}),
          totalLoad: Math.round(totalLoad),
          activities: rows,
        },
        { maxArray: 400 },
      );
    },
  );
}
