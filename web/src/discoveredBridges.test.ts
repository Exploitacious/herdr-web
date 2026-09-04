import { afterEach, describe, expect, it, vi } from "vitest";
import { duplicateBackend, writeBackendStore } from "./bridge";
import type { BridgeBackendProfile, BridgeBackendStore } from "./bridge";
import {
  DISCOVERED_ID_PREFIX,
  fetchDiscoveredBridges,
  mergeDiscoveredBridges,
  parseDiscoveredBridges,
} from "./discoveredBridges";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const HUB = "https://hub.example:8787";
const A = "https://host.example:8801";
const B = "https://host.example:8802";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function store(overrides: Partial<BridgeBackendStore> = {}): BridgeBackendStore {
  return {
    version: 2,
    enabledBridgeIds: [],
    lastSelectedBridgeId: null,
    backends: [],
    ...overrides,
  };
}

describe("fetchDiscoveredBridges", () => {
  it("reads and validates a well-formed bridges.json", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        version: 1,
        generatedAt: "2026-09-04T16:26:36Z",
        host: "host.example",
        hub: { baseUrl: HUB, label: "console" },
        bridges: [
          { id: "session:bootloop", name: "bootloop", baseUrl: A, profile: "work", color: "#89B4FA" },
          { id: "session:finrep", name: "finrep", baseUrl: B, profile: "personal" },
        ],
      }),
    );

    await expect(fetchDiscoveredBridges()).resolves.toEqual([
      { id: "session:bootloop", name: "bootloop", baseUrl: A, color: "#89b4fa", profile: "work", workdir: undefined },
      { id: "session:finrep", name: "finrep", baseUrl: B, color: undefined, profile: "personal", workdir: undefined },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/bridges.json",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });

  it("returns an empty list on a 404 (no generator deployed)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    await expect(fetchDiscoveredBridges()).resolves.toEqual([]);
  });

  it("returns an empty list on a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(fetchDiscoveredBridges()).resolves.toEqual([]);
  });

  it("returns an empty list on non-JSON bodies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<<<not json>>>", { status: 200 }));
    await expect(fetchDiscoveredBridges()).resolves.toEqual([]);
  });

  it("returns an empty list on the wrong contract version", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ version: 2, bridges: [{ id: "x", name: "x", baseUrl: A }] }),
    );
    await expect(fetchDiscoveredBridges()).resolves.toEqual([]);
  });
});

describe("parseDiscoveredBridges entry validation", () => {
  it("drops malformed entries and normalizes color and profile", () => {
    expect(
      parseDiscoveredBridges({
        version: 1,
        bridges: [
          { id: "session:ok", name: "ok", baseUrl: A, profile: "other", color: " #A1B2C3 " },
          { id: "session:bad-url", name: "bad", baseUrl: "http://host.example:8801/api" },
          { name: "no-id", baseUrl: B },
          { id: "session:no-name", name: "   ", baseUrl: B },
          { id: "session:bad-profile", name: "bp", baseUrl: B, profile: "admin", color: "not-hex" },
          "not-an-object",
        ],
      }),
    ).toEqual([
      { id: "session:ok", name: "ok", baseUrl: A, color: "#a1b2c3", profile: "other", workdir: undefined },
      { id: "session:bad-profile", name: "bp", baseUrl: B, color: undefined, profile: undefined, workdir: undefined },
    ]);
  });

  it("returns an empty list when bridges is not an array", () => {
    expect(parseDiscoveredBridges({ version: 1, bridges: {} })).toEqual([]);
    expect(parseDiscoveredBridges(null)).toEqual([]);
  });
});

describe("mergeDiscoveredBridges", () => {
  it("adds discovered bridges enabled by default and skips the hub", () => {
    const merged = mergeDiscoveredBridges(store({ enabledBridgeIds: ["same-origin"], lastSelectedBridgeId: "same-origin" }), [
      { id: "session:a", name: "a", baseUrl: A, profile: "work" },
    ]);

    expect(merged.backends).toEqual([
      {
        id: `${DISCOVERED_ID_PREFIX}session:a`,
        name: "a",
        baseUrl: A,
        color: "#89b4fa",
        discovered: true,
        profile: "work",
        lastConnectedAt: undefined,
      },
    ]);
    // Same-origin entry is preserved; the new discovered id is enabled by default.
    expect(merged.enabledBridgeIds).toEqual(["same-origin", `${DISCOVERED_ID_PREFIX}session:a`]);
  });

  it("uses the profile fallback color when the file omits one", () => {
    const merged = mergeDiscoveredBridges(store(), [{ id: "session:p", name: "p", baseUrl: A, profile: "personal" }]);
    expect(merged.backends[0]?.color).toBe("#cba6f7");
  });

  it("skips a discovered bridge whose URL matches a user-saved backend", () => {
    const userBackend: BridgeBackendProfile = { id: "u1", name: "Mine", baseUrl: A };
    const merged = mergeDiscoveredBridges(
      store({ backends: [userBackend], enabledBridgeIds: ["u1"], lastSelectedBridgeId: "u1" }),
      [{ id: "session:a", name: "a", baseUrl: A, profile: "work" }],
    );

    expect(merged.backends).toEqual([userBackend]);
    expect(merged.enabledBridgeIds).toEqual(["u1"]);
  });

  it("removes previously merged discovered entries no longer in the file", () => {
    const stale: BridgeBackendProfile = {
      id: `${DISCOVERED_ID_PREFIX}session:gone`,
      name: "gone",
      baseUrl: A,
      color: "#89b4fa",
      discovered: true,
      profile: "work",
    };
    const merged = mergeDiscoveredBridges(
      store({ backends: [stale], enabledBridgeIds: [stale.id], lastSelectedBridgeId: stale.id }),
      [],
    );

    expect(merged.backends).toEqual([]);
    expect(merged.enabledBridgeIds).toEqual([]);
    expect(merged.lastSelectedBridgeId).toBeNull();
  });

  it("keeps a session's disable of an existing entry while enabling new ones", () => {
    const disabled: BridgeBackendProfile = {
      id: `${DISCOVERED_ID_PREFIX}session:a`,
      name: "a",
      baseUrl: A,
      color: "#89b4fa",
      discovered: true,
      profile: "work",
    };
    const merged = mergeDiscoveredBridges(
      // "a" is present in backends but absent from enabledBridgeIds: the session disabled it.
      store({ backends: [disabled], enabledBridgeIds: [], lastSelectedBridgeId: null }),
      [
        { id: "session:a", name: "a", baseUrl: A, profile: "work" },
        { id: "session:b", name: "b", baseUrl: B, profile: "personal" },
      ],
    );

    // "a" stays disabled; only the newly discovered "b" is enabled by default.
    expect(merged.enabledBridgeIds).toEqual([`${DISCOVERED_ID_PREFIX}session:b`]);
    expect(merged.backends.map((backend) => backend.id)).toEqual([
      `${DISCOVERED_ID_PREFIX}session:a`,
      `${DISCOVERED_ID_PREFIX}session:b`,
    ]);
  });

  it("returns the same store reference when nothing changed", () => {
    const current = mergeDiscoveredBridges(store(), [{ id: "session:a", name: "a", baseUrl: A, profile: "work" }]);
    const again = mergeDiscoveredBridges(current, [{ id: "session:a", name: "a", baseUrl: A, profile: "work" }]);
    expect(again).toBe(current);
  });
});

describe("persistence stripping", () => {
  it("never writes discovered entries or discovered ids to storage", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem, removeItem: vi.fn() });

    const dirty = store({
      backends: [
        { id: "u1", name: "Mine", baseUrl: B },
        {
          id: `${DISCOVERED_ID_PREFIX}session:a`,
          name: "a",
          baseUrl: A,
          color: "#89b4fa",
          discovered: true,
          profile: "work",
        },
      ],
      enabledBridgeIds: ["u1", `${DISCOVERED_ID_PREFIX}session:a`],
      lastSelectedBridgeId: `${DISCOVERED_ID_PREFIX}session:a`,
    });

    await writeBackendStore(dirty);

    expect(setItem).toHaveBeenCalledTimes(1);
    const [, written] = setItem.mock.calls[0] as [string, string];
    const persisted = JSON.parse(written) as BridgeBackendStore;
    expect(persisted.backends).toEqual([{ id: "u1", name: "Mine", baseUrl: B }]);
    expect(persisted.enabledBridgeIds).toEqual(["u1"]);
    // The discovered id must not survive as the last selection.
    expect(persisted.lastSelectedBridgeId).toBe("u1");
  });
});

describe("duplicateBackend", () => {
  it("ignores discovered backends so a user may save the same URL", () => {
    const backends: BridgeBackendProfile[] = [
      { id: `${DISCOVERED_ID_PREFIX}session:a`, name: "a", baseUrl: A, discovered: true, profile: "work" },
    ];
    expect(duplicateBackend(backends, A)).toBeNull();
  });
});
