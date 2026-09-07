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

## Discovered bridges

When the server that delivers this app also publishes a `bridges.json` at the page origin, the app
reads it (with `cache: no-store`) and merges the listed bridges into the saved-bridge list. This
lets a hub advertise the live bridges it fronts so phones and laptops pick up sessions as they come
and go without editing Settings. The file is optional: a `404`, a network error, or a malformed
body is silent, and deployments without it behave exactly as before.

Discovered bridges appear in Settings → Bridge with a working enable switch but no edit or delete
controls, and are never written to local storage. A user-saved bridge with the same URL always wins
over a discovered one. The shape is:

```json
{
  "version": 1,
  "generatedAt": "2026-09-04T16:26:36Z",
  "host": "workspace.example.ts.net",
  "hub": { "baseUrl": "https://workspace.example.ts.net:8787", "label": "console" },
  "bridges": [
    {
      "id": "session:bootloop",
      "name": "bootloop",
      "baseUrl": "https://workspace.example.ts.net:8801",
      "profile": "work",
      "workdir": "~/COWORK",
      "color": "#89b4fa"
    }
  ]
}
```

`id`, `name`, and `baseUrl` are required per entry. `profile` (one of `work`, `personal`, `other`)
and `color` (a `#rrggbb` hex) are optional; `profile` renders a small tag next to the bridge name —
a compact `W`/`P` on the narrow host chips (with the full word as its accessible name) and the full
`work`/`personal` word in space-group headers and the Settings summary. The `hub` entry is not added
as a bridge, and any entry whose URL is the page's own origin is dropped, since it is already
reachable as the same-origin bridge.
## Fleet usage

The optional **Fleet** sidebar tab shows the usage of the operator's Claude Code account pools.
It reads a generated JSON file served at `/usage.json` on the same origin as the page (no-cache,
regenerated periodically). The tab is hidden entirely when the file is absent (404) or unusable, so
deployments without a usage generator are unaffected.

Until a sidebar view is explicitly chosen, the app lands on the Fleet tab once the feed loads, so
the page opens on subscription status rather than the agents list. Whether a view was chosen is a
persisted `sidebarViewChosen` flag, separate from the stored view because the app rewrites the view
on every change; the flag is false on every existing device (the field is absent, which reads as
not chosen), so those devices move to Fleet with no taps. Tapping any view sets the flag, so that
choice is remembered on the next visit and always wins. A device with no `/usage.json` lands on
Agents as before, since the Fleet tab never appears.

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

Only `version`, `pools`, `accounts`, and `number` are required to surface an account; `usage` (and
within it `fiveHour.pct` / `sevenDay.pct`) is optional, every other field is optional, and a pool may
be `null`. An account whose usage block is absent or incomplete is still shown (its `usage`
normalizes to `null`, the `relogin_required` case) with a "no usage data" line instead of bars, so an
account that needs the operator's attention is never filtered out upstream or in the page.
Percentages are clamped to
0–100 and rendered ok (< 75), warn (75–89.99), or hot (≥ 90).

The panel refreshes on mount, every 60 seconds, on window `focus`, and on `visibilitychange` when
the page becomes visible; a failed refresh keeps the last good data and shows a stale marker. While
nothing usable has loaded yet (no generator / 404) the periodic poll backs off to roughly five
minutes. Parsing and normalization live in `src/fleetUsage.ts`; the panel and its refresh hook live
in `src/FleetUsagePanel.tsx`.
