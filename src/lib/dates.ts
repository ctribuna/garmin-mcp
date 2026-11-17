/** Calendar-date helpers. All dates are `YYYY-MM-DD` strings in the user's timezone. */

import { getTimezone } from "./config";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DateError extends Error {}

export function assertDate(value: string, name = "date"): string {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new DateError(`${name} must be a valid date in YYYY-MM-DD format, got "${value}"`);
  }
  // Reject dates JS silently rolls over, e.g. 2026-02-31.
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new DateError(`${name} "${value}" is not a real calendar date`);
  }
  return value;
}

/** Today's date in the configured timezone. */
export function today(now: Date = new Date(), timeZone: string = getTimezone()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive number of days from start to end. */
export function daysBetween(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

export function resolveDate(value: string | undefined, name = "date"): string {
  return value ? assertDate(value, name) : today();
}

export interface DateRange {
  start: string;
  end: string;
}

/**
 * Resolve an optional range. `end` defaults to today and `start` to
 * `defaultDays` before `end` (inclusive). Enforces `maxDays`.
 */
export function resolveRange(
  start: string | undefined,
  end: string | undefined,
  defaultDays: number,
  maxDays: number,
): DateRange {
  const e = resolveDate(end, "end_date");
  const s = start ? assertDate(start, "start_date") : addDays(e, -(defaultDays - 1));
  if (s > e) throw new DateError(`start_date ${s} is after end_date ${e}`);
  const span = daysBetween(s, e);
  if (span > maxDays) {
    throw new DateError(
      `Date range of ${span} days exceeds the ${maxDays}-day limit for this tool; request a shorter range.`,
    );
  }
  return { start: s, end: e };
}

/** Split an inclusive range into consecutive chunks of at most `size` days. */
export function chunkRange(range: DateRange, size: number): DateRange[] {
  const chunks: DateRange[] = [];
  let cursor = range.start;
  while (cursor <= range.end) {
    const chunkEnd = addDays(cursor, size - 1);
    const end = chunkEnd < range.end ? chunkEnd : range.end;
    chunks.push({ start: cursor, end });
    cursor = addDays(end, 1);
  }
  return chunks;
}
