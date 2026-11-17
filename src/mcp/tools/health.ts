import { z } from "zod";
import { compact, type CompactOptions } from "@/lib/compact";
import { resolveDate, resolveRange } from "@/lib/dates";
import { dateParam, defineTool, endParam, gather, startParam, type ToolContext } from "../tool";

const detailParam = z
  .enum(["summary", "timeseries"])
  .default("summary")
  .describe(
    "`summary` returns the day's totals and scores only; `timeseries` also includes the intraday samples (downsampled), which uses much more context.",
  );

/** Summary mode strips intraday sample arrays; timeseries mode downsamples them. */
function detailOptions(detail: "summary" | "timeseries"): CompactOptions {
  return detail === "summary"
    ? { maxArray: 24, longArrays: "drop" }
    : { maxArray: 144, longArrays: "sample" };
}

const TREND_METRICS = [
  "sleep",
  "hrv",
  "resting_heart_rate",
  "stress",
  "body_battery",
  "steps",
  "intensity_minutes",
  "respiration",
  "training_readiness",
  "vo2max",
] as const;

export function registerHealthTools(ctx: ToolContext): void {
  const { api } = ctx;

  defineTool(
    ctx,
    "get_daily_summary",
    {
      title: "Get daily summary",
      description:
        "One day's overall wellness totals: steps, distance, floors, calories (active/resting), resting and min/max heart rate, stress breakdown, Body Battery high/low/charged/drained, intensity minutes, SpO2 and respiration averages.",
      input: { date: dateParam() },
    },
    async ({ date }) => compact(await api.dailySummary(resolveDate(date)), { longArrays: "drop" }),
  );

  defineTool(
    ctx,
    "get_sleep",
    {
      title: "Get sleep",
      description:
        "Sleep for the night ending on a date: total and per-stage durations (deep, light, REM, awake), sleep score with its sub-scores and feedback, overnight HRV, resting heart rate, respiration, SpO2, Body Battery change and sleep need. Durations are seconds.",
      input: { date: dateParam("The morning the sleep ended"), detail: detailParam },
    },
    async ({ date, detail }) => compact(await api.sleep(resolveDate(date)), detailOptions(detail)),
  );

  defineTool(
    ctx,
    "get_hrv",
    {
      title: "Get HRV",
      description:
        "Overnight heart rate variability for a date: last-night average and 5-minute high, weekly average, personal baseline range and HRV status (balanced, unbalanced, low, poor). Values are milliseconds (rMSSD).",
      input: { date: dateParam(), detail: detailParam },
    },
    async ({ date, detail }) => compact(await api.hrv(resolveDate(date)), detailOptions(detail)),
  );

  defineTool(
    ctx,
    "get_stress",
    {
      title: "Get stress",
      description:
        "Stress for a day (0-100 scale; 0-25 rest, 26-50 low, 51-75 medium, 76-100 high): average and max level, plus the intraday stress and Body Battery curves in timeseries mode.",
      input: { date: dateParam(), detail: detailParam },
    },
    async ({ date, detail }) => compact(await api.stress(resolveDate(date)), detailOptions(detail)),
  );

  defineTool(
    ctx,
    "get_body_battery",
    {
      title: "Get Body Battery",
      description:
        "Body Battery (Garmin's 0-100 energy reserve) per day over a range: charged and drained amounts, highest and lowest values, and the events that charged or drained it (sleep, naps, activities, stress).",
      input: { start_date: startParam(7), end_date: endParam(), detail: detailParam },
    },
    async ({ start_date, end_date, detail }) => {
      const range = resolveRange(start_date, end_date, 7, 31);
      return compact(await api.bodyBattery(range), detailOptions(detail));
    },
  );

  defineTool(
    ctx,
    "get_heart_rate",
    {
      title: "Get heart rate",
      description:
        "All-day heart rate for a date: resting heart rate, 7-day average resting heart rate, daily minimum and maximum, and the intraday curve in timeseries mode.",
      input: { date: dateParam(), detail: detailParam },
    },
    async ({ date, detail }) => compact(await api.heartRate(resolveDate(date)), detailOptions(detail)),
  );

  defineTool(
    ctx,
    "get_respiration_and_spo2",
    {
      title: "Get respiration and SpO2",
      description:
        "Breathing rate (breaths per minute, awake and asleep) and blood oxygen saturation (average, lowest, during sleep) for a date. Useful for spotting illness, altitude effects or poor recovery.",
      input: { date: dateParam(), detail: detailParam },
    },
    async ({ date, detail }) => {
      const day = resolveDate(date);
      const result = await gather({ respiration: api.respiration(day), spo2: api.spo2(day) });
      return compact(result, detailOptions(detail));
    },
  );

  defineTool(
    ctx,
    "get_health_trends",
    {
      title: "Get health trends",
      description:
        "Daily values of one or more metrics over a date range, for spotting trends and comparing periods without calling a per-day tool repeatedly. " +
        "Metrics: sleep (duration, score, stages), hrv, resting_heart_rate, stress, body_battery, steps, intensity_minutes, respiration, training_readiness, vo2max.",
      input: {
        metrics: z
          .array(z.enum(TREND_METRICS))
          .min(1)
          .max(6)
          .describe("Which metrics to return; each is one series keyed by its name"),
        start_date: startParam(28),
        end_date: endParam(),
      },
    },
    async ({ metrics, start_date, end_date }) => {
      const range = resolveRange(start_date, end_date, 28, 366);
      const loaders: Record<(typeof TREND_METRICS)[number], () => Promise<unknown>> = {
        sleep: () => api.sleepRange(range),
        hrv: () => api.hrvRange(range),
        resting_heart_rate: () => api.restingHeartRateRange(range),
        stress: () => api.dailySeries("stress", range),
        body_battery: () => api.dailySeries("bodybattery", range),
        steps: () => api.stepsRange(range),
        intensity_minutes: () => api.dailySeries("im", range),
        respiration: () => api.dailySeries("respiration", range),
        training_readiness: () => api.trainingReadinessRange(range),
        vo2max: () => api.maxMetricsRange(range),
      };
      const series = await gather(
        Object.fromEntries([...new Set(metrics)].map((metric) => [metric, loaders[metric]()])),
      );
      return { range, ...(compact(series, { maxArray: 400 }) as object) };
    },
  );

  defineTool(
    ctx,
    "get_weight",
    {
      title: "Get weight and body composition",
      description:
        "Weigh-ins over a date range with body composition when a smart scale recorded it: weight, BMI, body fat %, body water %, muscle mass, bone mass. Garmin reports weight in grams.",
      input: { start_date: startParam(90), end_date: endParam() },
    },
    async ({ start_date, end_date }) => {
      const range = resolveRange(start_date, end_date, 90, 3660);
      return compact(await api.weight(range), { maxArray: 200 });
    },
  );

  defineTool(
    ctx,
    "get_blood_pressure",
    {
      title: "Get blood pressure",
      description: "Blood pressure readings (systolic, diastolic, pulse) logged in Garmin Connect over a date range.",
      input: { start_date: startParam(90), end_date: endParam() },
    },
    async ({ start_date, end_date }) => {
      const range = resolveRange(start_date, end_date, 90, 3660);
      return compact(await api.bloodPressure(range), { maxArray: 200 });
    },
  );

  defineTool(
    ctx,
    "get_hydration",
    {
      title: "Get hydration",
      description: "Fluid intake logged for a date against the daily goal, including estimated sweat loss from activities. Values are millilitres.",
      input: { date: dateParam() },
    },
    async ({ date }) => compact(await api.hydration(resolveDate(date))),
  );
}
