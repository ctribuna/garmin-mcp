/**
 * Upload Garmin tokens produced by scripts/garmin_login.py.
 *
 *   POST /api/admin/tokens   Authorization: Bearer <MCP_AUTH_TOKEN>
 *   body: the contents of garmin_tokens.json
 *
 * The tokens are verified against Garmin before they are stored, so a bad
 * upload never replaces a working session.
 */

import { GarminClient, GarminError } from "@/garmin/client";
import { getGarminClient } from "@/garmin/client";
import { getTokenStore, MemoryTokenStore, parseTokens, TokenFormatError } from "@/garmin/tokens";
import { authorize, jsonResponse } from "@/lib/auth";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  // Header only: the upload endpoint never accepts the secret in the URL.
  const denied = authorize(request);
  if (denied) return denied;

  let tokens;
  try {
    tokens = parseTokens(await request.text());
  } catch (error) {
    const message = error instanceof TokenFormatError ? error.message : "Could not read the request body.";
    return jsonResponse(400, { error: message });
  }

  // Try the tokens in isolation first; refreshed tokens stay in this probe.
  const probeStore = new MemoryTokenStore(tokens);
  const probe = new GarminClient(probeStore);
  let account: unknown;
  try {
    const profile = await probe.get<Record<string, unknown>>("/userprofile-service/socialProfile");
    account = profile?.displayName ?? null;
  } catch (error) {
    const message = error instanceof GarminError ? error.message : "Unexpected error contacting Garmin.";
    return jsonResponse(422, { error: `Garmin did not accept these tokens: ${message}` });
  }

  const verified = (await probeStore.get()) ?? tokens;
  const store = getTokenStore();
  await getGarminClient().setTokens(verified);

  return jsonResponse(200, {
    ok: true,
    account,
    storage: store.kind,
    ...(store.kind === "memory"
      ? {
          warning:
            "No Redis database is configured, so these tokens are held in memory only and will be lost when the server restarts. Connect Upstash Redis to the Vercel project.",
        }
      : {}),
  });
}
