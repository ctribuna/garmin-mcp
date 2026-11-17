/**
 * Shrink Garmin API payloads before handing them to a model.
 *
 * Garmin responses are verbose: most fields are null, every object carries
 * account ids and image URLs, and wellness endpoints embed minute-level time
 * series. Compacting keeps tool results small without choosing fields by hand,
 * so nothing the API adds later is silently lost.
 */

export interface CompactOptions {
  /** Arrays longer than this are reduced. Default 60. */
  maxArray?: number;
  /**
   * What to do with over-long arrays: "sample" keeps evenly spaced items,
   * "drop" removes the array and records its length instead.
   */
  longArrays?: "sample" | "drop";
  /** Extra keys to remove everywhere. */
  dropKeys?: readonly string[];
}

/** Keys that never help a model reason about training or health. */
const NOISE_KEYS = new Set([
  "userProfilePK",
  "userProfilePk",
  "userProfileId",
  "userProfileNumber",
  "ownerId",
  "ownerDisplayName",
  "ownerFullName",
  "ownerProfileImageUrlSmall",
  "ownerProfileImageUrlMedium",
  "ownerProfileImageUrlLarge",
  "profileImageUrlSmall",
  "profileImageUrlMedium",
  "profileImageUrlLarge",
  "userRoles",
  "userPro",
]);

const COORDINATE_KEY = /lat|lon/i;

function roundNumber(key: string | undefined, value: number): number {
  if (Number.isInteger(value) || (key && COORDINATE_KEY.test(key))) return value;
  return Math.round(value * 1000) / 1000;
}

function sample<T>(items: T[], max: number): T[] {
  if (max <= 1) return items.slice(0, Math.max(max, 0));
  const step = (items.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)] as T);
  return out;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

export function compact(value: unknown, options: CompactOptions = {}): unknown {
  const maxArray = options.maxArray ?? 60;
  const longArrays = options.longArrays ?? "sample";
  const drop = new Set([...NOISE_KEYS, ...(options.dropKeys ?? [])]);

  const walk = (node: unknown, key?: string): unknown => {
    if (node === null || node === undefined) return undefined;
    if (typeof node === "number") {
      return Number.isFinite(node) ? roundNumber(key, node) : undefined;
    }
    if (typeof node !== "object") return node;

    if (Array.isArray(node)) {
      const items = node.length > maxArray ? sample(node, maxArray) : node;
      return items.map((item) => walk(item, key)).filter((item) => !isEmpty(item));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (drop.has(k)) continue;
      if (Array.isArray(v) && v.length > maxArray) {
        if (longArrays === "drop") {
          out[`${k}Count`] = v.length;
          continue;
        }
        out[`${k}Note`] = `downsampled from ${v.length} to ${maxArray} points`;
      }
      const child = walk(v, k);
      if (!isEmpty(child)) out[k] = child;
    }
    return out;
  };

  const result = walk(value);
  return result === undefined ? null : result;
}

/** Copy only the listed keys that are present and non-null. */
export function pick<T extends Record<string, unknown>>(
  source: T | null | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!source) return out;
  for (const key of keys) {
    const value = source[key];
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}
