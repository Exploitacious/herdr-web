# @herdr/web

React + Vite frontend for `herdr-web`.

Run from this directory:

```bash
npm install
npm run dev
npm run lint
npm run test
npm run build
```

The production build is written to `web/dist/` and served by `herdr-web-bridge` through
`scripts/run-bridge.sh`.

For the normal one-command development workflow, start the bridge and Vite from the repository root:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` and `/ws` to the managed bridge and hot-reloads
frontend edits. See the root README for address and socket overrides.

To manage the two processes separately instead:

```bash
# terminal 1, from the repository root
npm run bridge:build && scripts/run-bridge.sh

# terminal 2, from the repository root
npm run dev:web
```

`scripts/run-bridge.sh` points debug bridge builds at the stable Herdr socket by default instead of
the debug `herdr-dev` socket. Override `HERDR_SOCKET_PATH` when targeting a named or development
session.

The app expects these bridge routes:

- `/api/capabilities`
- `/api/snapshot`
- `/api/command`
- `/api/launcher-presets`
- `/api/launcher-presets/launch`
- `/api/selection`
- `/api/notes` (and `/api/notes/{note_id}/...` actions)
- `/api/agent-pins` (and `/api/agent-pins/{pane_id}/pin|unpin`)
- `/api/agent-activity`
- `/api/uploads`
- `/ws/activity`
- `/ws/events`
- `/ws/ui-events`
- `/ws/terminal`

Launcher execution belongs to the bridge. The frontend selects a preset and placement; it does not
construct Herdr `agent.start` requests. Built-in agents use Herdr's managed-agent flow after the
bridge creates the destination pane, while custom presets retain their exact configured `argv`.

## Fleet usage

The optional **Fleet** sidebar tab shows the usage of the operator's Claude Code account pools.
It reads a generated JSON file served at `/usage.json` on the same origin as the page (no-cache,
regenerated periodically). The tab is hidden entirely when the file is absent (404) or unusable, so
deployments without a usage generator are unaffected.

The file describes a WORK pool and a PERSONAL pool, each rotating across accounts on 5-hour and
7-day usage limits:

```jsonc
{
  "version": 1,
  "generatedAt": "2026-09-04T16:26:37Z",
  "pools": {
    "work": { "activeAccountNumber": 3, "accounts": [ /* ... */ ] },
    "personal": null
  }
}
```

An account looks like:

```jsonc
{
  "number": 3,
  "email": "…",            // shown only in the row title attribute, never as visible text
  "alias": "claude1",       // the visible label
  "active": true,
  "usageStatus": "ok",
  "usage": {
    "fiveHour": { "pct": 61.0, "resetsAt": "…", "countdown": "4h 11m", "clock": "16:40" },
    "sevenDay": {
      "pct": 45.0, "resetsAt": "…", "countdown": "17h 31m", "clock": "Sep 5 06:00",
      "expectedPct": 89.6, "aheadOfPace": false, "projectedExhaustionAt": "…", "willLastToReset": true
    },
    "spend": { "used": 116.74, "limit": 150.0, "pct": 77.8, "currency": "USD" },
    "scoped": [ { "name": "Fable", "pct": 50.0, "resetsAt": "…", "countdown": "4d 19h" } ]
  }
}
```

Only `version`, `pools`, `accounts`, `number`, `usage.fiveHour.pct`, and `usage.sevenDay.pct` are
required; every other field is optional and a pool may be `null`. Percentages are clamped to
0–100 and rendered ok (< 75), warn (75–89.99), or hot (≥ 90). Parsing and normalization live in
`src/fleetUsage.ts`; the panel and its refresh hook live in `src/FleetUsagePanel.tsx`.
