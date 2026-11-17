import type { GarminTokens } from "@/garmin/tokens";

/** Build an unsigned JWT-shaped token with the given claims. */
export function fakeJwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

export function tokensExpiringIn(seconds: number, label = "a"): GarminTokens {
  return {
    di_token: fakeJwt({ exp: Math.floor(Date.now() / 1000) + seconds, client_id: "CLIENT", jti: label }),
    di_refresh_token: `refresh-${label}`,
    di_client_id: "CLIENT",
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
