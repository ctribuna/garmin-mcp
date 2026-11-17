/**
 * Garmin Connect endpoints, one method per call.
 *
 * Paths and parameters follow python-garminconnect 0.3.x, the maintained
 * reference for this private API. Methods return Garmin's JSON untouched;
 * shaping for the model happens in the MCP tools.
 */

import { chunkRange, type DateRange } from "@/lib/dates";
import type { GarminClient, Query } from "./client";

type Json = Record<string, unknown>;

/** Garmin caps these range endpoints at 28 days per request. */
const RANGE_CHUNK_DAYS = 28;

export class GarminApi {
  constructor(readonly client: GarminClient) {}

  private async chunked<T>(range: DateRange, fetchChunk: (chunk: DateRange) => Promise<T[]>): Promise<T[]> {
    const out: T[] = [];
    for (const chunk of chunkRange(range, RANGE_CHUNK_DAYS)) {
      out.push(...(await fetchChunk(chunk)));
    }
    return out;
  }

  // --- profile & devices ---------------------------------------------------

  socialProfile = () => this.client.get<Json>("/userprofile-service/socialProfile");
  userSettings = () => this.client.get<Json>("/userprofile-service/userprofile/user-settings");
  devices = () => this.client.get<Json[]>("/device-service/deviceregistration/devices");
  lastUsedDevice = () => this.client.getOptional<Json>("/device-service/deviceservice/mylastused");
  primaryTrainingDevice = () =>
    this.client.getOptional<Json>("/web-gateway/device-info/primary-training-device");

  gear = (limit: number) =>
    this.client.get<Json[]>("/gear-service/gear/v2/list", { start: 0, limit });
  gearStats = (gearUuid: string) =>
    this.client.getOptional<Json>(`/gear-service/gear/stats/${encodeURIComponent(gearUuid)}`);

  async personalRecords(): Promise<Json[]> {
    const name = await this.client.displayName();
    return (await this.client.getOptional<Json[]>(`/personalrecord-service/personalrecord/prs/${name}`)) ?? [];
  }

  // --- activities ----------------------------------------------------------

  activities = (params: Query) =>
    this.client.get<Json[]>("/activitylist-service/activities/search/activities", params);
  activity = (id: number) => this.client.get<Json>(`/activity-service/activity/${id}`);
  activitySplits = (id: number) =>
    this.client.getOptional<Json>(`/activity-service/activity/${id}/splits`);
  activityTypedSplits = (id: number) =>
    this.client.getOptional<Json>(`/activity-service/activity/${id}/typedsplits`);
  activityHrZones = (id: number) =>
    this.client.getOptional<Json[]>(`/activity-service/activity/${id}/hrTimeInZones`);
  activityPowerZones = (id: number) =>
    this.client.getOptional<Json[]>(`/activity-service/activity/${id}/powerTimeInZones`);
  activityWeather = (id: number) =>
    this.client.getOptional<Json>(`/activity-service/activity/${id}/weather`);
  activityExerciseSets = (id: number) =>
    this.client.getOptional<Json>(`/activity-service/activity/${id}/exerciseSets`);
  activityDetails = (id: number, maxChartSize: number) =>
    this.client.get<Json>(`/activity-service/activity/${id}/details`, {
      maxChartSize,
      maxPolylineSize: 0,
    });

  // --- daily wellness ------------------------------------------------------

  async dailySummary(date: string): Promise<Json | null> {
    const name = await this.client.displayName();
    return this.client.getOptional<Json>(`/usersummary-service/usersummary/daily/${name}`, {
      calendarDate: date,
    });
  }

  async sleep(date: string): Promise<Json | null> {
    const name = await this.client.displayName();
    return this.client.getOptional<Json>(`/wellness-service/wellness/dailySleepData/${name}`, {
      date,
      nonSleepBufferMinutes: 60,
    });
  }

  async heartRate(date: string): Promise<Json | null> {
    const name = await this.client.displayName();
    return this.client.getOptional<Json>(`/wellness-service/wellness/dailyHeartRate/${name}`, { date });
  }

  hrv = (date: string) => this.client.getOptional<Json>(`/hrv-service/hrv/${date}`);
  stress = (date: string) =>
    this.client.getOptional<Json>(`/wellness-service/wellness/dailyStress/${date}`);
  bodyBattery = (range: DateRange) =>
    this.client.getOptional<Json[]>("/wellness-service/wellness/bodyBattery/reports/daily", {
      startDate: range.start,
      endDate: range.end,
    });
  bodyBatteryEvents = (date: string) =>
    this.client.getOptional<Json[]>(`/wellness-service/wellness/bodyBattery/events/${date}`);
  respiration = (date: string) =>
    this.client.getOptional<Json>(`/wellness-service/wellness/daily/respiration/${date}`);
  spo2 = (date: string) =>
    this.client.getOptional<Json>(`/wellness-service/wellness/daily/spo2/${date}`);
  intensityMinutes = (date: string) =>
    this.client.getOptional<Json>(`/wellness-service/wellness/daily/im/${date}`);
  hydration = (date: string) =>
    this.client.getOptional<Json>(`/usersummary-service/usersummary/hydration/daily/${date}`);

  // --- wellness trends -----------------------------------------------------

  sleepRange = (range: DateRange) =>
    this.chunked(range, async (chunk) => {
      const data = await this.client.getOptional<Json>(
        `/sleep-service/stats/sleep/daily/${chunk.start}/${chunk.end}`,
      );
      return (data?.individualStats as Json[] | undefined) ?? [];
    });

  hrvRange = (range: DateRange) =>
    this.chunked(range, async (chunk) => {
      const data = await this.client.getOptional<Json>(`/hrv-service/hrv/daily/${chunk.start}/${chunk.end}`);
      return (data?.hrvSummaries as Json[] | undefined) ?? [];
    });

  stepsRange = (range: DateRange) =>
    this.chunked(
      range,
      async (chunk) =>
        (await this.client.getOptional<Json[]>(
          `/usersummary-service/stats/steps/daily/${chunk.start}/${chunk.end}`,
        )) ?? [],
    );

  /** Daily series for: stress, bodybattery, heartRate, im, respiration, floors, hydration. */
  dailySeries = (series: string, range: DateRange) =>
    this.chunked(range, async (chunk) => {
      const data = await this.client.getOptional<unknown>(
        `/usersummary-service/stats/${series}/daily/${chunk.start}/${chunk.end}`,
      );
      return Array.isArray(data) ? (data as Json[]) : data ? [data as Json] : [];
    });

  async restingHeartRateRange(range: DateRange): Promise<Json[]> {
    const name = await this.client.displayName();
    const data = await this.client.getOptional<Json>(`/userstats-service/wellness/daily/${name}`, {
      fromDate: range.start,
      untilDate: range.end,
      metricId: 60,
    });
    const metrics = (data?.allMetrics as Json | undefined)?.metricsMap as Json | undefined;
    const rows = (metrics?.WELLNESS_RESTING_HEART_RATE as Json[] | undefined) ?? [];
    return rows
      .filter((row) => row.value !== null && row.value !== undefined)
      .map((row) => ({ calendarDate: row.calendarDate, value: row.value }));
  }

  // --- body ----------------------------------------------------------------

  weight = (range: DateRange) =>
    this.client.getOptional<Json>(`/weight-service/weight/range/${range.start}/${range.end}`, {
      includeAll: true,
    });
  bloodPressure = (range: DateRange) =>
    this.client.getOptional<Json>(`/bloodpressure-service/bloodpressure/range/${range.start}/${range.end}`, {
      includeAll: true,
    });

  // --- training metrics ----------------------------------------------------

  trainingReadiness = (date: string) =>
    this.client.getOptional<Json[]>(`/metrics-service/metrics/trainingreadiness/${date}`);
  trainingReadinessRange = (range: DateRange) =>
    this.client.getOptional<Json[]>(`/metrics-service/metrics/trainingreadiness/${range.start}/${range.end}`);
  trainingStatus = (date: string) =>
    this.client.getOptional<Json>(`/metrics-service/metrics/trainingstatus/aggregated/${date}`);
  maxMetrics = (date: string) =>
    this.client.getOptional<Json>(`/metrics-service/metrics/maxmet/latest/${date}`);
  maxMetricsRange = (range: DateRange) =>
    this.client.getOptional<Json[]>(`/metrics-service/metrics/maxmet/daily/${range.start}/${range.end}`);
  enduranceScore = (date: string) =>
    this.client.getOptional<Json>("/metrics-service/metrics/endurancescore", { calendarDate: date });
  hillScore = (date: string) =>
    this.client.getOptional<Json>("/metrics-service/metrics/hillscore", { calendarDate: date });
  fitnessAge = (date: string) => this.client.getOptional<Json>(`/fitnessage-service/fitnessage/${date}`);
  lactateThreshold = () =>
    this.client.getOptional<Json>("/biometric-service/biometric/latestLactateThreshold");
  cyclingFtp = () =>
    this.client.getOptional<Json>("/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING");
  heartRateZones = () => this.client.getOptional<Json[]>("/biometric-service/heartRateZones");
  powerZones = () => this.client.getOptional<Json[]>("/biometric-service/powerZones/sports/all");

  async racePredictions(): Promise<Json | null> {
    const name = await this.client.displayName();
    return this.client.getOptional<Json>(`/metrics-service/metrics/racepredictions/latest/${name}`);
  }

  async racePredictionsRange(range: DateRange): Promise<Json[] | null> {
    const name = await this.client.displayName();
    return this.client.getOptional<Json[]>(`/metrics-service/metrics/racepredictions/daily/${name}`, {
      fromCalendarDate: range.start,
      toCalendarDate: range.end,
    });
  }

  // --- planning ------------------------------------------------------------

  scheduledWorkouts = (range: DateRange) =>
    this.client.getOptional<Json[]>("/workout-service/schedule/workoutScheduleByPeriod", {
      startDate: range.start,
      endDate: range.end,
    });
  calendarEvents = (range: DateRange) =>
    this.client.getOptional<Json[]>("/calendar-service/events", {
      startDate: range.start,
      endDate: range.end,
    });
  activeTrainingPlans = (date: string) =>
    this.client.getOptional<Json>("/trainingplan-service/trainingplan/active-plans", { startDate: date });

  workouts = (start: number, limit: number) =>
    this.client.get<Json[]>("/workout-service/workouts", {
      start,
      limit,
      myWorkoutsOnly: true,
      orderBy: "UPDATE_DATE",
      orderSeq: "DESC",
    });
  workout = (id: number) => this.client.get<Json>(`/workout-service/workout/${id}`);

  // --- writes --------------------------------------------------------------

  createWorkout = (payload: Json) =>
    this.client.request<Json>("POST", "/workout-service/workout", { body: payload });
  scheduleWorkout = (workoutId: number, date: string) =>
    this.client.request<Json>("POST", `/workout-service/schedule/${workoutId}`, { body: { date } });
  unscheduleWorkout = (scheduleId: number) =>
    this.client.request<unknown>("DELETE", `/workout-service/schedule/${scheduleId}`);
  deleteWorkout = (workoutId: number) =>
    this.client.request<unknown>("DELETE", `/workout-service/workout/${workoutId}`);
}
