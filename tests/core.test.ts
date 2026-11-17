import { describe, expect, it } from "vitest";
import { buildWorkout, paceToMps } from "@/garmin/workout";
import { decryptTokens, encryptTokens, expiresSoon, parseTokens, TokenFormatError } from "@/garmin/tokens";
import { compact } from "@/lib/compact";
import { addDays, assertDate, chunkRange, daysBetween, resolveRange, today } from "@/lib/dates";
import { tokensExpiringIn } from "./helpers";

describe("dates", () => {
  it("resolves today in the given timezone", () => {
    const instant = new Date("2026-03-01T23:30:00Z");
    expect(today(instant, "Europe/Lisbon")).toBe("2026-03-01");
    expect(today(instant, "Asia/Tokyo")).toBe("2026-03-02");
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => assertDate("2026-2-1")).toThrow();
    expect(() => assertDate("2026-02-31")).toThrow();
    expect(assertDate("2028-02-29")).toBe("2028-02-29");
  });

  it("chunks ranges without gaps or overlap", () => {
    const chunks = chunkRange({ start: "2026-01-01", end: "2026-03-01" }, 28);
    expect(chunks).toEqual([
      { start: "2026-01-01", end: "2026-01-28" },
      { start: "2026-01-29", end: "2026-02-25" },
      { start: "2026-02-26", end: "2026-03-01" },
    ]);
    expect(daysBetween("2026-01-01", "2026-03-01")).toBe(60);
  });

  it("defaults and bounds ranges", () => {
    expect(resolveRange(undefined, "2026-01-10", 7, 30)).toEqual({ start: "2026-01-04", end: "2026-01-10" });
    expect(() => resolveRange("2026-01-01", "2026-03-01", 7, 30)).toThrow(/exceeds/);
    expect(() => resolveRange("2026-01-11", "2026-01-10", 7, 30)).toThrow(/after/);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("compact", () => {
  it("removes nulls, empties and account noise but keeps real values", () => {
    const out = compact({ a: null, b: [], c: {}, d: 0, e: false, f: "", ownerId: 5, keep: { x: 1.23456 } });
    expect(out).toEqual({ d: 0, e: false, keep: { x: 1.235 } });
  });

  it("downsamples or drops long arrays and says so", () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const sampled = compact({ values }, { maxArray: 10 }) as Record<string, unknown>;
    expect(sampled.values).toHaveLength(10);
    expect((sampled.values as number[])[0]).toBe(0);
    expect((sampled.values as number[])[9]).toBe(99);
    expect(sampled.valuesNote).toMatch(/100 to 10/);
    expect(compact({ values }, { maxArray: 10, longArrays: "drop" })).toEqual({ valuesCount: 100 });
  });

  it("does not round coordinates", () => {
    expect(compact({ startLatitude: 38.7222524 })).toEqual({ startLatitude: 38.7222524 });
  });
});

describe("tokens", () => {
  it("round-trips through encryption and rejects the wrong secret", () => {
    const tokens = tokensExpiringIn(3600);
    const blob = encryptTokens(tokens, "secret-one");
    expect(blob).not.toContain(tokens.di_token);
    expect(decryptTokens(blob, "secret-one")).toEqual(tokens);
    expect(() => decryptTokens(blob, "secret-two")).toThrow(TokenFormatError);
  });

  it("parses raw and base64 JSON and rejects legacy garth tokens", () => {
    const tokens = tokensExpiringIn(3600);
    const raw = JSON.stringify(tokens);
    expect(parseTokens(raw)).toEqual(tokens);
    expect(parseTokens(Buffer.from(raw).toString("base64"))).toEqual(tokens);
    expect(() => parseTokens('{"oauth_token":"x"}')).toThrow(/legacy garth/);
    expect(() => parseTokens('{"di_token":"not-a-jwt"}')).toThrow(TokenFormatError);
  });

  it("flags tokens inside the refresh margin", () => {
    expect(expiresSoon(tokensExpiringIn(3600))).toBe(false);
    expect(expiresSoon(tokensExpiringIn(600))).toBe(true);
    expect(expiresSoon(tokensExpiringIn(-10))).toBe(true);
  });
});

describe("workout builder", () => {
  it("converts pace to metres per second", () => {
    expect(paceToMps("5:00")).toBeCloseTo(3.3333, 3);
  });

  it("builds nested repeats with sequential step order and targets", () => {
    const payload = buildWorkout({
      name: "6x800",
      sport: "running",
      steps: [
        { type: "warmup", duration: { type: "time", seconds: 600 } },
        {
          type: "repeat",
          iterations: 6,
          steps: [
            {
              type: "interval",
              duration: { type: "distance", meters: 800 },
              target: { type: "pace", fastest_per_km: "3:50", slowest_per_km: "4:00" },
            },
            { type: "recovery", duration: { type: "time", seconds: 120 }, target: { type: "heart_rate_zone", zone: 1 } },
          ],
        },
        { type: "cooldown", duration: { type: "lap_button" } },
      ],
    }) as any;

    expect(payload.sportType.sportTypeKey).toBe("running");
    const steps = payload.workoutSegments[0].workoutSteps;
    expect(steps.map((s: any) => s.stepOrder)).toEqual([1, 2, 5]);
    const repeat = steps[1];
    expect(repeat.type).toBe("RepeatGroupDTO");
    expect(repeat.numberOfIterations).toBe(6);
    expect(repeat.workoutSteps.map((s: any) => s.stepOrder)).toEqual([3, 4]);

    const interval = repeat.workoutSteps[0];
    expect(interval.endCondition.conditionTypeKey).toBe("distance");
    expect(interval.targetType.workoutTargetTypeKey).toBe("pace.zone");
    // Slower pace is the lower speed limit.
    expect(interval.targetValueOne).toBeLessThan(interval.targetValueTwo);
    expect(repeat.workoutSteps[1].zoneNumber).toBe(1);
    expect(steps[2].endCondition.conditionTypeKey).toBe("lap.button");
    // 600 warm-up + 6 * (800 m * 0.36 + 120 s)
    expect(payload.estimatedDurationInSecs).toBe(600 + 6 * (288 + 120));
  });

  it("rejects an inverted pace range", () => {
    expect(() =>
      buildWorkout({
        name: "bad",
        sport: "running",
        steps: [
          {
            type: "interval",
            duration: { type: "time", seconds: 60 },
            target: { type: "pace", fastest_per_km: "5:00", slowest_per_km: "4:00" },
          },
        ],
      }),
    ).toThrow(/faster than/);
  });
});
