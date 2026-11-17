/**
 * Authenticated client for the Garmin Connect API tier (connectapi.garmin.com).
 *
 * This is the same private API the Garmin Connect mobile app uses. Requests
 * carry a DI OAuth bearer token; the client refreshes it shortly before it
 * expires (and once more on a 401) and persists the rotated tokens.
 *
 * The initial login is deliberately not implemented here: Garmin's SSO sits
 * behind Cloudflare bot protection that rejects datacenter IPs and non-browser
 * TLS fingerprints, so it has to happen on the user's own machine
 * (scripts/garmin_login.py), which then uploads the resulting tokens.
 */

import {
  decodeJwtPayload,
  expiresSoon,
  getTokenStore,
  type GarminTokens,
  type TokenStore,
} from "./tokens";

const API_BASE = "https://connectapi.garmin.com";
const DI_TOKEN_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_TIMEOUT_MS = 30_000;

/** Identify as the Android app, as the reference client does. */
const NATIVE_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent": "GCM-Android-5.23",
  "X-Garmin-User-Agent":
    "com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0",
  "X-Garmin-Paired-App-Version": "10861",
  "X-Garmin-Client-Platform": "Android",
  "X-App-Ver": "10861",
  "X-Lang": "en",
  "X-GCExperience": "GC5",
  "Accept-Language": "en-US,en;q=0.9",
};

export class GarminError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GarminError";
  }
}

/** The stored tokens are missing or no longer usable; a new login is needed. */
export class GarminAuthError extends GarminError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "GarminAuthError";
  }
}

const RELOGIN_HINT =
  "Run `uv run scripts/garmin_login.py` on your own computer to log in to Garmin again and upload fresh tokens.";

export type QueryValue = string | number | boolean | undefined | null;
export type Query = Record<string, QueryValue | readonly (string | number)[]>;

export interface RequestOptions {
  params?: Query;
  body?: unknown;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Reject anything that could redirect a request away from the intended path. */
export function assertSafePath(path: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new GarminError(`Invalid API path: ${path}`);
  }
  const traversal = decoded.split("/").some((segment) => segment.split(";", 1)[0] === "..");
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    traversal ||
    /[?#\\\s]/.test(decoded) ||
    decoded.includes("://")
  ) {
    throw new GarminError(
      `Invalid API path: ${path}. Use a path like /wellness-service/wellness/dailyStress/2026-01-31 and pass query values separately.`,
    );
  }
  return path;
}

function buildUrl(path: string, params?: Query): string {
  const url = new URL(API_BASE + assertSafePath(path));
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object") {
      const { message, content } = data as Record<string, unknown>;
      const detail = typeof message === "string" ? message : content;
      if (typeof detail === "string") return detail.slice(0, 300);
    }
  } catch {
    // Non-JSON error bodies (HTML block pages) carry nothing useful.
  }
  return "";
}

export class GarminClient {
  private tokens: GarminTokens | null = null;
  private displayNamePromise: Promise<string> | null = null;

  constructor(
    private readonly store: TokenStore,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  // --- tokens --------------------------------------------------------------

  private async loadTokens(): Promise<GarminTokens> {
    if (!this.tokens) this.tokens = await this.store.get();
    if (!this.tokens) {
      throw new GarminAuthError(`No Garmin tokens are stored yet. ${RELOGIN_HINT}`);
    }
    return this.tokens;
  }

  /** Replace the stored tokens (used by the upload endpoint). */
  async setTokens(tokens: GarminTokens): Promise<void> {
    await this.store.set(tokens);
    this.tokens = tokens;
    this.displayNamePromise = null;
  }

  /**
   * Refresh the access token. `stale` is the token that prompted the refresh:
   * if another instance already rotated it, its result is reused instead of
   * spending the (single-use) refresh token a second time.
   */
  private async refresh(stale: GarminTokens): Promise<GarminTokens> {
    return this.store.withLock(async () => {
      const stored = await this.store.get();
      if (stored && stored.di_token !== stale.di_token && !expiresSoon(stored)) {
        this.tokens = stored;
        return stored;
      }
      const current = stored ?? stale;
      if (!current.di_refresh_token || !current.di_client_id) {
        throw new GarminAuthError(`The stored Garmin tokens have no refresh token. ${RELOGIN_HINT}`);
      }

      let response: Response;
      try {
        response = await this.fetchImpl(DI_TOKEN_URL, {
          method: "POST",
          headers: {
            ...NATIVE_HEADERS,
            Authorization: `Basic ${Buffer.from(`${current.di_client_id}:`).toString("base64")}`,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "Cache-Control": "no-cache",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: current.di_client_id,
            refresh_token: current.di_refresh_token,
          }).toString(),
          signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
        });
      } catch (error) {
        throw new GarminError(
          `Could not reach Garmin to refresh the session: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (response.status === 429) {
        throw new GarminError("Garmin is rate limiting token refreshes; try again in a few minutes.", 429);
      }
      if (!response.ok) {
        const message = `Garmin rejected the token refresh (HTTP ${response.status}).`;
        // 400/401 mean the refresh token itself is dead; anything else may be transient.
        if (response.status === 400 || response.status === 401) {
          throw new GarminAuthError(`${message} ${RELOGIN_HINT}`, response.status);
        }
        throw new GarminError(
          `${message} A 403 usually means Garmin is blocking this server's network rather than the token.`,
          response.status,
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      if (typeof data.access_token !== "string") {
        throw new GarminError("Garmin's token refresh response did not contain an access token.");
      }
      const clientId = decodeJwtPayload(data.access_token)?.client_id;
      const next: GarminTokens = {
        di_token: data.access_token,
        di_refresh_token:
          typeof data.refresh_token === "string" ? data.refresh_token : current.di_refresh_token,
        di_client_id: typeof clientId === "string" && clientId ? clientId : current.di_client_id,
      };
      await this.store.set(next);
      this.tokens = next;
      return next;
    });
  }

  // --- requests ------------------------------------------------------------

  private send(method: string, url: string, tokens: GarminTokens, body: unknown): Promise<Response> {
    return this.fetchImpl(url, {
      method,
      headers: {
        ...NATIVE_HEADERS,
        Authorization: `Bearer ${tokens.di_token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = buildUrl(path, options.params);
    let tokens = await this.loadTokens();
    if (expiresSoon(tokens)) tokens = await this.refresh(tokens);

    let response: Response;
    try {
      response = await this.send(method, url, tokens, options.body);
      if (response.status === 401) {
        tokens = await this.refresh(tokens);
        response = await this.send(method, url, tokens, options.body);
      }
    } catch (error) {
      if (error instanceof GarminError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new GarminError(`Request to Garmin failed (${method} ${path}): ${reason}`);
    }

    if (response.status === 204) return null as T;
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      const suffix = detail ? ` - ${detail}` : "";
      const where = `${method} ${path}`;
      switch (response.status) {
        case 401:
          throw new GarminAuthError(`Garmin rejected the session token (${where}). ${RELOGIN_HINT}`, 401);
        case 403:
          throw new GarminError(
            `Garmin refused ${where} (HTTP 403)${suffix}. The account may not have this feature, or Garmin is blocking this server.`,
            403,
          );
        case 404:
          throw new GarminError(`Garmin has no data at ${where} (HTTP 404)${suffix}.`, 404);
        case 429:
          throw new GarminError("Garmin is rate limiting requests; wait a minute and retry.", 429);
        default:
          throw new GarminError(`Garmin API error ${response.status} for ${where}${suffix}.`, response.status);
      }
    }

    const text = await response.text();
    if (!text.trim()) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GarminError(`Garmin returned a non-JSON response for ${method} ${path}.`);
    }
  }

  get<T = unknown>(path: string, params?: Query): Promise<T> {
    return this.request<T>("GET", path, { params });
  }

  /**
   * GET that treats "nothing recorded" as null instead of an error. Garmin
   * answers 404 (and sometimes 400) for days or metrics without data.
   */
  async getOptional<T = unknown>(path: string, params?: Query): Promise<T | null> {
    try {
      return await this.get<T>(path, params);
    } catch (error) {
      if (error instanceof GarminError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }
  }

  // --- profile -------------------------------------------------------------

  /** URL-encoded display name, required in the path of several endpoints. */
  displayName(): Promise<string> {
    this.displayNamePromise ??= this.get<Record<string, unknown>>("/userprofile-service/socialProfile")
      .then((profile) => {
        const name = profile?.displayName;
        if (typeof name !== "string" || !name.trim()) {
          throw new GarminError("The Garmin profile has no display name, which several endpoints require.");
        }
        return encodeURIComponent(name);
      })
      .catch((error: unknown) => {
        this.displayNamePromise = null;
        throw error;
      });
    return this.displayNamePromise;
  }

  /** Token state for diagnostics; never exposes token values. */
  async tokenStatus(): Promise<{
    stored: boolean;
    storage: TokenStore["kind"];
    accessTokenExpiresAt: string | null;
    hasRefreshToken: boolean;
  }> {
    const tokens = this.tokens ?? (await this.store.get());
    const exp = tokens ? decodeJwtPayload(tokens.di_token)?.exp : null;
    return {
      stored: Boolean(tokens),
      storage: this.store.kind,
      accessTokenExpiresAt: typeof exp === "number" ? new Date(exp * 1000).toISOString() : null,
      hasRefreshToken: Boolean(tokens?.di_refresh_token),
    };
  }
}

let cachedClient: GarminClient | null = null;

export function getGarminClient(): GarminClient {
  cachedClient ??= new GarminClient(getTokenStore());
  return cachedClient;
}
