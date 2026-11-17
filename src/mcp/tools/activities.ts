import { z } from "zod";
import { compact, pick } from "@/lib/compact";
import { resolveRange } from "@/lib/dates";
import { defineTool, endParam, gather, startParam, type ToolContext } from "../tool";

/** Fields of an activity-list entry worth a model's attention. */
const ACTIVITY_FIELDS = [
  "activityId",
  "activityName",
  "description",
  "startTimeLocal",
  "locationName",
  "distance",
  "duration",
  "movingDuration",
  "elevationGain",
  "elevationLoss",
  "averageSpeed",
  "maxSpeed",
  "avgGradeAdjustedSpeed",
  "calories",
  "averageHR",
  "maxHR",
  "averageRunningCadenceInStepsPerMinute",
  "averageBikingCadenceInRevPerMinute",
  "avgStrideLength",
  "avgPower",
  "maxPower",
  "normPower",
  "trainingStressScore",
  "intensityFactor",
  "aerobicTrainingEffect",
  "anaerobicTrainingEffect",
  "trainingEffectLabel",
  "activityTrainingLoad",
  "vO2MaxValue",
  "steps",
  "lapCount",
  "totalSets",
  "totalReps",
  "avgStrokes",
  "averageSwolf",
  "poolLength",
  "differenceBodyBattery",
  "moderateIntensityMinutes",
  "vigorousIntensityMinutes",
  "hrTimeInZone_1",
  "hrTimeInZone_2",
  "hrTimeInZone_3",
  "hrTimeInZone_4",
  "hrTimeInZone_5",
  "minTemperature",
  "maxTemperature",
  "pr",
  "favorite",
] as const;

type Json = Record<string, unknown>;

export function summariseActivity(activity: Json): Json {
  const type = (activity.activityType as Json | undefined)?.typeKey;
  const event = (activity.eventType as Json | undefined)?.typeKey;
  return {
    ...pick(activity, ACTIVITY_FIELDS),
    ...(type ? { type } : {}),
    ...(event && event !== "uncategorized" ? { eventType: event } : {}),
  };
}

const activityId = z.number().int().positive().describe("Garmin activity id, from list_activities");

export function registerActivityTools(ctx: ToolContext): void {
  const { api } = ctx;

  defineTool(
    ctx,
    "list_activities",
    {
      title: "List activities",
      description:
        "List recorded activities (runs, rides, swims, strength sessions, ...) newest first, with distance, duration, heart rate, pace/speed, power, training effect and training load. " +
        "Distances are metres, durations seconds, speeds m/s. Use the returned activityId with get_activity for splits and zones.",
      input: {
        start_date: startParam(30),
        end_date: endParam(),
        activity_type: z
          .string()
          .optional()
          .describe(
            "Filter by Garmin activity type, e.g. running, cycling, swimming, strength_training, hiking, walking, fitness_equipment.",
          ),
        limit: z.number().int().min(1).max(100).default(20).describe("Maximum activities to return"),
        offset: z.number().int().min(0).default(0).describe("Number of activities to skip, for paging"),
      },
    },
    async ({ start_date, end_date, activity_type, limit, offset }) => {
      const range = resolveRange(start_date, end_date, 30, 3660);
      const activities = await api.activities({
        startDate: range.start,
        endDate: range.end,
        start: offset,
        limit,
        activityType: activity_type,
      });
      return {
        range,
        count: activities.length,
        hasMore: activities.length === limit,
        activities: activities.map(summariseActivity),
      };
    },
  );

  defineTool(
    ctx,
    "get_activity",
    {
      title: "Get activity details",
      description:
        "Full detail for one activity: summary metrics, per-lap/per-km splits, time in heart-rate and power zones, weather and, for strength sessions, exercise sets. " +
        "Choose sections with `include` to keep the response small.",
      input: {
        activity_id: activityId,
        include: z
          .array(z.enum(["splits", "hr_zones", "power_zones", "weather", "exercise_sets"]))
          .default(["splits", "hr_zones", "weather"])
          .describe("Extra sections to load alongside the summary"),
      },
    },
    async ({ activity_id, include }) => {
      const wants = new Set(include);
      const result = await gather({
        summary: api.activity(activity_id),
        ...(wants.has("splits") ? { splits: api.activitySplits(activity_id) } : {}),
        ...(wants.has("hr_zones") ? { hrZones: api.activityHrZones(activity_id) } : {}),
        ...(wants.has("power_zones") ? { powerZones: api.activityPowerZones(activity_id) } : {}),
        ...(wants.has("weather") ? { weather: api.activityWeather(activity_id) } : {}),
        ...(wants.has("exercise_sets") ? { exerciseSets: api.activityExerciseSets(activity_id) } : {}),
      });
      return compact(result, { maxArray: 100, dropKeys: ["lengthDTOs", "connectIQMeasurement"] });
    },
  );

  defineTool(
    ctx,
    "get_activity_timeseries",
    {
      title: "Get activity time series",
      description:
        "Sampled time series for one activity (heart rate, speed, cadence, power, elevation over time), for analysing pacing, cardiac drift or interval execution. " +
        "`metricDescriptors` names each column of the `metrics` rows. Larger `points` values cost more context.",
      input: {
        activity_id: activityId,
        points: z.number().int().min(20).max(500).default(120).describe("Approximate number of samples"),
      },
    },
    async ({ activity_id, points }) => {
      const details = await api.activityDetails(activity_id, points);
      return compact(details, { maxArray: points, dropKeys: ["geoPolylineDTO", "heartRateDTOs"] });
    },
  );
}
