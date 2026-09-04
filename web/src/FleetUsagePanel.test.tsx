/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock only the network entry point; the pure normalizer/helpers stay real.
vi.mock("./fleetUsage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fleetUsage")>();
  return { ...actual, fetchFleetUsage: vi.fn() };
});

import { FleetUsagePanel, useFleetUsage } from "./FleetUsagePanel";
import { fetchFleetUsage, normalizeFleetUsage, type FleetUsage } from "./fleetUsage";

const mockFetch = vi.mocked(fetchFleetUsage);
const FIXED_NOW = new Date("2026-09-04T17:00:00Z");
// Mirrors the poll cadence in FleetUsagePanel.tsx (kept in sync deliberately).
const FLEET_USAGE_REFRESH_MS = 60_000;

// Live-shaped fixture with placeholder emails (never a real address).
function rawFixture() {
  return {
    version: 1,
    generatedAt: "2026-09-04T16:28:40Z",
    pools: {
      work: {
        activeAccountNumber: 3,
        accounts: [
          {
            number: 1,
            email: "work1@example.test",
            alias: "alex",
            active: false,
            usage: {
              fiveHour: { pct: 0 },
              sevenDay: {
                pct: 80,
                countdown: "4d 19h",
                aheadOfPace: true,
                projectedExhaustionAt: "2026-09-05T05:25:24Z",
              },
              spend: { used: 116.74, limit: 150, pct: 77.82, currency: "USD" },
              scoped: [{ pct: 50, countdown: "4d 19h", name: "Fable" }],
            },
          },
          {
            number: 3,
            email: "work3@example.test",
            alias: "claude1",
            active: true,
            usage: {
              fiveHour: { pct: 61, countdown: "4h 11m" },
              sevenDay: { pct: 45, countdown: "17h 31m" },
            },
          },
        ],
      },
      personal: {
        activeAccountNumber: 2,
        accounts: [
          {
            number: 2,
            email: "personal2@example.test",
            alias: "personal",
            active: true,
            usage: { fiveHour: { pct: 80, countdown: "1m" }, sevenDay: { pct: 37 } },
          },
        ],
      },
    },
  };
}

function fixtureModel(): FleetUsage {
  const usage = normalizeFleetUsage(rawFixture());
  if (!usage) {
    throw new Error("fixture failed to normalize");
  }
  return usage;
}

// Drives the real hook so its fetch/poll/teardown lifecycle is exercised end to end.
function HookHarness() {
  const { usage, stale, refresh } = useFleetUsage();
  return <FleetUsagePanel usage={usage} stale={stale} onRefresh={refresh} now={FIXED_NOW} />;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const roots: Root[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockFetch.mockReset();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(node);
  });
  return { container, root };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe("FleetUsagePanel", () => {
  it("renders both pools and marks the active account without printing emails", async () => {
    const { container } = await render(
      <FleetUsagePanel usage={fixtureModel()} stale={false} onRefresh={vi.fn()} now={FIXED_NOW} />,
    );

    const labels = Array.from(container.querySelectorAll(".sec-label")).map(
      (node) => node.textContent,
    );
    expect(labels).toContain("WORK");
    expect(labels).toContain("PERSONAL");

    const activeRows = container.querySelectorAll<HTMLElement>('.fleet-account[data-active="true"]');
    expect(activeRows).toHaveLength(2);
    const workActive = Array.from(activeRows).find((row) =>
      row.textContent?.includes("claude1"),
    );
    if (!workActive) {
      throw new Error("missing active work account row");
    }
    expect(workActive.querySelector(".fleet-account-badge")?.textContent).toBe("active");

    // Percentages render; the account's email is on title only, never as text.
    expect(container.textContent).toContain("61%");
    expect(container.textContent).toContain("45%");
    expect(workActive.getAttribute("title")).toBe("work3@example.test");
    expect(container.textContent).not.toContain("@example.test");

    // Scoped sub-bar and pace note from the first work account.
    expect(container.textContent).toContain("Fable");
    expect(container.textContent).toContain("ahead of pace");
  });

  it("renders nothing when usage is null", async () => {
    const { container } = await render(
      <FleetUsagePanel usage={null} stale={false} onRefresh={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("keeps last good data and shows a stale marker after a failed refresh", async () => {
    mockFetch.mockResolvedValueOnce(fixtureModel()).mockResolvedValueOnce(null);

    function Harness() {
      const { usage, stale, refresh } = useFleetUsage();
      return (
        <div>
          <button type="button" aria-label="manual-refresh" onClick={refresh}>
            refresh
          </button>
          <FleetUsagePanel usage={usage} stale={stale} onRefresh={refresh} now={FIXED_NOW} />
        </div>
      );
    }

    const { container } = await render(<Harness />);
    await flush();

    expect(container.textContent).toContain("claude1");
    expect(container.querySelector(".fleet-stale")).toBeNull();

    const refreshButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="manual-refresh"]',
    );
    if (!refreshButton) {
      throw new Error("missing manual refresh button");
    }
    await act(async () => {
      refreshButton.click();
    });
    await flush();

    // Data survives the failed refresh; the stale marker is shown.
    expect(container.textContent).toContain("claude1");
    expect(container.querySelector(".fleet-stale")).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("coalesces focus and visibilitychange firing together into one fetch", async () => {
    // Force a visible page so both handlers attempt a refresh.
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    mockFetch.mockResolvedValue(fixtureModel());

    const { container } = await render(<HookHarness />);
    await flush();
    expect(container.textContent).toContain("claude1");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    // Without the in-flight guard this pair would issue two concurrent fetches.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("stops fetching and does not set state after unmount", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = deferred<FleetUsage | null>();
    mockFetch.mockReturnValueOnce(pending.promise);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<HookHarness />);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });

    // Interval and listeners are torn down: time and focus produce no fetch.
    await act(async () => {
      vi.advanceTimersByTime(FLEET_USAGE_REFRESH_MS * 3);
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // The mount fetch resolving after unmount must not set state or warn.
    await act(async () => {
      pending.resolve(fixtureModel());
      await Promise.resolve();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  it("backs off the periodic poll while no usage has loaded", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(null); // no generator / 404

    const { container } = await render(<HookHarness />);
    await act(async () => {
      await Promise.resolve();
    });
    // Mount fetch only; usage stays null so the panel renders nothing.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("");

    // Four 60 s ticks are skipped while nothing usable has loaded.
    await act(async () => {
      vi.advanceTimersByTime(FLEET_USAGE_REFRESH_MS * 4);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // The fifth tick (~5 min) polls once more.
    await act(async () => {
      vi.advanceTimersByTime(FLEET_USAGE_REFRESH_MS);
      await Promise.resolve();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
