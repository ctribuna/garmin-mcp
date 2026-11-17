# Tools reference

The server exposes 35 tools (31 read-only, 4 write) and 3 prompts. Tools are grouped as the source files in `src/mcp/tools/` group them.

Conventions used by all tools:

- Dates are `YYYY-MM-DD` strings in the timezone set by `GARMIN_TIMEZONE` (default `Europe/Lisbon`). "Defaults to today" means today in that timezone.
- Range tools take `start_date` and `end_date` (inclusive). `end_date` defaults to today, and `start_date` defaults to a fixed number of days ending at `end_date`. A range over the tool's maximum fails with an error that names the limit.
- Results are compact JSON (see ARCHITECTURE.md). When Garmin has nothing for the request the text is "No data recorded in Garmin Connect for this request."
- Failures are returned as results with `isError: true` and the text `Error: <message>`.
- Tools that combine several lookups return an `unavailable` object for the lookups that failed, and the rest of the data.

Parameter tables list the name, type, default and meaning. "optional" means no default value.

## Insights

### get_daily_briefing

Answers "how am I today and what should I do?" in one call.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `date` | string (YYYY-MM-DD) | today | Day to brief on |

Result: `date`, then `trainingReadiness` (first reading of the day), `sleep` (selected sleep fields plus `avgOvernightHrv`, `hrvStatus`, `restingHeartRate`, `bodyBatteryChange`), `hrv` (the HRV summary), `wellness` (selected daily totals: steps, distance, calories, heart rate, stress, Body Battery, intensity minutes, respiration, SpO2), `trainingStatus`, `recentActivities` (last 3 days, up to 15, activity summaries) and `scheduled` (workouts for the next 2 days).

### get_weekly_review

7-day training and recovery review.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `end_date` | string (YYYY-MM-DD) | today | Last day of the 7-day window |

Result: `range`, `totalsBySport` (count, `distanceM`, `durationSec`, `load` per sport), `activities` (up to 100 summaries), and daily series `sleep`, `hrv`, `restingHeartRate`, `stress`, `trainingReadiness`, plus `trainingStatus` for the end date.

## Activities

### list_activities

Lists recorded activities, newest first.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `start_date` | string | 30 days ending at `end_date` | First day |
| `end_date` | string | today | Last day, inclusive |
| `activity_type` | string | optional | Garmin type key, for example `running`, `cycling`, `swimming`, `strength_training`, `hiking`, `walking`, `fitness_equipment` |
| `limit` | integer 1-100 | 20 | Maximum activities to return |
| `offset` | integer >= 0 | 0 | Activities to skip, for paging |

Maximum range: 3660 days. Result: `range`, `count`, `hasMore` (true when `count` equals `limit`) and `activities`. Each activity has `activityId`, name, start time, distance (m), duration (s), speeds (m/s), heart rate, power, cadence, training effect and load, time in heart-rate zones, `type` and, when not uncategorized, `eventType`.

### get_activity

Detail for one activity.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `activity_id` | integer > 0 | required | Id from `list_activities` |
| `include` | array of `splits`, `hr_zones`, `power_zones`, `weather`, `exercise_sets` | `["splits","hr_zones","weather"]` | Extra sections to load |

Result: `summary` plus `splits`, `hrZones`, `powerZones`, `weather`, `exerciseSets` for the sections requested. Arrays are capped at 100 items.

### get_activity_timeseries

Sampled time series for one activity (heart rate, speed, cadence, power, elevation).

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `activity_id` | integer > 0 | required | Id from `list_activities` |
| `points` | integer 20-500 | 120 | Approximate number of samples |

Result: the activity details with `metricDescriptors` (names of the columns) and `metrics` rows. Route polyline and heart-rate DTOs are removed.

## Health

Tools with a `detail` parameter share this definition: `detail` is `summary` or `timeseries`, default `summary`. `summary` returns totals and scores only. `timeseries` also returns the intraday samples, downsampled, and uses much more context.

### get_daily_summary

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `date` | string | today | Day |

Result: the day's wellness totals: steps, distance, floors, active and resting calories, resting and min/max heart rate, stress breakdown, Body Battery, intensity minutes, SpO2 and respiration averages.

### get_sleep

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `date` | string | today | The morning the sleep ended |
| `detail` | `summary` or `timeseries` | `summary` | See above |

Result: total and per-stage durations (seconds), sleep score with sub-scores and feedback, overnight HRV, resting heart rate, respiration, SpO2, Body Battery change and sleep need.

### get_hrv

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `date` | string | today | Day |
| `detail` | `summary` or `timeseries` | `summary` | See above |

Result: last-night average and 5-minute high, weekly average, baseline range and HRV status. Values are milliseconds (rMSSD).

### get_stress

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `date` | string | today | Day |
| `detail` | `summary` or `timeseries` | `summary` | See above |

Result: average and max stress (0-100; 0-25 rest, 26-50 low, 51-75 medium, 76-100 high). Intraday stress and Body Battery curves only in `timeseries`.

### get_body_battery

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `start_date` | string | 7 days ending at `end_date` | First day |
| `end_date` | string | today | Last day |
| `detail` | `summary` or `timeseries` | `summary` | See above |

Maximum range: 31 days. Result: per day charged and drained amounts, highest and lowest values, and charge/drain events.

### get_heart_rate

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `date` | string | today | Day |
| `detail` | `summary` or `timeseries` | `summary` | See above |

Result: resting heart rate, 7-day average resting heart rate, daily minimum and maximum, and the intraday curve in `timeseries`.

### get_respiration_and_spo2

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `date` | string | today | Day |
| `detail` | `summary` or `timeseries` | `summary` | See above |

Result: `respiration` (breaths per minute, awake and asleep) and `spo2` (average, lowest, during sleep).

### get_health_trends

Daily values of several metrics over a range.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `metrics` | array (1-6) of `sleep`, `hrv`, `resting_heart_rate`, `stress`, `body_battery`, `steps`, `intensity_minutes`, `respiration`, `training_readiness`, `vo2max` | required | Metrics to return, duplicates ignored |
| `start_date` | string | 28 days ending at `end_date` | First day |
| `end_date` | string | today | Last day |

Maximum range: 366 days. Ranges are fetched in 28-day chunks. Result: `range` and one series per requested metric, keyed by its name (arrays capped at 400).

### get_weight

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `start_date` | string | 90 days ending at `end_date` | First day |
| `end_date` | string | today | Last day |

Maximum range: 3660 days. Result: weigh-ins with body composition when a smart scale recorded it (weight, BMI, body fat, body water, muscle and bone mass). Weight is in grams. Arrays capped at 200.

### get_blood_pressure

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `start_date` | string | 90 days ending at `end_date` | First day |
| `end_date` | string | today | Last day |

Maximum range: 3660 days. Result: systolic, diastolic and pulse readings (arrays capped at 200).

### get_hydration

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `date` | string | today | Day |

Result: fluid intake against the daily goal and estimated sweat loss, in millilitres.

## Training

### get_training_readiness

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `date` | string | today | Day |

Result: Training Readiness (0-100) readings with their factors (sleep score, recovery time, HRV status, acute load, sleep and stress history) and Garmin's feedback. The first entry is the most recent reading of the day.

### get_training_status

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `date` | string | today | Day |

Result: status label, acute and chronic load and their ratio, load focus balance, VO2 max, heat and altitude acclimation (arrays capped at 40).

### get_fitness_metrics

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `date` | string | today | Day |

Result: `vo2max`, `fitnessAge`, `enduranceScore`, `hillScore`, `lactateThreshold`, `cyclingFtp`. Metrics the watch does not support are absent.

### get_race_predictions

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `start_date` | string | optional | First day of a history range. Omit for the current prediction only |
| `end_date` | string | today | Last day of the history range |

With no `start_date` the result is the current prediction (5K, 10K, half marathon, marathon, in seconds). With `start_date` it is `range` and `predictions`, one per day (maximum range 366 days, arrays capped at 120). `end_date` is used only when `start_date` is given.

### get_training_zones

No parameters. Result: `heartRateZones` (per sport, with max and resting heart rate and lactate threshold heart rate) and `powerZones`.

### get_personal_records

No parameters. Result: the personal records list. `typeId` identifies each record; times are seconds, distances metres (arrays capped at 100).

### get_training_load

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `start_date` | string | 42 days ending at `end_date` | First day |
| `end_date` | string | today | Last day |

Maximum range: 366 days. At most 400 activities are fetched. Result: `range`, `activityCount`, `totalLoad` and `activities` with `date`, `type`, `durationSec`, `distanceM`, `load`, `aerobicTE`, `anaerobicTE`, `label`.

## Planning

### get_calendar

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `start_date` | string | today | First day |
| `end_date` | string | `start_date` + 13 days | Last day, inclusive |

Maximum range: 180 days. Result: `range`, `scheduledWorkouts` (including Garmin Coach and adaptive plan sessions), `events` (races and other calendar events) and `activeTrainingPlans`. The `workoutScheduleId` in scheduled entries is what `unschedule_workout` needs.

### list_workouts

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `limit` | integer 1-100 | 30 | Maximum workouts |
| `offset` | integer >= 0 | 0 | Workouts to skip |

Result: array of `workoutId`, `workoutName`, `description`, `estimatedDurationInSecs`, `estimatedDistanceInMeters`, `updateDate`, `sport`, most recently updated first.

### get_workout

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `workout_id` | integer > 0 | required | Id from `list_workouts` or `create_workout` |

Result: the full step structure: warm-up, intervals, repeats, recoveries, targets and durations.

### Write tools

The next four tools are registered only when the server runs with `GARMIN_ENABLE_WRITE=true` (also accepted: `1`, `yes`, `on`). Without it they do not appear in the tool list. They change the user's Garmin account, so confirm with the user before calling them.

#### create_workout (requires `GARMIN_ENABLE_WRITE=true`)

Creates a structured workout in the library and optionally schedules it.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `workout` | object | required | Workout description, see the schema below |
| `schedule_date` | string (YYYY-MM-DD) | optional | If given, also puts the workout on the calendar for this date |

Result: `workoutId`, `workoutName`, and when scheduled, `scheduledFor` and `scheduleId`. It fails if Garmin does not return a workout id.

#### schedule_workout (requires `GARMIN_ENABLE_WRITE=true`)

Puts an existing saved workout on the calendar.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `workout_id` | integer > 0 | required | Workout id |
| `date` | string (YYYY-MM-DD) | required | Date to schedule it on |

Result: `workoutId`, `scheduledFor`, `scheduleId`.

#### unschedule_workout (requires `GARMIN_ENABLE_WRITE=true`, destructive)

Removes one scheduled occurrence from the calendar. The workout stays in the library.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `schedule_id` | integer > 0 | required | `workoutScheduleId` of the calendar entry, from `get_calendar` (not the workout id) |

Result: `unscheduled` (the schedule id).

#### delete_workout (requires `GARMIN_ENABLE_WRITE=true`, destructive)

Permanently deletes a saved workout and its calendar entries. It cannot be undone.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `workout_id` | integer > 0 | required | Workout id |

Result: `deleted` (the workout id).

### Workout schema for create_workout

The `workout` object:

| Field | Type | Meaning |
|---|---|---|
| `name` | string, 1-100 chars | Workout name |
| `sport` | `running`, `cycling`, `swimming`, `strength`, `cardio`, `walking`, `hiking` | Sport |
| `description` | string, up to 1000 chars, optional | Description |
| `steps` | array, 1-50 items | Steps in order: simple steps and `repeat` steps |

Simple step:

| Field | Type | Meaning |
|---|---|---|
| `type` | `warmup`, `interval`, `recovery`, `rest`, `cooldown` | Step kind |
| `duration` | object | `{"type":"time","seconds":n}` (1-86400), `{"type":"distance","meters":n}` (1-500000) or `{"type":"lap_button"}` |
| `target` | object, optional | Intensity target; omit for none |
| `note` | string, up to 500 chars, optional | Text shown on the watch |

Repeat step: `{"type":"repeat","iterations":n,"steps":[...]}` with `iterations` 1-99 and 1-20 simple steps. Repeats cannot be nested.

Targets, selected by `type`:

| `type` | Fields |
|---|---|
| `none` | none |
| `heart_rate_zone` | `zone` (integer 1-5) |
| `heart_rate` | `min_bpm`, `max_bpm` (integers 30-240) |
| `pace` | `fastest_per_km`, `slowest_per_km` (`m:ss` per km, for example `4:45`) |
| `power_zone` | `zone` (integer 1-7) |
| `power` | `min_watts`, `max_watts` (integers 1-2500) |
| `cadence` | `min`, `max` (integers 1-300) |

Minimum must not exceed maximum, and `fastest_per_km` must not be slower than `slowest_per_km`, or the call fails before anything is sent.

Example: 15 minute warm-up, 5 repeats of 1 km at 4:35 to 4:45 per km with 2 minute recoveries, 10 minute cool-down, scheduled for a date:

```json
{
  "workout": {
    "name": "5 x 1 km at threshold",
    "sport": "running",
    "description": "Threshold intervals with easy jog recoveries",
    "steps": [
      {
        "type": "warmup",
        "duration": { "type": "time", "seconds": 900 },
        "target": { "type": "heart_rate_zone", "zone": 2 }
      },
      {
        "type": "repeat",
        "iterations": 5,
        "steps": [
          {
            "type": "interval",
            "duration": { "type": "distance", "meters": 1000 },
            "target": { "type": "pace", "fastest_per_km": "4:35", "slowest_per_km": "4:45" },
            "note": "Controlled, even pace"
          },
          {
            "type": "recovery",
            "duration": { "type": "time", "seconds": 120 }
          }
        ]
      },
      {
        "type": "cooldown",
        "duration": { "type": "time", "seconds": 600 }
      }
    ]
  },
  "schedule_date": "2026-06-20"
}
```

## Profile

### garmin_status

No parameters. Checks the connection. Result: `today`, `timezone`, `writeToolsEnabled`, `tokens` (`stored`, `storage`, `accessTokenExpiresAt`, `hasRefreshToken`; never token values), `connected`, and either `account` (`displayName`, `fullName`, `location`) or `problem` with instructions. Call it first when other tools report authentication errors.

### get_profile

No parameters. Result: `profile` (social profile) and `settings` (user settings): name, height, weight, sex, measurement system, sleep schedule, lactate threshold and VO2 max settings, primary activity types. Some internal ids are removed.

### get_devices

No parameters. Result: `devices`, `lastUsed` and `primaryTrainingDevice` (model, software version, last sync). Serial numbers and image URLs are removed.

### get_gear

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `include_stats` | boolean | true | Also load total distance and activity count per item (one extra request each) |

Result: up to 50 gear items (shoes, bikes and so on), with `stats` when requested and available.

### garmin_api_get

Read-only GET against any Garmin Connect path when no dedicated tool covers it.

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `path` | string, 2-300 chars | required | Path starting with `/`, no query string, for example `/wellness-service/wellness/dailyStress/2026-01-31`. `{displayName}` is replaced with the URL-encoded display name |
| `params` | object of string, number or boolean | optional | Query parameters |
| `max_array` | integer 5-500 | 60 | Arrays longer than this are downsampled |

Paths that could leave the API path are rejected without a request (`//`, `..`, `?`, `#`, backslash, whitespace, `://`). Result: Garmin's JSON, compacted.

## Prompts

Prompts are templates a client can offer to the user. They send a user message that tells the model which tools to call.

| Name | Arguments | What it asks for |
|---|---|---|
| `daily_checkin` | none | Calls `get_daily_briefing` for today, explains recovery citing numbers (sleep, HRV against baseline, readiness, Body Battery, load), and recommends going ahead, adjusting or resting |
| `weekly_review` | none | Calls `get_weekly_review`, `get_training_status` and `get_calendar`, summarises the last 7 days, flags fatigue or undertraining and suggests the next week |
| `race_readiness` | `race` (string, required, for example "Lisbon Half Marathon on 2027-03-14"), `goal` (string, optional) | Uses `get_race_predictions` (90-day range), `get_fitness_metrics`, `get_training_load` (last 8 weeks), `get_personal_records` and `get_training_zones`, then judges whether the goal is realistic and proposes pacing |

## Garmin units

Garmin's API uses these units, and the tools pass them through unchanged:

- distance: metres
- duration and time: seconds
- speed: metres per second (a pace of 5:00 per km is 3.33 m/s)
- weight: grams
- HRV: milliseconds
- hydration: millilitres

Convert to the user's preferred units when presenting. The workout builder is the one exception on input: pace targets are written as `m:ss` per km and converted to metres per second internally.
