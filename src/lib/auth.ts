/** Shared-secret authentication for the MCP and admin endpoints. */

import { createHash, timingSafeEqual } from "node:crypto";
import { ConfigError, getAuthToken } from "./config";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time comparison of a presented secret against MCP_AUTH_TOKEN. */
export function isValidSecret(presented: string | null | undefined): boolean {
  if (!presented) return false;
  return timingSafeEqual(digest(presented), digest(getAuthToken()));
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  return match?.[1]?.trim() ?? null;
}

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/**
 * Returns null when the request is authorised, or the response to send back.
 * `pathKey` is the secret taken from the URL, for clients that cannot send headers.
 */
export function authorize(request: Request, pathKey?: string): Response | null {
  try {
    if (isValidSecret(pathKey) || isValidSecret(bearerToken(request))) return null;
  } catch (error) {
    if (error instanceof ConfigError) return json(503, { error: error.message });
    throw error;
  }
  return json(401, { error: "Unauthorized" }, { "WWW-Authenticate": "Bearer" });
}

export { json as jsonResponse };
