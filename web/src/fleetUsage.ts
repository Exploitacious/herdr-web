import { fetchWithTimeout } from "./fetchWithTimeout";

// Fleet usage model + fetch/normalization for the operator's Claude Code account
// pools. The hub serves a generated `/usage.json` describing a WORK pool and a
// PERSONAL pool, each rotating across accounts on 5-hour / 7-day usage limits.
// Everything here is pure and unit-testable; the network entry point is
// `fetchFleetUsage`. See web/README.md "Fleet usage" for the wire contract.

// Same origin as the page, at the origin root (leading slash), regenerated every
// two minutes and served no-cache. Absent (404) on deployments without the
// generator -> the feature is invisible.
export const USAGE_URL = "/usage.json";

// Matches the bridge fetch budget; the file is tiny and same-origin.
export const FLEET_USAGE_TIMEOUT_MS = 5000;

export type UsageLevel = "ok" | "warn" | "hot";

export interface FleetWindow {
  // pct is clamped to 0..100. resetsAt/countdown/clock/pace fields are optional
  // in the wire format and normalize to null when absent or malformed.
  pct: number;
  resetsAt: string | null;
  resetsAtDate: Date | null;
  countdown: string | null;
  clock: string | null;
  expectedPct: number | null;
  aheadOfPace: boolean | null;
  projectedExhaustionAt: string | null;
  projectedExhaustionAtDate: Date | null;
  willLastToReset: boolean | null;
}

export interface FleetScopedWindow extends FleetWindow {
  name: string;
}

export interface FleetSpend {
  used: number;
  limit: number;
  pct: number;
  currency: string | null;
}

export interface FleetAccountUsage {
  fiveHour: FleetWindow;
  sevenDay: FleetWindow;
  spend: FleetSpend | null;
  scoped: FleetScopedWindow[];
}

export interface FleetAccount {
  number: number;
  // email is retained for the row title attribute only; it is never rendered as
  // visible text (it may be a real address). alias is the visible label.
  email: string | null;
  alias: string;
  active: boolean;
  usageStatus: string | null;
  usage: FleetAccountUsage;
  usageAgeSeconds: number | null;
}

export interface FleetPool {
  activeAccountNumber: number | null;
  accounts: FleetAccount[];
}

export interface FleetUsage {
  version: 1;
  generatedAt: string | null;
  generatedAtDate: Date | null;
  pools: {
    work: FleetPool | null;
    personal: FleetPool | null;
  };
}

export interface FleetPoolSummary {
  alias: string;
  fiveHourPct: number;
  sevenDayPct: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function clampPct(pct: number): number {
  return Math.min(100, Math.max(0, pct));
}

function parseIsoDate(value: unknown): Date | null {
  const raw = asString(value);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeWindow(raw: unknown): FleetWindow | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const pct = asFiniteNumber(record.pct);
  if (pct === null) {
    return null;
  }
  const expected = asFiniteNumber(record.expectedPct);
  return {
    pct: clampPct(pct),
    resetsAt: asString(record.resetsAt),
    resetsAtDate: parseIsoDate(record.resetsAt),
    countdown: asString(record.countdown),
    clock: asString(record.clock),
    expectedPct: expected === null ? null : clampPct(expected),
    aheadOfPace: asBoolean(record.aheadOfPace),
    projectedExhaustionAt: asString(record.projectedExhaustionAt),
    projectedExhaustionAtDate: parseIsoDate(record.projectedExhaustionAt),
    willLastToReset: asBoolean(record.willLastToReset),
  };
}

function normalizeScoped(raw: unknown): FleetScopedWindow | null {
  const window = normalizeWindow(raw);
  if (!window) {
    return null;
  }
  const record = asRecord(raw);
  const name = record ? asString(record.name) : null;
  if (!name) {
    return null;
  }
  return { ...window, name };
}

function normalizeSpend(raw: unknown): FleetSpend | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const used = asFiniteNumber(record.used);
  const limit = asFiniteNumber(record.limit);
  if (used === null || limit === null) {
    return null;
  }
  const pct = asFiniteNumber(record.pct);
  return {
    used,
    limit,
    // Derive the percentage when the server omits it; guard against a zero limit.
    pct: pct === null ? (limit > 0 ? clampPct((used / limit) * 100) : 0) : clampPct(pct),
    currency: asString(record.currency),
  };
}

function normalizeAccount(raw: unknown): FleetAccount | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const number = asFiniteNumber(record.number);
  if (number === null) {
    return null;
  }
  const usageRecord = asRecord(record.usage);
  if (!usageRecord) {
    return null;
  }
  // fiveHour.pct and sevenDay.pct are the only required usage fields; an account
  // missing either is malformed and dropped.
  const fiveHour = normalizeWindow(usageRecord.fiveHour);
  const sevenDay = normalizeWindow(usageRecord.sevenDay);
  if (!fiveHour || !sevenDay) {
    return null;
  }
  const scopedRaw = Array.isArray(usageRecord.scoped) ? usageRecord.scoped : [];
  const scoped = scopedRaw
    .map(normalizeScoped)
    .filter((entry): entry is FleetScopedWindow => entry !== null);
  return {
    number,
    email: asString(record.email),
    // Fall back to a number label rather than the email/org name, which can be
    // the address itself for personal accounts and must never be printed.
    alias: asString(record.alias) ?? `#${number}`,
    active: asBoolean(record.active) ?? false,
    usageStatus: asString(record.usageStatus),
    usage: {
      fiveHour,
      sevenDay,
      spend: normalizeSpend(usageRecord.spend),
      scoped,
    },
    usageAgeSeconds: asFiniteNumber(record.usageAgeSeconds),
  };
}

function normalizePool(raw: unknown): FleetPool | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const accountsRaw = Array.isArray(record.accounts) ? record.accounts : [];
  const accounts = accountsRaw
    .map(normalizeAccount)
    .filter((account): account is FleetAccount => account !== null);
  if (accounts.length === 0) {
    return null;
  }
  return {
    activeAccountNumber: asFiniteNumber(record.activeAccountNumber),
    accounts,
  };
}

// Validate the top-level envelope and normalize into the typed model. Returns
// null on a wrong/absent version or when no pool has any usable account.
export function normalizeFleetUsage(raw: unknown): FleetUsage | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  if (asFiniteNumber(record.version) !== 1) {
    return null;
  }
  const poolsRecord = asRecord(record.pools);
  if (!poolsRecord) {
    return null;
  }
  const work = normalizePool(poolsRecord.work);
  const personal = normalizePool(poolsRecord.personal);
  if (!work && !personal) {
    return null;
  }
  return {
    version: 1,
    generatedAt: asString(record.generatedAt),
    generatedAtDate: parseIsoDate(record.generatedAt),
    pools: { work, personal },
  };
}

// Network entry point. Returns null on 404, network error/timeout, non-JSON,
// wrong version, or no usable pool -- callers treat null as "feature invisible".
export async function fetchFleetUsage(): Promise<FleetUsage | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(USAGE_URL, {
      cache: "no-store",
      timeoutMs: FLEET_USAGE_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  return normalizeFleetUsage(payload);
}

// Thresholds: ok < 75, warn 75..89.99, hot >= 90.
export function usageLevel(pct: number): UsageLevel {
  if (!Number.isFinite(pct)) {
    return "ok";
  }
  if (pct >= 90) {
    return "hot";
  }
  if (pct >= 75) {
    return "warn";
  }
  return "ok";
}

// The account the pool is currently rotated onto. Prefer the per-account active
// flag (what the row marker keys on) and fall back to activeAccountNumber.
export function activeAccount(pool: FleetPool | null): FleetAccount | null {
  if (!pool) {
    return null;
  }
  const flagged = pool.accounts.find((account) => account.active);
  if (flagged) {
    return flagged;
  }
  if (pool.activeAccountNumber !== null) {
    return pool.accounts.find((account) => account.number === pool.activeAccountNumber) ?? null;
  }
  return null;
}

// Compact header line data: the active account's alias and 5h/7d percentages.
export function poolSummary(pool: FleetPool | null): FleetPoolSummary | null {
  const account = activeAccount(pool);
  if (!account) {
    return null;
  }
  return {
    alias: account.alias,
    fiveHourPct: account.usage.fiveHour.pct,
    sevenDayPct: account.usage.sevenDay.pct,
  };
}

// Countdown until reset. Compute days/hours/minutes matching the server format
// ("4d 19h", "2h 51m", "1m"); returns "now" once the reset time has passed.
export function computeCountdown(resetsAt: Date | null, now: Date): string | null {
  if (!resetsAt) {
    return null;
  }
  const diffMs = resetsAt.getTime() - now.getTime();
  if (diffMs <= 0) {
    return "now";
  }
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Prefer the server-supplied countdown; fall back to computing from resetsAt and
// the passed-in `now` (never reads the clock itself, so it stays testable).
export function formatCountdown(
  window: Pick<FleetWindow, "countdown" | "resetsAtDate">,
  now: Date,
): string | null {
  if (window.countdown) {
    return window.countdown;
  }
  return computeCountdown(window.resetsAtDate, now);
}

// Prefer the server-supplied clock string; fall back to a local reset time.
export function formatReset(window: Pick<FleetWindow, "clock" | "resetsAtDate">): string | null {
  if (window.clock) {
    return window.clock;
  }
  return formatClock(window.resetsAtDate);
}

// Absolute wall-clock label for a date (used for reset and projected-exhaustion).
export function formatClock(date: Date | null): string | null {
  if (!date) {
    return null;
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Footer "updated <time>" label from the file's generatedAt.
export function formatUpdated(date: Date | null): string {
  if (!date) {
    return "unknown";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
