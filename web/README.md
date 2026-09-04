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
