import { describe, expect, it, vi } from "vitest";
import { assertSafePath, GarminAuthError, GarminClient, GarminError } from "@/garmin/client";
import { MemoryTokenStore } from "@/garmin/tokens";
import { fakeJwt, jsonResponse, tokensExpiringIn } from "./helpers";

type Call = { url: string; init: RequestInit };

function harness(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request to ${url}`);
    if (next instanceof Error) throw next;
    return next;
  });
  return { calls, fetchImpl };
}

const auth = (call: Call) => (call.init.headers as Record<string, string>).Authorization;

describe("GarminClient", () => {
  it("sends the bearer token and serialises query parameters, including arrays", async () => {
    const tokens = tokensExpiringIn(3600);
    const { calls, fetchImpl } = harness([jsonResponse([{ id: 1 }])]);
    const client = new GarminClient(new MemoryTokenStore(tokens), fetchImpl);

    const data = await client.get("/userstats-service/wellness/daily/me", { metricId: [22, 23], skip: undefined });

    expect(data).toEqual([{ id: 1 }]);
    expect(calls[0]!.url).toBe("https://connectapi.garmin.com/userstats-service/wellness/daily/me?metricId=22&metricId=23");
    expect(auth(calls[0]!)).toBe(`Bearer ${tokens.di_token}`);
  });

  it("refreshes an expiring token before the request and persists the rotated tokens", async () => {
    const store = new MemoryTokenStore(tokensExpiringIn(60, "old"));
    const fresh = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, client_id: "CLIENT2" });
    const { calls, fetchImpl } = harness([
      jsonResponse({ access_token: fresh, refresh_token: "refresh-new" }),
      jsonResponse({ ok: true }),
    ]);
    const client = new GarminClient(store, fetchImpl);

    await client.get("/x");

    expect(calls[0]!.url).toContain("diauth.garmin.com");
    expect(String(calls[0]!.init.body)).toContain("refresh_token=refresh-old");
    expect(auth(calls[0]!)).toBe(`Basic ${Buffer.from("CLIENT:").toString("base64")}`);
    expect(auth(calls[1]!)).toBe(`Bearer ${fresh}`);
    expect(await store.get()).toEqual({ di_token: fresh, di_refresh_token: "refresh-new", di_client_id: "CLIENT2" });
  });

  it("refreshes once and retries when Garmin answers 401", async () => {
    const store = new MemoryTokenStore(tokensExpiringIn(3600, "old"));
    const fresh = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const { calls, fetchImpl } = harness([
      jsonResponse({}, 401),
      jsonResponse({ access_token: fresh }),
      jsonResponse({ ok: true }),
    ]);
    const client = new GarminClient(store, fetchImpl);

    expect(await client.get("/x")).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    // Garmin omitted a new refresh token, so the old one is kept.
    expect((await store.get())?.di_refresh_token).toBe("refresh-old");
  });

  it("reuses tokens another instance already rotated instead of refreshing again", async () => {
    const stale = tokensExpiringIn(60, "stale");
    const rotated = tokensExpiringIn(3600, "rotated");
    const store = new MemoryTokenStore(stale);
    const { calls, fetchImpl } = harness([jsonResponse({ ok: true })]);
    const client = new GarminClient(store, fetchImpl);
    await client.tokenStatus();
    // Simulate another serverless instance completing the refresh first.
    const realGet = store.get.bind(store);
    let first = true;
    store.get = async () => {
      if (first) {
        first = false;
        return realGet();
      }
      return rotated;
    };

    await client.get("/x");

    expect(calls).toHaveLength(1);
    expect(auth(calls[0]!)).toBe(`Bearer ${rotated.di_token}`);
  });

  it("asks for a new login when there are no tokens or the refresh token is dead", async () => {
    const none = new GarminClient(new MemoryTokenStore(null), harness([]).fetchImpl);
    await expect(none.get("/x")).rejects.toThrow(GarminAuthError);
    await expect(none.get("/x")).rejects.toThrow(/garmin_login\.py/);

    const { fetchImpl } = harness([jsonResponse({ error: "invalid_grant" }, 400)]);
    const dead = new GarminClient(new MemoryTokenStore(tokensExpiringIn(-5)), fetchImpl);
    await expect(dead.get("/x")).rejects.toThrow(GarminAuthError);
  });

  it("does not ask for a new login when a refresh is merely blocked or rate limited", async () => {
    const { fetchImpl } = harness([jsonResponse({}, 403)]);
    const client = new GarminClient(new MemoryTokenStore(tokensExpiringIn(-5)), fetchImpl);
    const error = await client.get("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarminError);
    expect(error).not.toBeInstanceOf(GarminAuthError);
  });

  it("maps missing data to null in getOptional but surfaces other failures", async () => {
    const { fetchImpl } = harness([jsonResponse({}, 404), new Response(null, { status: 204 }), jsonResponse({ message: "boom" }, 500)]);
    const client = new GarminClient(new MemoryTokenStore(tokensExpiringIn(3600)), fetchImpl);
    expect(await client.getOptional("/a")).toBeNull();
    expect(await client.getOptional("/b")).toBeNull();
    await expect(client.getOptional("/c")).rejects.toThrow(/500.*boom/);
  });

  it("caches the display name and URL-encodes it", async () => {
    const { calls, fetchImpl } = harness([jsonResponse({ displayName: "a b/c" })]);
    const client = new GarminClient(new MemoryTokenStore(tokensExpiringIn(3600)), fetchImpl);
    expect(await client.displayName()).toBe("a%20b%2Fc");
    expect(await client.displayName()).toBe("a%20b%2Fc");
    expect(calls).toHaveLength(1);
  });

  it("rejects paths that could escape the API host or path", () => {
    for (const bad of ["x", "//evil.com/a", "/a/../b", "/a/%2e%2e/b", "/a?b=1", "/a#b", "/https://evil.com", "/a b"]) {
      expect(() => assertSafePath(bad), bad).toThrow(GarminError);
    }
    expect(assertSafePath("/hrv-service/hrv/2026-01-31")).toBe("/hrv-service/hrv/2026-01-31");
  });
});
