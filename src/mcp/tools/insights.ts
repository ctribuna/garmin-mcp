/**
 * Composite tools: one call that answers a whole coaching question.
 *
 * Models otherwise chain five to ten single-metric calls for "how am I doing
 * today?". Doing the fan-out server side is faster, cheaper in context, and
 * guarantees the pieces refer to the same day.
 */

import { compact, pick } from "@/lib/compact";
import { addDays, resolveDate } from "@/lib/dates";
import { dateParam, defineTool, gather, type ToolContext } from "../tool";
import { summariseActivity } from "./activities";

type Json = Record<string, unknown>;

const SLEEP_FIELDS = [
  "calendarDate",
  "sleepTimeSeconds",
  "napTimeSeconds",
  "deepSleepSeconds",
  "lightSleepSeconds",
  "remSleepSeconds",
  "awakeSleepSeconds",
  "sleepStartTimestampLocal",
  "sleepEndTimestampLocal",
  "averageRespirationValue",
  "averageSpO2Value",
  "avgSleepStress",
  "sleepScoreFeedback",
  "sleepScoreInsight",
  "sleepScores",
  "sleepNeed",
] as const;

const SUMMARY_FIELDS = [
  "totalSteps",
  "dailyStepGoal",
  "totalDistanceMeters",
  "activeKilocalories",
  "totalKilocalories",
  "restingHeartRate",
  "lastSevenDaysAvgRestingHeartRate",
  "minHeartRate",
  "maxHeartRate",
  "averageStressLevel",
  "maxStressLevel",
  "bodyBatteryHighestValue",
  "bodyBatteryLowestValue",
  "bodyBatteryMostRecentValue",
  "bodyBatteryChargedValue",
  "bodyBatteryDrainedValue",
  "moderateIntensityMinutes",
  "vigorousIntensityMinutes",
  "avgWakingRespirationValue",
  "averageSpo2",
] as const;

function sleepSummary(sleep: Json | null): Json | null {
  if (!sleep) return null;
  const dto = sleep.dailySleepDTO as Json | undefined;
  return {
    ...pick(dto, SLEEP_FIELDS),
    ...pick(sleep, ["avgOvernightHrv", "hrvStatus", "restingHeartRate", "bodyBatteryChange"]),
  };
}

export function registerInsightTools(ctx: ToolContext): void {
  const { api } = ctx;

  defineTool(
    ctx,
    "get_daily_briefing",
    {
      title: "Get daily briefing",
      description:
        "Everything needed to answer 'how am I today and what should I do?' in one call: training readiness, last night's sleep, HRV status, the day's wellness totals (resting heart rate, stress, Body Battery), training status and load balance, the last 3 days of activities and what is scheduled for the next 2 days. " +
        "Start here for daily check-ins, then use the specific tools to dig deeper.",
      input: { date: dateParam() },
    },
    async ({ date }) => {
      const day = resolveDate(date);
      const result = await gather({
        trainingReadiness: api.trainingReadiness(day).then((rows) => rows?.[0] ?? null),
        sleep: api.sleep(day).then(sleepSummary),
        hrv: api.hrv(day).then((hrv) => (hrv?.hrvSummary as Json | undefined) ?? null),
        wellness: api.dailySummary(day).then((summary) => pick(summary, SUMMARY_FIELDS)),
        trainingStatus: api.trainingStatus(day),
        recentActivities: api
          .activities({ startDate: addDays(day, -3), endDate: day, start: 0, limit: 15 })
          .then((activities) => activities.map(summariseActivity)),
        scheduled: api.scheduledWorkouts({ start: day, end: addDays(day, 2) }),
      });
      return { date: day, ...(compact(result, { maxArray: 30, longArrays: "drop" }) as object) };
    },
  );

  defineTool(
    ctx,
    "get_weekly_review",
    {
      title: "Get weekly review",
      description:
        "A 7-day training and recovery review ending on a date: every activity with load and training effect, weekly totals by sport, daily sleep, HRV, resting heart rate, stress and training readiness series, and the current training status. Use it for weekly check-ins and for planning the next week.",
      input: { end_date: dateParam("Last day of the 7-day window") },
    },
    async ({ end_date }) => {
      const end = resolveDate(end_date, "end_date");
      const range = { start: addDays(end, -6), end };

      const activities = api
        .activities({ startDate: range.start, endDate: range.end, start: 0, limit: 100 })
        .then((list) => list.map(summariseActivity));

      const totals = activities.then((list) => {
        const bySport: Record<string, { count: number; distanceM: number; durationSec: number; load: number }> = {};
        for (const a of list) {
          const sport = typeof a.type === "string" ? a.type : "other";
          const row = (bySport[sport] ??= { count: 0, distanceM: 0, durationSec: 0, load: 0 });
          row.count += 1;
          row.distanceM += typeof a.distance === "number" ? a.distance : 0;
          row.durationSec += typeof a.duration === "number" ? a.duration : 0;
          row.load += typeof a.activityTrainingLoad === "number" ? a.activityTrainingLoad : 0;
        }
        return bySport;
      });

      const result = await gather({
        totalsBySport: totals,
        activities,
        sleep: api.sleepRange(range),
        hrv: api.hrvRange(range),
        restingHeartRate: api.restingHeartRateRange(range),
        stress: api.dailySeries("stress", range),
        trainingReadiness: api.trainingReadinessRange(range),
        trainingStatus: api.trainingStatus(end),
      });
      return { range, ...(compact(result, { maxArray: 100, longArrays: "drop" }) as object) };
    },
  );
}
