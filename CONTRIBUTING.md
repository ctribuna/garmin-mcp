# Contributing

Thanks for considering a contribution. This project is a small, self-hosted MCP
server for Garmin Connect. It talks to Garmin's private, unofficial API, so
changes need care and real-world checking.

## Setup

You need Node.js 20 or newer and npm.

```bash
npm install
cp .env.example .env.local   # fill in the values you need
npm run dev                  # starts the Next.js dev server
```

The server needs an Upstash Redis instance for storing encrypted Garmin
session tokens. See `.env.example` for the variables.

## Checks

Run these before opening a pull request:

```bash
npm test          # vitest test suite
npm run typecheck # tsc --noEmit
npm run build     # production build
```

## Source layout

- `src/garmin/`: Garmin Connect API client (`api.ts`), token storage and
  encryption, and the workout builder.
- `src/mcp/`: the MCP server (`server.ts`), the `defineTool` helper
  (`tool.ts`), and the tools in `src/mcp/tools/`.
- `src/lib/`: shared helpers, including configuration and `compact()`.
- `app/`: Next.js routes, including the MCP endpoint and token upload.
- `scripts/garmin_login.py`: a helper that logs in to Garmin and produces a
  token file for upload.
- `tests/`: vitest tests. `tests/helpers.ts` contains a fake Garmin API.

## Adding a tool

1. Pick the matching file in `src/mcp/tools/` (for example `activities.ts`
   for activity data, `health.ts` for health metrics). Create a new file only
   if no existing one fits.
2. Define the tool with `defineTool`. Give it a clear name, a description the
   model can act on, and a zod input schema.
3. If the tool needs a new Garmin endpoint, add a method for it in
   `src/garmin/api.ts`. Use the paths that the
   [python-garminconnect](https://github.com/cyberjunky/python-garminconnect)
   library uses, since it is the best reference for the private API.
4. Add a test in `tests/tools.test.ts` that uses the fake Garmin API helper
   from `tests/helpers.ts`. Do not call the real Garmin API from tests.
5. Write tools must set `write: true`. This keeps them behind
   `GARMIN_ENABLE_WRITE`, so they are not registered unless the operator
   turns writes on.

## Conventions

- TypeScript in strict mode. Avoid `any`; prefer narrow types.
- Tools return compact data through `compact()`. Do not return raw Garmin
  payloads, which are large and may contain fields that are not needed.
- Never log or return token values, session cookies, or the
  `MCP_AUTH_TOKEN`. Error messages must not echo them either.
- Never commit `garmin_tokens.json` or any real health data. Test fixtures
  must be synthetic. Do not paste real health data into issues or pull
  requests.

## Pull requests

- Keep pull requests small and focused on one change.
- Make sure `npm test`, `npm run typecheck` and `npm run build` pass.
- Describe what changed and why. If the change touches a Garmin endpoint and
  you checked it against a real account, say so and describe the result
  without including any personal data.
- Use the pull request template. Maintainers may ask for changes before
  merging.

By contributing, you agree that your contributions are licensed under the
MIT License in this repository.
