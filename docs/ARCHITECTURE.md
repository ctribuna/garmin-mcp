# Architecture

This document explains how the server is put together, for someone who wants to change it. For the list of tools and their parameters see [TOOLS.md](TOOLS.md).

The project is a personal, self-hosted remote MCP server for Garmin Connect. It runs on Vercel (Next.js 16 App Router, TypeScript), uses `mcp-handler` 2.x with `@modelcontextprotocol/server` 2.x, validates input with zod 4 and stores tokens in Upstash Redis.

## Request path

```
MCP client
   |  POST /api/mcp/<MCP_AUTH_TOKEN>      or   POST /api/mcp + "Authorization: Bearer <MCP_AUTH_TOKEN>"
   v
app/api/mcp/[key]/route.ts, app/api/mcp/route.ts
   v
src/mcp/handler.ts  handleMcp()  ->  src/lib/auth.ts  authorize()   (401 / 503 on failure)
   v
mcp-handler (createMcpHandler)  ->  registerAll() in src/mcp/server.ts
   v
tool handler (src/mcp/tools/*.ts, wrapped by defineTool in src/mcp/tool.ts)
   v
GarminApi (src/garmin/api.ts: one method per endpoint)
   v
GarminClient (src/garmin/client.ts: tokens, refresh, retries, error mapping)
   v
https://connectapi.garmin.com
```

Both MCP routes export `GET`, `POST` and `DELETE` and have `maxDuration = 60`. They differ only in where the secret comes from: the `[key]` route passes the path segment to `handleMcp`, the plain route passes nothing and relies on the header.

`authorize()` accepts a request if either the path key or the Bearer token matches `MCP_AUTH_TOKEN`. `isValidSecret()` hashes both values with SHA-256 and compares the digests with `timingSafeEqual`, so the comparison is constant time and length-independent. A missing or too short secret (under 24 characters) returns 503 with the reason; a wrong secret returns 401 with `WWW-Authenticate: Bearer`.

Other routes: `GET /api/health` (reports whether auth is configured, whether storage is `redis` or `memory`, and whether write tools are enabled; it needs no secret and exposes no values) and `POST /api/admin/tokens` (see below).

`registerAll()` builds a `ToolContext` (`server`, a `GarminApi`, `writeEnabled`), registers the six tool groups and the three prompts. `getGarminClient()` caches one `GarminClient` per server instance.

## Why login is not done on the server

Garmin's SSO sits behind Cloudflare bot protection. It rejects datacenter IP addresses and TLS fingerprints that do not look like a browser, so a login from Vercel fails. `GarminClient` therefore only uses tokens; it never logs in.

`scripts/garmin_login.py` runs on the user's own machine (`uv run scripts/garmin_login.py --url https://your-app.vercel.app`). It uses the `python-garminconnect` library (with `curl_cffi`) to log in, prompts for an MFA code if needed, reads the resulting `garmin_tokens.json` and POSTs it to `/api/admin/tokens` with the Bearer header. The Garmin password goes only to Garmin. `--print` prints the tokens instead, for use in the `GARMIN_TOKENS` environment variable.

`POST /api/admin/tokens` accepts the secret in the header only, never in the URL. It parses the body with `parseTokens()`, then makes a probe request (`/userprofile-service/socialProfile`) with a throwaway `GarminClient` over a `MemoryTokenStore`. Only if Garmin accepts the tokens are they stored through `getGarminClient().setTokens()`. A bad upload therefore cannot replace a working session. If the probe had to refresh, the refreshed tokens are the ones stored. Failures return 400 (bad format) or 422 (Garmin refused).

## Token lifecycle

Tokens have the shape of python-garminconnect's file: `di_token` (a JWT access token), `di_refresh_token` and `di_client_id`. The client decodes the JWT payload without verifying it, only to read `exp` and `client_id`.

- Before each request, if the access token expires within 15 minutes (`expiresSoon`, margin 900 s), the client refreshes first.
- If Garmin answers 401, the client refreshes once and retries once. A second 401 becomes a `GarminAuthError`.
- A refresh POSTs `grant_type=refresh_token` to `diauth.garmin.com/di-oauth2-service/oauth/token` with HTTP Basic auth built from the client id.
- Garmin rotates the refresh token, so it is effectively single use. If two serverless instances refreshed at the same time, one would spend a token the other had already replaced.

To prevent that, `refresh()` runs inside `store.withLock()`. In Redis this is `SET garmin-mcp:refresh-lock <owner> NX EX 20`, polled every 250 ms for up to 20 seconds, released with a compare-and-delete Lua script so an instance only deletes its own lock. If the lock never frees, the code proceeds anyway once the deadline passes. Inside the lock the client re-reads the store. If the stored `di_token` differs from the stale one and is not about to expire, another instance already rotated it, and those tokens are used without calling Garmin.

Which failures mean what:

| Situation | Error | Meaning |
|---|---|---|
| No tokens stored, or no refresh token or client id | `GarminAuthError` | Log in again |
| Refresh returns 400 or 401 | `GarminAuthError` | Refresh token is dead, log in again |
| Request still 401 after a refresh | `GarminAuthError` | Log in again |
| Refresh returns 429 or 403, other statuses, network error, timeout | `GarminError` | Transient or network block; do not log in again |
| Request returns 403, 404, 429, other | `GarminError` | Reported with the path and Garmin's message |

Error messages for the auth case include the `garmin_login.py` instruction, and `garmin_status` reports token state without exposing values. `getOptional()` turns 404 and 400 (Garmin's answer for "no data that day") into `null`; every other error still propagates.

## Storage

`getTokenStore()` picks the store once per instance.

- Redis (`RedisTokenStore`), when `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` names) are set. The value lives under `garmin-mcp:tokens`.
- Memory (`MemoryTokenStore`) otherwise. It starts from the `GARMIN_TOKENS` environment variable (raw or base64 JSON). Refreshed tokens live only in that instance's memory and are lost on restart or cold start. Because Garmin invalidates the old refresh token on rotation, the original `GARMIN_TOKENS` value can stop working after the first refresh, and separate instances do not share state. Use it for local development only. The upload endpoint warns when it is in this mode.

Encryption: tokens are stored as `v1.<iv>.<tag>.<ciphertext>` (base64url parts) using AES-256-GCM with a random 12 byte IV. The key comes from HKDF-SHA256 over `MCP_AUTH_TOKEN` (salt `garmin-mcp`, info `token-encryption-v1`). Reading the Redis database alone does not give access to the Garmin account. Changing `MCP_AUTH_TOKEN` makes the stored blob undecryptable, and the error says to upload again.

## Output shaping

Garmin responses are large: most fields are null, objects carry account ids and image URLs, and wellness endpoints embed minute-level arrays. `compact()` in `src/lib/compact.ts` shrinks them without a hand-written field list, so fields Garmin adds later are not silently lost. It:

- removes `null`, empty strings, empty arrays and empty objects, and non-finite numbers;
- removes a fixed set of noise keys (owner and profile ids, profile image URLs, `userRoles`) plus any `dropKeys` the tool passes;
- rounds non-integer numbers to 3 decimals, except keys matching `lat` or `lon`;
- reduces arrays longer than `maxArray` (default 60), either by sampling evenly spaced items (`longArrays: "sample"`, adding a `<key>Note` string) or by dropping the array and recording `<key>Count` (`"drop"`).

`pick()` copies a fixed list of keys and is used where the field set is known (activity summaries, sleep summary).

Tools with intraday data take `detail`. `summary` (default) uses `maxArray: 24` with `drop`, which removes minute-level series and keeps totals and scores. `timeseries` uses `maxArray: 144` with `sample`, so curves survive downsampled. Larger values cost much more model context.

`defineTool()` serialises results as compact JSON. A null or empty result becomes the sentence "No data recorded in Garmin Connect for this request." Any thrown error becomes a normal tool result with `isError: true` and the text `Error: <message>`. The model can read it and react (for example, call `garmin_status`), which a protocol-level error would not allow. The tool annotations are derived from the config: `readOnlyHint` and `idempotentHint` are true unless `write`, `destructiveHint` is set by `destructive`, and `openWorldHint` is always true.

## Composite tools and gather()

`get_daily_briefing` and `get_weekly_review` fan out to several endpoints server side, so the model makes one call and the pieces refer to the same day. Several single-domain tools use the same helper (`get_activity`, `get_fitness_metrics`, `get_calendar`, `get_profile`, `get_devices`, `get_training_zones`, `get_respiration_and_spo2`, `get_health_trends`).

`gather()` runs the lookups with `Promise.allSettled`. Fulfilled values are returned under their key. Rejected ones are listed in an `unavailable` object with the error message, and the rest of the result still returns. Only when every lookup failed does it throw the first error, so a full outage shows up as `isError` instead of an empty answer.

## Write tools

`create_workout`, `schedule_workout`, `unschedule_workout` and `delete_workout` are registered only when `GARMIN_ENABLE_WRITE` is `1`, `true`, `yes` or `on` (case-insensitive). With the flag off, `defineTool()` returns without registering them, so clients never see them. They are annotated as not read-only, and the last two as destructive.

`src/garmin/workout.ts` turns a small schema (`workoutSchema`, zod) into Garmin's nested workout payload: sport and step type ids, `ExecutableStepDTO` and `RepeatGroupDTO` nodes with sequential `stepOrder`, end conditions, target types, and an estimated duration (distance steps assume 6:00 per km; repeat children are multiplied by the iteration count). Pace targets are written as `m:ss` per km and converted to metres per second. Garmin stores a pace zone as a speed range, so the slower pace becomes the lower value. Inverted ranges throw before anything is sent.

## Testing

Tests run with `vitest` (`npm test`) and use no network and no Redis.

- `tests/client.test.ts`: a fake `fetch` harness queues canned `Response` objects and records each call. It checks headers, query serialisation, proactive refresh, refresh and retry on 401, reuse of tokens another instance rotated (by swapping the store's `get`), the auth versus transient error split, `getOptional`, display name caching and `assertSafePath`.
- `tests/tools.test.ts`: a fake MCP server that only records `registerTool` handlers, and a real `GarminApi` and `GarminClient` over a fake fetch that routes by URL prefix. The system clock is pinned to 2026-06-15 and the timezone to Europe/Lisbon. Tests call tools by name and assert on the JSON text. They cover write gating, default date windows, `detail` modes, 28-day chunking, partial failure and total failure in `gather()`, `create_workout` followed by scheduling, and `garmin_api_get` path safety.
- `tests/core.test.ts`: dates, `compact`, token parsing and encryption, and the workout builder. `tests/helpers.ts` builds unsigned JWTs.

`garmin_api_get` and the client reject paths that are not rooted at `/`, start with `//`, contain `..`, `?`, `#`, backslashes, whitespace or `://`, so a model cannot steer a request to another host.

## Known limitations

- The Garmin Connect API is private and undocumented. Paths and response fields follow python-garminconnect 0.3.x and can change without notice, which may break a tool until it is updated.
- The client sends the headers of the Garmin Android app. Garmin can block or change that at any time.
- What a tool returns depends on the account and device. Metrics the watch does not record come back absent or as "No data recorded". The code is tested against fakes, not against a live account.
- In the URL form of the endpoint, the secret is part of the URL and therefore appears in MCP client configuration and may appear in proxy or access logs. Prefer the Bearer header where the client supports it. There is one shared secret and no per-client credentials or rate limiting.
- Redis locking is best effort: if the lock cannot be acquired within 20 seconds the refresh proceeds anyway.
- Tokens expire when Garmin ends the session. The user then has to run the login script again.
