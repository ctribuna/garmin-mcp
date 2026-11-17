/** Runtime configuration, read from environment variables. */

export const MIN_AUTH_TOKEN_LENGTH = 24;

export class ConfigError extends Error {}

/** The shared secret protecting the MCP and admin endpoints. */
export function getAuthToken(): string {
  const token = process.env.MCP_AUTH_TOKEN?.trim();
  if (!token || token.length < MIN_AUTH_TOKEN_LENGTH) {
    throw new ConfigError(
      `MCP_AUTH_TOKEN is missing or shorter than ${MIN_AUTH_TOKEN_LENGTH} characters. ` +
        "Generate one with `openssl rand -hex 32` and set it in the Vercel project.",
    );
  }
  return token;
}

export function isAuthConfigured(): boolean {
  try {
    getAuthToken();
    return true;
  } catch {
    return false;
  }
}

export interface RedisConfig {
  url: string;
  token: string;
}

/** Upstash REST credentials, under either the Vercel KV or the Upstash names. */
export function getRedisConfig(): RedisConfig | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export function getTimezone(): string {
  const tz = process.env.GARMIN_TIMEZONE?.trim() || "Europe/Lisbon";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    throw new ConfigError(
      `GARMIN_TIMEZONE "${tz}" is not a valid IANA timezone (e.g. Europe/Lisbon).`,
    );
  }
}

export function isWriteEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.GARMIN_ENABLE_WRITE?.trim() ?? "");
}
