import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeAccount,
  computeCountdown,
  fetchFleetUsage,
  formatCountdown,
  normalizeFleetUsage,
  poolSummary,
  usageLevel,
} from "./fleetUsage";

// A structurally faithful copy of the live /usage.json with emails replaced by
// placeholder addresses (never a real address in a fixture).
function validPayload() {
  return {
    version: 1,
    generatedAt: "2026-09-04T16:28:40Z",
    pools: {
      work: {
        schemaVersion: 1,
        activeAccountNumber: 3,
        accounts: [
          {
            number: 1,
            email: "work1@example.test",
            alias: "alex",
            active: false,
            usageStatus: "ok",
            usage: {
              fiveHour: { pct: 0 },
              sevenDay: {
                pct: 80,
                resetsAt: "2026-09-09T11:59:59.602986+00:00",
                countdown: "4d 19h",
                clock: "Sep 9 07:59",
                expectedPct: 31.2,
                aheadOfPace: true,
                projectedExhaustionAt: "2026-09-05T05:25:24Z",
                willLastToReset: false,
              },
              spend: { used: 116.74, limit: 150, pct: 77.82, currency: "USD" },
              scoped: [{ pct: 50, countdown: "4d 19h", name: "Fable" }],
            },
            usageAgeSeconds: 500.7,
          },
          {
            number: 3,
            email: "work3@example.test",
            alias: "claude1",
            active: true,
            usageStatus: "ok",
            usage: {
              fiveHour: { pct: 61, countdown: "4h 11m" },
              sevenDay: { pct: 45, countdown: "17h 31m" },
            },
          },
        ],
      },
      personal: {
        schemaVersion: 1,
        activeAccountNumber: 2,
        accounts: [
          {
            number: 2,
            email: "personal2@example.test",
            active: true,
            usage: { fiveHour: { pct: 80 }, sevenDay: { pct: 37 } },
          },
        ],
      },
    },
  };
}

function stubFetch(fetchImpl: (...args: unknown[]) => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeFleetUsage", () => {
  it("parses a well-formed payload into the typed model", () => {
    const usage = normalizeFleetUsage(validPayload());
    expect(usage).not.toBeNull();
    expect(usage?.version).toBe(1);
    expect(usage?.pools.work?.accounts).toHaveLength(2);
    expect(usage?.pools.personal?.accounts).toHaveLength(1);

    const active = activeAccount(usage!.pools.work);
    expect(active?.number).toBe(3);
    expect(active?.alias).toBe("claude1");
    expect(active?.usage.fiveHour.pct).toBe(61);

    const first = usage!.pools.work!.accounts[0];
    expect(first.usage.sevenDay.countdown).toBe("4d 19h");
    expect(first.usage.sevenDay.aheadOfPace).toBe(true);
    expect(first.usage.sevenDay.projectedExhaustionAtDate).toBeInstanceOf(Date);
    expect(first.usage.spend?.used).toBe(116.74);
    expect(first.usage.scoped).toHaveLength(1);
    expect(first.usage.scoped[0].name).toBe("Fable");
  });

  it("falls back to a number label when alias is absent (never the email)", () => {
    const usage = normalizeFleetUsage(validPayload());
    expect(usage?.pools.personal?.accounts[0].alias).toBe("#2");
    expect(usage?.pools.personal?.accounts[0].email).toBe("personal2@example.test");
  });

  it("keeps the surviving pool when the other is null", () => {
    const payload = validPayload();
    payload.pools.personal = null as never;
    const usage = normalizeFleetUsage(payload);
    expect(usage?.pools.personal).toBeNull();
    expect(usage?.pools.work?.accounts).toHaveLength(2);
  });

  it("returns null when no pool has a usable account", () => {
    const payload = validPayload();
    payload.pools.work = null as never;
    payload.pools.personal = { schemaVersion: 1, activeAccountNumber: 1, accounts: [] } as never;
    expect(normalizeFleetUsage(payload)).toBeNull();
  });

  it("returns null on a wrong version", () => {
    const payload = validPayload();
    payload.version = 2;
    expect(normalizeFleetUsage(payload)).toBeNull();
  });

  it("drops malformed accounts and clamps percentages to 0..100", () => {
    const payload = {
      version: 1,
      generatedAt: "2026-09-04T16:28:40Z",
      pools: {
        work: {
          accounts: [
            { number: "nope", usage: { fiveHour: { pct: 10 }, sevenDay: { pct: 10 } } },
            { number: 5, usage: { fiveHour: { pct: 10 } } },
            {
              number: 6,
              alias: "over",
              usage: { fiveHour: { pct: 150 }, sevenDay: { pct: -20 } },
            },
          ],
        },
        personal: null,
      },
    };
    const usage = normalizeFleetUsage(payload);
    expect(usage?.pools.work?.accounts).toHaveLength(1);
    const survivor = usage!.pools.work!.accounts[0];
    expect(survivor.number).toBe(6);
    expect(survivor.usage.fiveHour.pct).toBe(100);
    expect(survivor.usage.sevenDay.pct).toBe(0);
  });
});

describe("fetchFleetUsage", () => {
  it("returns the model on a 200 with valid JSON", async () => {
    stubFetch(async () => ({ ok: true, json: async () => validPayload() }));
    const usage = await fetchFleetUsage();
    expect(usage?.pools.work?.accounts).toHaveLength(2);
  });

  it("returns null on a 404", async () => {
    stubFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    expect(await fetchFleetUsage()).toBeNull();
  });

  it("returns null on a network error", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });
    expect(await fetchFleetUsage()).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("not json");
      },
    }));
    expect(await fetchFleetUsage()).toBeNull();
  });

  it("returns null on a wrong version payload", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ version: 99, pools: {} }) }));
    expect(await fetchFleetUsage()).toBeNull();
  });
});

describe("usageLevel", () => {
  it("applies the ok/warn/hot thresholds", () => {
    expect(usageLevel(0)).toBe("ok");
    expect(usageLevel(74.99)).toBe("ok");
    expect(usageLevel(75)).toBe("warn");
    expect(usageLevel(89.99)).toBe("warn");
    expect(usageLevel(90)).toBe("hot");
    expect(usageLevel(100)).toBe("hot");
  });
});

describe("poolSummary", () => {
  it("summarizes the active account's 5h/7d percentages", () => {
    const usage = normalizeFleetUsage(validPayload());
    expect(poolSummary(usage!.pools.work)).toEqual({
      alias: "claude1",
      fiveHourPct: 61,
      sevenDayPct: 45,
    });
    expect(poolSummary(null)).toBeNull();
  });
});

describe("countdown formatting", () => {
  const now = new Date("2026-09-04T17:00:00Z");

  it("computes days/hours/minutes from resetsAt against a fixed now", () => {
    const minute = 60_000;
    expect(computeCountdown(new Date(now.getTime() + (4 * 1440 + 19 * 60) * minute), now)).toBe(
      "4d 19h",
    );
    expect(computeCountdown(new Date(now.getTime() + (2 * 60 + 51) * minute), now)).toBe("2h 51m");
    expect(computeCountdown(new Date(now.getTime() + minute), now)).toBe("1m");
    expect(computeCountdown(new Date(now.getTime() - minute), now)).toBe("now");
    expect(computeCountdown(null, now)).toBeNull();
  });

  it("prefers the server countdown but falls back to the computed value", () => {
    expect(formatCountdown({ countdown: "4d 19h", resetsAtDate: null }, now)).toBe("4d 19h");
    expect(
      formatCountdown(
        { countdown: null, resetsAtDate: new Date(now.getTime() + 90 * 60_000) },
        now,
      ),
    ).toBe("1h 30m");
  });
});
