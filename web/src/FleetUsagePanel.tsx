import { useCallback, useEffect, useRef, useState } from "react";
import {
  activeAccount,
  fetchFleetUsage,
  formatClock,
  formatCountdown,
  formatUpdated,
  usageLevel,
  type FleetAccount,
  type FleetPool,
  type FleetUsage,
  type FleetWindow,
} from "./fleetUsage";

// Poll the fleet usage file on the same cadence the hub regenerates it (~2 min),
// plus on focus/visibility so a phone waking up refreshes promptly.
const FLEET_USAGE_REFRESH_MS = 60_000;

export interface FleetUsageState {
  usage: FleetUsage | null;
  stale: boolean;
  refresh: () => void;
}

// Owns fetching, polling, and staleness. A failed refresh keeps the last good
// data and flips `stale`; before the first success `usage` stays null so the
// caller can hide the Fleet tab entirely.
export function useFleetUsage(): FleetUsageState {
  const [usage, setUsage] = useState<FleetUsage | null>(null);
  const [stale, setStale] = useState(false);
  const lastGoodRef = useRef<FleetUsage | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const result = await fetchFleetUsage();
    if (!mountedRef.current) {
      return;
    }
    if (result) {
      lastGoodRef.current = result;
      setUsage(result);
      setStale(false);
    } else if (lastGoodRef.current) {
      // Keep showing the last good data; mark it stale until the next success.
      setStale(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, FLEET_USAGE_REFRESH_MS);
    const onFocus = () => {
      void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { usage, stale, refresh };
}

export interface FleetUsagePanelProps {
  usage: FleetUsage | null;
  stale: boolean;
  onRefresh: () => void;
  // Injectable clock for countdown fallbacks; defaults to the real clock.
  now?: Date;
}

export function FleetUsagePanel({ usage, stale, onRefresh, now }: FleetUsagePanelProps) {
  if (!usage) {
    return null;
  }
  const clock = now ?? new Date();
  return (
    <>
      <FleetPoolSection label="WORK" pool={usage.pools.work} now={clock} />
      <FleetPoolSection label="PERSONAL" pool={usage.pools.personal} now={clock} />
      <div className="fleet-footer">
        <span className="fleet-updated">
          updated {formatUpdated(usage.generatedAtDate)}
          {stale ? <span className="fleet-stale"> · stale</span> : null}
        </span>
        <button type="button" className="btn fleet-refresh" onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </>
  );
}

function FleetPoolSection({ label, pool, now }: { label: string; pool: FleetPool | null; now: Date }) {
  const active = activeAccount(pool);
  return (
    <section className="sec fleet-pool" data-fleet-pool={label.toLowerCase()}>
      <div className="sec-head">
        <span className="sec-label">{label}</span>
        <span className="sec-rule" />
        {active ? <span className="fleet-active-alias">{active.alias}</span> : null}
      </div>
      {pool ? (
        pool.accounts.map((account) => (
          <FleetAccountRow key={account.number} account={account} now={now} />
        ))
      ) : (
        <div className="fleet-muted">no data</div>
      )}
    </section>
  );
}

function FleetAccountRow({ account, now }: { account: FleetAccount; now: Date }) {
  const { usage } = account;
  const { spend } = usage;
  return (
    <div
      className="fleet-account"
      data-active={account.active}
      // The email may be a real address: title only, never rendered as text.
      title={account.email ?? undefined}
    >
      <div className="fleet-account-head">
        <span className="fleet-account-alias">{account.alias}</span>
        {account.active ? <span className="fleet-account-badge">active</span> : null}
        {account.usageStatus && account.usageStatus !== "ok" ? (
          <span className="fleet-account-status">{account.usageStatus}</span>
        ) : null}
      </div>
      <FleetBar label="5h" window={usage.fiveHour} now={now} />
      <FleetBar label="7d" window={usage.sevenDay} now={now} />
      {usage.sevenDay.aheadOfPace ? <FleetPace window={usage.sevenDay} /> : null}
      {spend ? (
        <div className="fleet-spend">
          spend {formatMoney(spend.used, spend.currency)} / {formatMoney(spend.limit, spend.currency)}
        </div>
      ) : null}
      {usage.scoped.length > 0 ? (
        <div className="fleet-scoped">
          {usage.scoped.map((scoped) => (
            <FleetBar key={scoped.name} label={scoped.name} window={scoped} now={now} small />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FleetPace({ window }: { window: FleetWindow }) {
  const clock = formatClock(window.projectedExhaustionAtDate);
  return <div className="fleet-pace">ahead of pace{clock ? `, runs out ${clock}` : ""}</div>;
}

function FleetBar({
  label,
  window,
  now,
  small,
}: {
  label: string;
  window: FleetWindow;
  now: Date;
  small?: boolean;
}) {
  const level = usageLevel(window.pct);
  const countdown = formatCountdown(window, now);
  return (
    <div className={small ? "fleet-bar fleet-bar-small" : "fleet-bar"}>
      <div className="fleet-bar-head">
        <span className="fleet-bar-label">{label}</span>
        <span className="fleet-bar-pct mono">{formatPct(window.pct)}</span>
        {countdown ? <span className="fleet-bar-reset mono">{countdown}</span> : null}
      </div>
      <div
        className="fleet-bar-track"
        role="progressbar"
        aria-label={`${label} usage`}
        aria-valuenow={Math.round(window.pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="fleet-bar-fill" data-level={level} style={{ width: `${window.pct}%` }} />
      </div>
    </div>
  );
}

function formatPct(pct: number): string {
  return `${Math.round(pct)}%`;
}

function formatMoney(value: number, currency: string | null): string {
  if (!currency || currency === "USD") {
    return `$${value.toFixed(2)}`;
  }
  return `${value.toFixed(2)} ${currency}`;
}
