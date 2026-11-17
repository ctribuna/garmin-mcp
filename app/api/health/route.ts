/** Public liveness check. Reports configuration state, never secrets or data. */

import { getRedisConfig, isAuthConfigured, isWriteEnabled } from "@/lib/config";
import { jsonResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return jsonResponse(200, {
    ok: true,
    authConfigured: isAuthConfigured(),
    storage: getRedisConfig() ? "redis" : "memory",
    writeToolsEnabled: isWriteEnabled(),
  });
}
