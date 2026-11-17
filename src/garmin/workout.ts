/**
 * Build Garmin structured-workout payloads from a compact description.
 *
 * Garmin's workout JSON is deeply nested and full of numeric type ids. Models
 * get this simplified shape instead and the builder produces what the
 * workout-service expects (ids follow python-garminconnect's workout module).
 */

import { z } from "zod";

const SPORTS = {
  running: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 },
  cycling: { sportTypeId: 2, sportTypeKey: "cycling", displayOrder: 2 },
  swimming: { sportTypeId: 4, sportTypeKey: "swimming", displayOrder: 3 },
  strength: { sportTypeId: 5, sportTypeKey: "strength_training", displayOrder: 5 },
  cardio: { sportTypeId: 6, sportTypeKey: "cardio_training", displayOrder: 6 },
  walking: { sportTypeId: 17, sportTypeKey: "walking", displayOrder: 17 },
  hiking: { sportTypeId: 18, sportTypeKey: "hiking", displayOrder: 18 },
} as const;

const STEP_TYPES = {
  warmup: { stepTypeId: 1, stepTypeKey: "warmup", displayOrder: 1 },
  cooldown: { stepTypeId: 2, stepTypeKey: "cooldown", displayOrder: 2 },
  interval: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
  recovery: { stepTypeId: 4, stepTypeKey: "recovery", displayOrder: 4 },
  rest: { stepTypeId: 5, stepTypeKey: "rest", displayOrder: 5 },
} as const;

const REPEAT_STEP_TYPE = { stepTypeId: 6, stepTypeKey: "repeat", displayOrder: 6 };

const END_CONDITIONS = {
  lap_button: { conditionTypeId: 1, conditionTypeKey: "lap.button", displayOrder: 1, displayable: true },
  time: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
  distance: { conditionTypeId: 3, conditionTypeKey: "distance", displayOrder: 3, displayable: true },
} as const;

const ITERATIONS_CONDITION = {
  conditionTypeId: 7,
  conditionTypeKey: "iterations",
  displayOrder: 7,
  displayable: false,
};

const TARGET_TYPES = {
  none: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 },
  power: { workoutTargetTypeId: 2, workoutTargetTypeKey: "power.zone", displayOrder: 1 },
  cadence: { workoutTargetTypeId: 3, workoutTargetTypeKey: "cadence", displayOrder: 1 },
  heart_rate: { workoutTargetTypeId: 4, workoutTargetTypeKey: "heart.rate.zone", displayOrder: 1 },
  speed: { workoutTargetTypeId: 5, workoutTargetTypeKey: "speed.zone", displayOrder: 1 },
  pace: { workoutTargetTypeId: 6, workoutTargetTypeKey: "pace.zone", displayOrder: 1 },
} as const;

const paceString = z
  .string()
  .regex(/^\d{1,2}:[0-5]\d$/, "pace must be m:ss per km, e.g. 4:45");

const targetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("heart_rate_zone"),
    zone: z.number().int().min(1).max(5).describe("The user's Garmin heart-rate zone, 1-5"),
  }),
  z.object({
    type: z.literal("heart_rate"),
    min_bpm: z.number().int().min(30).max(240),
    max_bpm: z.number().int().min(30).max(240),
  }),
  z.object({
    type: z.literal("pace"),
    fastest_per_km: paceString.describe("Fast end of the pace range, m:ss per km"),
    slowest_per_km: paceString.describe("Slow end of the pace range, m:ss per km"),
  }),
  z.object({
    type: z.literal("power_zone"),
    zone: z.number().int().min(1).max(7).describe("The user's Garmin power zone, 1-7"),
  }),
  z.object({
    type: z.literal("power"),
    min_watts: z.number().int().min(1).max(2500),
    max_watts: z.number().int().min(1).max(2500),
  }),
  z.object({
    type: z.literal("cadence"),
    min: z.number().int().min(1).max(300),
    max: z.number().int().min(1).max(300),
  }),
]);

const durationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("time"),
    seconds: z.number().int().min(1).max(86_400),
  }),
  z.object({
    type: z.literal("distance"),
    meters: z.number().min(1).max(500_000),
  }),
  z.object({ type: z.literal("lap_button") }).describe("Step lasts until the lap button is pressed"),
]);

const simpleStepSchema = z.object({
  type: z.enum(["warmup", "interval", "recovery", "rest", "cooldown"]),
  duration: durationSchema,
  target: targetSchema.optional().describe("Intensity target; omit for no target"),
  note: z.string().max(500).optional().describe("Text shown on the watch for this step"),
});

const repeatSchema = z.object({
  type: z.literal("repeat"),
  iterations: z.number().int().min(1).max(99),
  steps: z.array(simpleStepSchema).min(1).max(20),
});

export const workoutSchema = z.object({
  name: z.string().min(1).max(100),
  sport: z.enum(["running", "cycling", "swimming", "strength", "cardio", "walking", "hiking"]),
  description: z.string().max(1000).optional(),
  steps: z
    .array(z.union([simpleStepSchema, repeatSchema]))
    .min(1)
    .max(50)
    .describe("Steps in order. Use a `repeat` step to wrap an interval/recovery block."),
});

export type WorkoutInput = z.infer<typeof workoutSchema>;
type SimpleStep = z.infer<typeof simpleStepSchema>;
type Target = z.infer<typeof targetSchema>;

/** "4:45" per km -> metres per second. */
export function paceToMps(pace: string): number {
  const [minutes, seconds] = pace.split(":").map(Number) as [number, number];
  const total = minutes * 60 + seconds;
  if (total <= 0) throw new Error(`Invalid pace "${pace}"`);
  return 1000 / total;
}

function ordered(low: number, high: number, what: string): [number, number] {
  if (low > high) throw new Error(`${what}: minimum ${low} is greater than maximum ${high}`);
  return [low, high];
}

function targetFields(target: Target | undefined): Record<string, unknown> {
  if (!target || target.type === "none") return { targetType: TARGET_TYPES.none };
  switch (target.type) {
    case "heart_rate_zone":
      return { targetType: TARGET_TYPES.heart_rate, zoneNumber: target.zone };
    case "power_zone":
      return { targetType: TARGET_TYPES.power, zoneNumber: target.zone };
    case "heart_rate": {
      const [low, high] = ordered(target.min_bpm, target.max_bpm, "heart_rate target");
      return { targetType: TARGET_TYPES.heart_rate, targetValueOne: low, targetValueTwo: high };
    }
    case "power": {
      const [low, high] = ordered(target.min_watts, target.max_watts, "power target");
      return { targetType: TARGET_TYPES.power, targetValueOne: low, targetValueTwo: high };
    }
    case "cadence": {
      const [low, high] = ordered(target.min, target.max, "cadence target");
      return { targetType: TARGET_TYPES.cadence, targetValueOne: low, targetValueTwo: high };
    }
    case "pace": {
      // Garmin stores pace as speed in m/s, so the slower pace is the lower limit.
      const slow = paceToMps(target.slowest_per_km);
      const fast = paceToMps(target.fastest_per_km);
      if (slow > fast) {
        throw new Error(
          `pace target: slowest_per_km (${target.slowest_per_km}) is faster than fastest_per_km (${target.fastest_per_km})`,
        );
      }
      return { targetType: TARGET_TYPES.pace, targetValueOne: slow, targetValueTwo: fast };
    }
  }
}

function durationFields(duration: SimpleStep["duration"]): Record<string, unknown> {
  switch (duration.type) {
    case "time":
      return { endCondition: END_CONDITIONS.time, endConditionValue: duration.seconds };
    case "distance":
      return { endCondition: END_CONDITIONS.distance, endConditionValue: duration.meters };
    case "lap_button":
      return { endCondition: END_CONDITIONS.lap_button };
  }
}

/** Rough duration for Garmin's `estimatedDurationInSecs`; distance assumes 6:00/km. */
function estimateSeconds(step: SimpleStep): number {
  if (step.duration.type === "time") return step.duration.seconds;
  if (step.duration.type === "distance") return Math.round(step.duration.meters * 0.36);
  return 0;
}

export function buildWorkout(input: WorkoutInput): Record<string, unknown> {
  const sportType = SPORTS[input.sport];
  let order = 0;
  let estimated = 0;

  const executable = (step: SimpleStep, weight: number): Record<string, unknown> => {
    estimated += estimateSeconds(step) * weight;
    return {
      type: "ExecutableStepDTO",
      stepOrder: ++order,
      stepType: STEP_TYPES[step.type],
      ...durationFields(step.duration),
      ...targetFields(step.target),
      ...(step.note ? { description: step.note } : {}),
    };
  };

  const workoutSteps = input.steps.map((step) => {
    if (step.type !== "repeat") return executable(step, 1);
    const stepOrder = ++order;
    return {
      type: "RepeatGroupDTO",
      stepOrder,
      stepType: REPEAT_STEP_TYPE,
      numberOfIterations: step.iterations,
      endCondition: ITERATIONS_CONDITION,
      endConditionValue: step.iterations,
      smartRepeat: false,
      workoutSteps: step.steps.map((child) => executable(child, step.iterations)),
    };
  });

  return {
    workoutName: input.name,
    ...(input.description ? { description: input.description } : {}),
    sportType,
    estimatedDurationInSecs: estimated,
    author: {},
    workoutSegments: [{ segmentOrder: 1, sportType, workoutSteps }],
  };
}
