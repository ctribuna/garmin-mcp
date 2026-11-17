import { z } from "zod";
import { buildWorkout, workoutSchema } from "@/garmin/workout";
import { compact, pick } from "@/lib/compact";
import { addDays, assertDate, resolveDate, resolveRange } from "@/lib/dates";
import { dateParam, defineTool, gather, type ToolContext } from "../tool";

const workoutId = z.number().int().positive().describe("Workout id, from list_workouts or create_workout");

export function registerPlanningTools(ctx: ToolContext): void {
  const { api } = ctx;

  defineTool(
    ctx,
    "get_calendar",
    {
      title: "Get training calendar",
      description:
        "What is planned in Garmin Connect over a date range: scheduled workouts (including Garmin Coach and adaptive plan sessions), races and other calendar events, and the active training plan. Defaults to the next 14 days.",
      input: {
        start_date: dateParam("First day"),
        end_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .optional()
          .describe("Last day (YYYY-MM-DD), inclusive. Defaults to 13 days after start_date."),
      },
    },
    async ({ start_date, end_date }) => {
      const start = resolveDate(start_date, "start_date");
      const range = resolveRange(start, end_date ?? addDays(start, 13), 14, 180);
      const result = await gather({
        scheduledWorkouts: api.scheduledWorkouts(range),
        events: api.calendarEvents(range),
        activeTrainingPlans: api.activeTrainingPlans(range.start),
      });
      return { range, ...(compact(result, { maxArray: 200 }) as object) };
    },
  );

  defineTool(
    ctx,
    "list_workouts",
    {
      title: "List saved workouts",
      description:
        "Structured workouts saved in the user's Garmin Connect library, most recently updated first, with sport, estimated duration and distance. Use get_workout for the steps.",
      input: {
        limit: z.number().int().min(1).max(100).default(30),
        offset: z.number().int().min(0).default(0),
      },
    },
    async ({ limit, offset }) => {
      const workouts = await api.workouts(offset, limit);
      return workouts.map((w) => ({
        ...pick(w, [
          "workoutId",
          "workoutName",
          "description",
          "estimatedDurationInSecs",
          "estimatedDistanceInMeters",
          "updateDate",
        ]),
        sport: (w.sportType as Record<string, unknown> | undefined)?.sportTypeKey,
      }));
    },
  );

  defineTool(
    ctx,
    "get_workout",
    {
      title: "Get workout",
      description: "The full step-by-step structure of a saved workout: warm-up, intervals, repeats, recoveries, targets and durations.",
      input: { workout_id: workoutId },
    },
    async ({ workout_id }) => compact(await api.workout(workout_id), { maxArray: 100 }),
  );

  // --- writes (only registered when GARMIN_ENABLE_WRITE is on) --------------

  defineTool(
    ctx,
    "create_workout",
    {
      title: "Create workout",
      description:
        "Create a structured workout in the user's Garmin Connect library, optionally scheduling it on a date so it syncs to the watch. " +
        "Describe steps in order; wrap repeated interval/recovery blocks in a `repeat` step. Pace targets are m:ss per km. " +
        "Confirm the plan with the user before calling this, since it changes their Garmin account.",
      input: {
        workout: workoutSchema,
        schedule_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .optional()
          .describe("If given, also put the workout on the calendar for this date"),
      },
      write: true,
    },
    async ({ workout, schedule_date }) => {
      if (schedule_date) assertDate(schedule_date, "schedule_date");
      const created = await api.createWorkout(buildWorkout(workout));
      const id = created?.workoutId;
      if (typeof id !== "number") {
        throw new Error("Garmin accepted the workout but did not return a workout id.");
      }
      const result: Record<string, unknown> = { workoutId: id, workoutName: created.workoutName };
      if (schedule_date) {
        const scheduled = await api.scheduleWorkout(id, schedule_date);
        result.scheduledFor = schedule_date;
        result.scheduleId = scheduled?.workoutScheduleId;
      }
      return result;
    },
  );

  defineTool(
    ctx,
    "schedule_workout",
    {
      title: "Schedule workout",
      description: "Put an existing saved workout on the Garmin calendar for a date, so it appears on the watch that day.",
      input: {
        workout_id: workoutId,
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").describe("Date to schedule it on"),
      },
      write: true,
    },
    async ({ workout_id, date }) => {
      const scheduled = await api.scheduleWorkout(workout_id, assertDate(date));
      return { workoutId: workout_id, scheduledFor: date, scheduleId: scheduled?.workoutScheduleId };
    },
  );

  defineTool(
    ctx,
    "unschedule_workout",
    {
      title: "Unschedule workout",
      description:
        "Remove one scheduled occurrence of a workout from the Garmin calendar. The workout itself stays in the library. Takes the schedule id from get_calendar, not the workout id.",
      input: {
        schedule_id: z.number().int().positive().describe("workoutScheduleId of the calendar entry"),
      },
      write: true,
      destructive: true,
    },
    async ({ schedule_id }) => {
      await api.unscheduleWorkout(schedule_id);
      return { unscheduled: schedule_id };
    },
  );

  defineTool(
    ctx,
    "delete_workout",
    {
      title: "Delete workout",
      description:
        "Permanently delete a saved workout from the Garmin Connect library, along with its calendar entries. This cannot be undone; confirm with the user first.",
      input: { workout_id: workoutId },
      write: true,
      destructive: true,
    },
    async ({ workout_id }) => {
      await api.deleteWorkout(workout_id);
      return { deleted: workout_id };
    },
  );
}
