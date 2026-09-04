import {
  defaultBridgeMode,
  normalizeBackendColor,
  normalizeBridgeBaseUrl,
  normalizeEnabledBridgeIds,
} from "./bridge";
import type { BridgeBackendProfile, BridgeBackendStore } from "./bridge";
import { fetchWithTimeout } from "./fetchWithTimeout";

// Bridges advertised by the hub in a same-origin `/bridges.json`. The hub
// regenerates the file as sessions start and stop, so devices pick up new
// bridges without editing Settings by hand. See web/README.md "Discovered
// bridges" for the on-disk contract.
export const DISCOVERED_BRIDGES_PATH = "/bridges.json";
export const DISCOVERED_BRIDGES_VERSION = 1;

// Discovered backends carry this id prefix so persistence can strip them and
// merge can tell a hub-advertised entry from a user-saved one.
export const DISCOVERED_ID_PREFIX = "discovered:";

export type DiscoveredBridgeProfile = "work" | "personal" | "other";

const DISCOVERED_PROFILES: readonly DiscoveredBridgeProfile[] = ["work", "personal", "other"];

// Fallback swatch when the file omits `color`. Keeps work/personal visually
// distinct even for a hub that does not colorize its output.
const PROFILE_COLORS: Record<DiscoveredBridgeProfile, string> = {
  work: "#89b4fa",
  personal: "#cba6f7",
  other: "#94e2d5",
};

export type DiscoveredBridge = {
  id: string;
  name: string;
  baseUrl: string;
  color?: string;
  profile?: DiscoveredBridgeProfile;
  workdir?: string;
};

// Reads the hub's bridge list. Never throws: a missing file (404), a network
// or timeout error, non-JSON, an unexpected `version`, or a malformed
// `bridges` array all resolve to an empty list so discovery stays silent on
// deployments without the generator.
export async function fetchDiscoveredBridges(): Promise<DiscoveredBridge[]> {
  let response: Response;
  try {
    response = await fetchWithTimeout(DISCOVERED_BRIDGES_PATH, { cache: "no-store" });
  } catch {
    return [];
  }
  if (!response.ok) {
    return [];
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return [];
  }
  return parseDiscoveredBridges(payload);
}

export function parseDiscoveredBridges(payload: unknown): DiscoveredBridge[] {
  if (
    !isRecord(payload) ||
    payload.version !== DISCOVERED_BRIDGES_VERSION ||
    !Array.isArray(payload.bridges)
  ) {
    return [];
  }
  const bridges: DiscoveredBridge[] = [];
  for (const raw of payload.bridges) {
    const bridge = parseDiscoveredBridge(raw);
    if (bridge) {
      bridges.push(bridge);
    }
  }
  return bridges;
}

function parseDiscoveredBridge(raw: unknown): DiscoveredBridge | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (
    typeof raw.id !== "string" ||
    !raw.id.trim() ||
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    typeof raw.baseUrl !== "string"
  ) {
    return null;
  }
  let baseUrl: string;
  try {
    baseUrl = normalizeBridgeBaseUrl(raw.baseUrl);
  } catch {
    // Reuse the same base-URL validation as user-entered bridges so a
    // malformed entry drops out instead of poisoning the list.
    return null;
  }
  return {
    id: raw.id,
    name: raw.name.trim(),
    baseUrl,
    color: normalizeBackendColor(raw.color) ?? undefined,
    profile: normalizeDiscoveredProfile(raw.profile),
    workdir: typeof raw.workdir === "string" ? raw.workdir : undefined,
  };
}

function normalizeDiscoveredProfile(value: unknown): DiscoveredBridgeProfile | undefined {
  return typeof value === "string" &&
    (DISCOVERED_PROFILES as readonly string[]).includes(value)
    ? (value as DiscoveredBridgeProfile)
    : undefined;
}

function discoveredBackendColor(bridge: DiscoveredBridge): string {
  return bridge.color ?? PROFILE_COLORS[bridge.profile ?? "other"];
}

// Folds the hub's current bridge list into the store. Merge rules:
// - each discovered bridge becomes a backend with the stable id
//   `discovered:<id>`, flagged `discovered: true`;
// - a user-saved backend with the same normalized baseUrl wins, so the
//   discovered entry is skipped (the user's edits take precedence);
// - previously merged discovered entries no longer in the file are dropped;
// - newly discovered entries are enabled by default, while a discovered
//   entry already present keeps whatever enable/disable choice the current
//   session made for it;
// - user backends and the same-origin entry are left untouched.
// Returns the same store reference when nothing changed so the 30 s refresh
// does not churn React state or rewrite localStorage.
export function mergeDiscoveredBridges(
  store: BridgeBackendStore,
  discovered: DiscoveredBridge[],
): BridgeBackendStore {
  const userBackends = store.backends.filter((backend) => !backend.discovered);
  const previousDiscoveredById = new Map(
    store.backends
      .filter((backend) => backend.discovered)
      .map((backend) => [backend.id, backend] as const),
  );
  const userUrls = new Set(userBackends.map((backend) => backend.baseUrl));

  const discoveredBackends: BridgeBackendProfile[] = [];
  const newlyAddedIds: string[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  for (const bridge of discovered) {
    const id = `${DISCOVERED_ID_PREFIX}${bridge.id}`;
    if (userUrls.has(bridge.baseUrl)) {
      continue; // A user-saved backend for this URL takes precedence.
    }
    if (seenIds.has(id) || seenUrls.has(bridge.baseUrl)) {
      continue; // De-duplicate collisions within the file itself.
    }
    seenIds.add(id);
    seenUrls.add(bridge.baseUrl);
    const previous = previousDiscoveredById.get(id);
    discoveredBackends.push({
      id,
      name: bridge.name,
      baseUrl: bridge.baseUrl,
      color: discoveredBackendColor(bridge),
      discovered: true,
      profile: bridge.profile,
      // Carry the reachability marker across refreshes so a probed-reachable
      // entry does not thrash store identity every 30 s.
      lastConnectedAt: previous?.lastConnectedAt,
    });
    if (!previous) {
      newlyAddedIds.push(id);
    }
  }

  const backends = [...userBackends, ...discoveredBackends];
  const survivingDiscoveredIds = new Set(discoveredBackends.map((backend) => backend.id));
  const keptEnabledIds = store.enabledBridgeIds.filter(
    (bridgeId) =>
      !bridgeId.startsWith(DISCOVERED_ID_PREFIX) || survivingDiscoveredIds.has(bridgeId),
  );
  const enabledBridgeIds = normalizeEnabledBridgeIds(
    [...keptEnabledIds, ...newlyAddedIds],
    backends,
    defaultBridgeMode() === "same-origin",
  );
  const lastSelectedBridgeId =
    store.lastSelectedBridgeId && enabledBridgeIds.includes(store.lastSelectedBridgeId)
      ? store.lastSelectedBridgeId
      : (enabledBridgeIds[0] ?? null);

  const next: BridgeBackendStore = {
    version: store.version,
    enabledBridgeIds,
    lastSelectedBridgeId,
    backends,
  };
  return storesEqual(store, next) ? store : next;
}

function storesEqual(a: BridgeBackendStore, b: BridgeBackendStore): boolean {
  return (
    a.lastSelectedBridgeId === b.lastSelectedBridgeId &&
    arraysEqual(a.enabledBridgeIds, b.enabledBridgeIds) &&
    backendsEqual(a.backends, b.backends)
  );
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function backendsEqual(
  a: readonly BridgeBackendProfile[],
  b: readonly BridgeBackendProfile[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((left, index) => {
    const right = b[index];
    return (
      left.id === right.id &&
      left.name === right.name &&
      left.baseUrl === right.baseUrl &&
      left.color === right.color &&
      left.lastConnectedAt === right.lastConnectedAt &&
      left.discovered === right.discovered &&
      left.profile === right.profile
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
