# garmin-mcp

[![CI](https://github.com/ctribuna/garmin-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ctribuna/garmin-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A personal, self-hosted remote [MCP](https://modelcontextprotocol.io) server for Garmin Connect. You deploy it to your own Vercel account for your own Garmin account, then connect it to Claude, ChatGPT, Cursor or any other MCP client. The assistant can then read your activities, sleep, HRV, Body Battery, training readiness and training calendar, and, if you allow it, create workouts on your watch. It is free, open source and runs on the free tiers of Vercel and Upstash.

Status: early. The unit and tool tests run against a mocked Garmin API, and the project is new. It has not been battle-tested against real accounts over a long period, and Garmin's private API can change without notice. See the [disclaimer](#disclaimer).

## What you can ask

- "How recovered am I today? Should I do the intervals on my calendar or take it easy?"
- "Review my last week of training. Did I do too much?"
- "Is my resting heart rate trending up over the last month, and how is my HRV baseline?"
- "Compare my last three long runs. Did my heart rate drift in the second half?"
- "Build me a 10 x 400 m workout at 4:00 per km with 90 seconds of jog recovery and put it on my watch for Thursday." (needs write tools)
- "How many kilometres are on my road shoes, and are my race predictions improving?"

## Features

- Composite tools `get_daily_briefing` and `get_weekly_review` answer broad questions in one call instead of a dozen.
- Compact output. Garmin's large JSON responses are trimmed to the fields that matter, so they use fewer tokens.
- Structured workout creation: describe warm-up, intervals, repeats and targets, and the server builds the Garmin workout and can schedule it.
- A raw `garmin_api_get` tool as an escape hatch for read-only endpoints that have no dedicated tool.
- Garmin session tokens are stored encrypted (AES-256-GCM) in Upstash Redis and refreshed automatically.
- Built-in MCP prompts for a daily check-in, a weekly review and race readiness.
- Write tools are off by default and must be enabled explicitly.

## Quick start

You need a Vercel account, a GitHub account and a computer with [uv](https://docs.astral.sh/uv/) installed.

### 1. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fctribuna%2Fgarmin-mcp&env=MCP_AUTH_TOKEN&envDescription=Secret%20that%20protects%20your%20MCP%20endpoint.%20Generate%20with%20openssl%20rand%20-hex%2032)

Vercel asks for `MCP_AUTH_TOKEN`. This is the secret that protects your endpoint. Generate one with:

```bash
openssl rand -hex 32
```

Keep a copy. You need it again for the login script and for your MCP client. It must be at least 24 characters long.

### 2. Add Upstash Redis and redeploy

In your Vercel project, open the Storage tab, add Upstash for Redis from the Marketplace, and connect it to the project. Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Then redeploy so the new variables take effect.

Without Redis the server keeps tokens in memory only and loses them whenever the function restarts.

You can check the deployment at `https://<app>.vercel.app/api/health`. It reports whether the secret is configured, whether storage is `redis` or `memory`, and whether write tools are enabled. It never returns secrets or Garmin data.

### 3. Log in to Garmin from your own computer

Garmin's login cannot run on Vercel. Cloudflare bot protection blocks datacenter IP addresses and non-browser TLS clients. So you log in once on your own machine, and the script uploads the resulting session tokens to your server.

Clone the repository (or download `scripts/garmin_login.py`) and run:

```bash
uv run scripts/garmin_login.py --url https://<app>.vercel.app
```

The script prompts for your Garmin email, your Garmin password, an MFA code if your account uses one, and your deployment's `MCP_AUTH_TOKEN`. Your Garmin password goes only to Garmin. The server receives the session tokens, checks them against Garmin, and stores them encrypted.

From then on the server refreshes the tokens itself. Run the script again only if a tool reports that the Garmin session is no longer valid.

The script also reads `GARMIN_EMAIL`, `GARMIN_PASSWORD`, `MCP_AUTH_TOKEN` and `GARMIN_MCP_URL` from the environment if you prefer not to type them.

### 4. Connect a client

Pick the endpoint style your client supports. See [Connecting clients](#connecting-clients).

## Connecting clients

There are two ways to authenticate.

- Secret in the URL: `https://<app>.vercel.app/api/mcp/<MCP_AUTH_TOKEN>`. Use this for clients that only accept a URL, such as Claude custom connectors and ChatGPT. Treat this URL as a password.
- Bearer header: `https://<app>.vercel.app/api/mcp` with the header `Authorization: Bearer <MCP_AUTH_TOKEN>`. Use this where the client lets you set headers.

### Claude

Open Settings, then Connectors, then Add custom connector. Paste the URL that includes your secret.

### ChatGPT

Add a custom connector (MCP) in the connector or developer settings and paste the URL that includes your secret. The exact menu names depend on your plan and change over time.

### Claude Code

```bash
claude mcp add --transport http garmin https://<app>.vercel.app/api/mcp --header "Authorization: Bearer <token>"
```

### Cursor

Add this to `mcp.json`:

```json
{
  "mcpServers": {
    "garmin": {
      "url": "https://<app>.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

### Other clients

Any client that supports the Streamable HTTP transport works with either endpoint style.

## Tools

All tools are read-only unless marked as write. Dates are `YYYY-MM-DD` in your timezone and default to today. Garmin units are passed through: distances in metres, durations in seconds, speeds in metres per second, weight in grams.

### Insights

| Tool | Description |
| --- | --- |
| `get_daily_briefing` | Training readiness, last night's sleep, HRV status, wellness totals, training status, the last 3 days of activities and the next 2 days of scheduled workouts, in one call. |
| `get_weekly_review` | A 7-day review: every activity with load and training effect, weekly totals by sport, daily sleep, HRV, resting heart rate, stress and readiness series, and the current training status. |

### Activities

| Tool | Description |
| --- | --- |
| `list_activities` | Recorded activities, newest first, with distance, duration, heart rate, pace or speed, power, training effect and load. Filterable by activity type. |
| `get_activity` | Full detail for one activity: summary metrics, splits, time in heart-rate and power zones, weather and strength sets. Choose sections with `include`. |
| `get_activity_timeseries` | Sampled heart rate, speed, cadence, power and elevation over time for one activity, for pacing and drift analysis. |

### Health

| Tool | Description |
| --- | --- |
| `get_daily_summary` | One day's wellness totals: steps, distance, floors, calories, heart rate, stress, Body Battery, intensity minutes, SpO2 and respiration. |
| `get_sleep` | Sleep for the night ending on a date: stages, sleep score and sub-scores, overnight HRV, respiration, SpO2 and sleep need. |
| `get_hrv` | Overnight HRV: last-night average, weekly average, personal baseline range and HRV status. |
| `get_stress` | Stress level for a day, with the intraday curve in timeseries mode. |
| `get_body_battery` | Body Battery per day over a range: charged, drained, highs, lows and the events behind them. |
| `get_heart_rate` | All-day heart rate: resting, 7-day average resting, minimum and maximum, with the intraday curve in timeseries mode. |
| `get_respiration_and_spo2` | Breathing rate and blood oxygen saturation for a date. |
| `get_health_trends` | Daily values of one or more metrics over a date range (sleep, HRV, resting heart rate, stress, Body Battery, steps, intensity minutes, respiration, training readiness, VO2 max). |
| `get_weight` | Weigh-ins over a range, with body composition when a smart scale recorded it. |
| `get_blood_pressure` | Blood pressure readings logged in Garmin Connect over a range. |
| `get_hydration` | Fluid intake against the daily goal, including estimated sweat loss. |

### Training

| Tool | Description |
| --- | --- |
| `get_training_readiness` | Training Readiness score for a date with the factors behind it and Garmin's feedback. |
| `get_training_status` | Status label, acute and chronic load and their ratio, load focus balance, VO2 max and acclimation. |
| `get_fitness_metrics` | VO2 max, fitness age, endurance score, hill score, lactate threshold and cycling FTP in one call. |
| `get_race_predictions` | Predicted finish times for 5K, 10K, half marathon and marathon, current or as a trend over a range. |
| `get_training_zones` | Heart-rate zones per sport and power zones configured in Garmin Connect. |
| `get_personal_records` | Personal records held in Garmin Connect. |
| `get_training_load` | Per-activity training load and training effect over a range, for load progression and ramp analysis. |

### Planning

| Tool | Description |
| --- | --- |
| `get_calendar` | Scheduled workouts, races, other calendar events and the active training plan. Defaults to the next 14 days. |
| `list_workouts` | Structured workouts saved in your Garmin Connect library. |
| `get_workout` | The full step-by-step structure of a saved workout. |
| `create_workout` | Write. Create a structured workout, optionally scheduling it on a date so it syncs to the watch. |
| `schedule_workout` | Write. Put an existing saved workout on the calendar for a date. |
| `unschedule_workout` | Write, destructive. Remove one scheduled occurrence from the calendar. The workout stays in the library. |
| `delete_workout` | Write, destructive. Permanently delete a saved workout and its calendar entries. |

The four write tools are registered only when `GARMIN_ENABLE_WRITE=true`.

### Profile

| Tool | Description |
| --- | --- |
| `garmin_status` | Checks that the server can reach your Garmin account: whether tokens are stored, when the session expires, and the account name. |
| `get_profile` | Your profile and settings: height, weight, measurement system, sleep schedule, lactate threshold and primary activity types. |
| `get_devices` | Registered devices with model, software version, primary training device and last sync. |
| `get_gear` | Shoes, bikes and other gear with total distance and activity count. |
| `garmin_api_get` | Escape hatch: a read-only GET against any Garmin Connect API path when no dedicated tool covers it. |

### Prompts

| Prompt | Description |
| --- | --- |
| `daily_checkin` | How recovered you are today and what today's training should look like. |
| `weekly_review` | Review the last 7 days and plan the next week. |
| `race_readiness` | Assess readiness for a race you name, with an optional goal, and suggest pacing. |

## Configuration

Set these in your Vercel project (Settings, Environment Variables). `.env.example` lists the same variables.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MCP_AUTH_TOKEN` | Yes | none | Secret that protects the MCP endpoint and the token upload endpoint. At least 24 characters. Generate with `openssl rand -hex 32`. It also derives the token encryption key. |
| `KV_REST_API_URL` | Yes, in practice | none | Upstash Redis REST URL. Injected by Vercel when you connect Upstash for Redis. `UPSTASH_REDIS_REST_URL` is also accepted. |
| `KV_REST_API_TOKEN` | Yes, in practice | none | Upstash Redis REST token. Injected by Vercel. `UPSTASH_REDIS_REST_TOKEN` is also accepted. |
| `GARMIN_TIMEZONE` | No | `Europe/Lisbon` | IANA timezone used to resolve "today". Set this to your own. |
| `GARMIN_ENABLE_WRITE` | No | `false` | Set to `true` to expose the tools that create, schedule, unschedule and delete workouts. |
| `GARMIN_TOKENS` | No | none | Fallback when no Redis is configured: the contents of `garmin_tokens.json` (raw JSON or base64). Refreshed tokens then stay in memory only. You can produce the value with `uv run scripts/garmin_login.py --print`. |

Redis is marked "yes, in practice" because the server starts without it, but tokens are then lost on every restart.

## Local development

Requires Node.js 20 or newer.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Edit `.env.local` and set at least `MCP_AUTH_TOKEN`. Then start the dev server:

```bash
npm run dev
```

Run the tests and the type check:

```bash
npm test
```

```bash
npm run typecheck
```

To try the server interactively, start the dev server and run the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

Point it at `http://localhost:3000/api/mcp` using the Streamable HTTP transport, with the header `Authorization: Bearer <your MCP_AUTH_TOKEN>`.

To log in against a local server, use `--url http://localhost:3000`:

```bash
uv run scripts/garmin_login.py --url http://localhost:3000
```

Without Redis configured, tokens are held in the memory of the dev server process.

## Security and privacy

What is stored and where:

- Your Garmin session tokens (not your password) are stored in your own Upstash Redis database, encrypted with AES-256-GCM. The key is derived from `MCP_AUTH_TOKEN`, so a leaked Redis database alone does not give access to your Garmin account.
- Garmin data is fetched on demand and returned to your MCP client. The server does not store it.
- Your Garmin password is never sent to the server. The login script sends it only to Garmin.
- Whatever your MCP client sends to its model provider includes the Garmin data it requested. Check your client's privacy settings.

The endpoint secret:

- Anyone with `MCP_AUTH_TOKEN` can read your Garmin data through the server, and change it if write tools are enabled. The URL form `https://<app>.vercel.app/api/mcp/<MCP_AUTH_TOKEN>` contains the secret, so treat it like a password. Do not paste it into public places, screenshots or shared chats.
- The token upload endpoint (`/api/admin/tokens`) accepts the secret only in the `Authorization` header, never in the URL.
- Secrets in URLs can appear in logs of proxies and clients. Prefer the bearer header when your client supports it.

To rotate the secret:

1. Generate a new value with `openssl rand -hex 32`.
2. Update `MCP_AUTH_TOKEN` in the Vercel project and redeploy.
3. Run the login script again. The stored tokens were encrypted with a key derived from the old secret and can no longer be read.
4. Update the URL or header in every MCP client.

Leave `GARMIN_ENABLE_WRITE` off unless you want the assistant to change your calendar and workout library. The create and delete tools ask the assistant to confirm with you first, but that is a request to the model, not a guarantee.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Troubleshooting

**A tool reports an authentication error.** Ask your client to run `garmin_status`. It reports whether tokens are stored, when the session expires and whether Garmin accepts them. If the session is invalid, run `uv run scripts/garmin_login.py --url https://<app>.vercel.app` again.

**The client gets 401 from the endpoint.** The secret in the URL or header does not match `MCP_AUTH_TOKEN`. If you changed the variable, redeploy and update the client. A 503 response means `MCP_AUTH_TOKEN` is missing or shorter than 24 characters.

**Garmin returns 403.** Garmin is refusing the request. Either the account does not have that feature, or Garmin is blocking the server's network. If it happens on every call, wait and retry later, then run the login script again. The server cannot work around Garmin's network blocking.

**Tokens disappear after a while.** Redis is probably not connected. Open `/api/health` and check that `storage` is `redis`. If it says `memory`, connect Upstash for Redis in the Vercel Storage tab, redeploy, and run the login script again. Also check that you did not change `MCP_AUTH_TOKEN`.

**Rate limiting (429).** Garmin limits request rates, including token refreshes. Wait a few minutes and retry. Prefer `get_daily_briefing` and `get_weekly_review`, or `get_health_trends` over a range, instead of many per-day calls.

**Responses are slow or time out.** Requests have a 60 second limit. Narrow the date range, or request `summary` instead of `timeseries` where a tool offers both.

**A metric is empty.** Garmin returns no data when your watch does not record it or you did not wear it. Tools return "No data recorded in Garmin Connect for this request."

## Disclaimer

This project uses Garmin Connect's private, unofficial API, the same one the Garmin mobile app uses. It follows the maintained Python library [python-garminconnect](https://github.com/cyberjunky/python-garminconnect) 0.3.x. It is not affiliated with, endorsed by or supported by Garmin. Garmin can change or block this API at any time, which may break the server until it is updated. It is meant for accessing your own data from your own account. Check Garmin's terms of service and use it at your own risk.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT. See [LICENSE](LICENSE).
