/**
 * Garmin DI OAuth tokens and where they live.
 *
 * Garmin rotates the refresh token on every refresh, so tokens need writable
 * storage that survives across serverless invocations: Upstash Redis. They are
 * encrypted at rest with a key derived from MCP_AUTH_TOKEN, so reading the
 * Redis database alone does not grant access to the Garmin account.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { getAuthToken, getRedisConfig } from "@/lib/config";

/** Same shape as python-garminconnect's `garmin_tokens.json`. */
export interface GarminTokens {
  di_token: string;
  di_refresh_token: string | null;
  di_client_id: string | null;
}

export class TokenFormatError extends Error {}

/** Validate untrusted input (upload body, env var, Redis value) as tokens. */
export function parseTokens(input: unknown): GarminTokens {
  let data = input;
  if (typeof data === "string") {
    const text = data.trim();
    try {
      data = JSON.parse(text.startsWith("{") ? text : Buffer.from(text, "base64").toString("utf8"));
    } catch {
      throw new TokenFormatError("Tokens are not valid JSON (raw or base64-encoded).");
    }
  }
  if (!data || typeof data !== "object") {
    throw new TokenFormatError("Tokens must be a JSON object.");
  }
  const record = data as Record<string, unknown>;
  if ("oauth_token" in record || "oauth1_token" in record || "oauth2_token" in record) {
    throw new TokenFormatError(
      "These look like legacy garth tokens (oauth1/oauth2), which Garmin no longer accepts. " +
        "Run scripts/garmin_login.py to create a current garmin_tokens.json.",
    );
  }
  const { di_token, di_refresh_token, di_client_id } = record;
  if (typeof di_token !== "string" || di_token.split(".").length < 3) {
    throw new TokenFormatError("Missing or malformed `di_token` (expected a JWT).");
  }
  return {
    di_token,
    di_refresh_token: typeof di_refresh_token === "string" ? di_refresh_token : null,
    di_client_id: typeof di_client_id === "string" ? di_client_id : null,
  };
}

/** Decode a JWT payload without verifying it; only Garmin holds the key. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const parsed: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Expiry of the access token in epoch seconds, or null when unknown. */
export function tokenExpiry(tokens: GarminTokens): number | null {
  const exp = decodeJwtPayload(tokens.di_token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
}

/** True when the access token expires within `marginSeconds` (default 15 min). */
export function expiresSoon(
  tokens: GarminTokens,
  marginSeconds = 900,
  nowMs: number = Date.now(),
): boolean {
  const exp = tokenExpiry(tokens);
  return exp !== null && nowMs / 1000 > exp - marginSeconds;
}

// --- encryption at rest ----------------------------------------------------

function encryptionKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "garmin-mcp", "token-encryption-v1", 32));
}

export function encryptTokens(tokens: GarminTokens, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptTokens(blob: string, secret: string): GarminTokens {
  const [version, iv, tag, body] = blob.split(".");
  if (version !== "v1" || !iv || !tag || !body) {
    throw new TokenFormatError("Stored tokens are in an unknown format.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const text = Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return parseTokens(text);
  } catch (error) {
    if (error instanceof TokenFormatError) throw error;
    throw new TokenFormatError(
      "Stored Garmin tokens could not be decrypted. MCP_AUTH_TOKEN probably changed " +
        "since they were uploaded; upload them again with scripts/garmin_login.py.",
    );
  }
}

// --- stores ----------------------------------------------------------------

export interface TokenStore {
  readonly kind: "redis" | "memory";
  get(): Promise<GarminTokens | null>;
  set(tokens: GarminTokens): Promise<void>;
  /** Run `fn` while holding a best-effort cross-instance lock. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

const TOKENS_KEY = "garmin-mcp:tokens";
const LOCK_KEY = "garmin-mcp:refresh-lock";
const LOCK_TTL_SECONDS = 20;

export class RedisTokenStore implements TokenStore {
  readonly kind = "redis" as const;

  constructor(
    private readonly redis: Pick<Redis, "get" | "set" | "eval">,
    private readonly secret: string,
  ) {}

  async get(): Promise<GarminTokens | null> {
    const blob = await this.redis.get<string>(TOKENS_KEY);
    return blob ? decryptTokens(blob, this.secret) : null;
  }

  async set(tokens: GarminTokens): Promise<void> {
    await this.redis.set(TOKENS_KEY, encryptTokens(tokens, this.secret));
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const owner = randomBytes(12).toString("hex");
    const deadline = Date.now() + LOCK_TTL_SECONDS * 1000;
    let held = false;
    while (Date.now() < deadline) {
      const ok = await this.redis.set(LOCK_KEY, owner, { nx: true, ex: LOCK_TTL_SECONDS });
      if (ok === "OK") {
        held = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    // If the lock never frees (holder crashed), proceed anyway once it expires.
    try {
      return await fn();
    } finally {
      if (held) {
        // Release only our own lock.
        await this.redis
          .eval(
            'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
            [LOCK_KEY],
            [owner],
          )
          .catch(() => undefined);
      }
    }
  }
}

/**
 * Fallback without Redis: tokens come from the GARMIN_TOKENS env var and
 * refreshed tokens live only in this instance's memory.
 */
export class MemoryTokenStore implements TokenStore {
  readonly kind = "memory" as const;
  private tokens: GarminTokens | null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(initial: GarminTokens | null = null) {
    this.tokens = initial;
  }

  async get(): Promise<GarminTokens | null> {
    return this.tokens;
  }

  async set(tokens: GarminTokens): Promise<void> {
    this.tokens = tokens;
  }

  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

let cachedStore: TokenStore | null = null;

export function getTokenStore(): TokenStore {
  if (cachedStore) return cachedStore;
  const redis = getRedisConfig();
  if (redis) {
    cachedStore = new RedisTokenStore(
      new Redis({ url: redis.url, token: redis.token }),
      getAuthToken(),
    );
  } else {
    const env = process.env.GARMIN_TOKENS?.trim();
    cachedStore = new MemoryTokenStore(env ? parseTokens(env) : null);
  }
  return cachedStore;
}
