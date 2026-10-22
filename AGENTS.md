# AGENTS.md

Guidance for AI coding agents working in this repo. Human docs are in [README.md](README.md); data formats are
in [docs/data-format.md](docs/data-format.md).

## What this is

A self-hosted dashboard that turns Race Monitor lap exports into per-driver results for endurance kart races.
Friends open a link to view; the owner uploads and edits with an admin token. It ships as one Docker image
that runs on an Unraid server.

## Commands

```bash
npm test                    # node --test test/*.test.js — run after every change
ADMIN_TOKEN=dev npm start   # dev server on http://localhost:8080 (token "dev")
node --check public/app.js  # quick syntax check (the UI has no build step)
node scripts/import.mjs ... # rebuild a race JSON from .txt exports (see README)
docker build -t karting-hub .
```

## Ground rules

- **Zero runtime dependencies, no build step.** Plain Node (ES modules, Node 20+) on the server and plain
  browser JS/CSS on the client. Don't add npm packages, bundlers, frameworks, TypeScript or CDN scripts
  without the owner asking. `package.json` has no `dependencies`, and the Dockerfile relies on that.
- **`public/lib/*.js` is shared** between the browser, the CLI importer and the tests. Keep it free of DOM and
  Node APIs.
- **Races pick from saved lists too.** The race editor's team and driver fields are `<select>`s of
  `teams.json` / `drivers.json` (`teamSelect`, `driverSelect`); `quickAdd()` creates a new one in place. Names
  from older races that aren't saved stay selectable, marked "not on … page".
- **Drivers page edits rosters** through `driverTeamEditor` + `updateRosters()`, validated by `teamListErrors()`.
- **Rosters only use saved drivers.** The Teams page picks members from `drivers.json` (a dropdown, not free
  text); removing a driver on the Drivers page strips them from rosters. Both pages autosave via `autosaver()`.
- **Teams are referenced by name too.** `DATA_DIR/teams.json` holds team colors and rosters. Roster roles
  are in `ROLES`: `owner`/`core` are bound to one team, `rotating` can be on many. Validate with
  `teamListErrors()`, which is shared by the UI and the server. `teamColor()` prefers the saved team color
  over `kart.color`.
- **Drivers are referenced by name.** Stints store the name; personal colors live in `DATA_DIR/drivers.json`
  and are matched with `driverId()` (trimmed, lowercased). Don't copy colors into race files.
- **Photos are resized in the browser** (`resizeImage`, 256×256 square). The server never decodes images:
  it checks magic bytes (`imageType`) and size, and stores the bytes. Keep it that way; no image libraries.
  Photos are keyed by `imageId(name)`, the same name-based identity as driver colors.
- **Derived data is never stored.** Race JSON holds laps and stints only. Driver stats, lap flags (`pit` /
  `slow`) and colors are computed at render time by `computeDrivers` and `applyTeamColors`. Don't persist them.
- **Kart number comes from the file name**, not the Race Monitor header (split sessions can carry another
  transponder number). Don't "fix" this.
- **Stints:** `[{ driver, toLap }]` in order; `toLap: null` means to the finish. A driver's laps are
  `previous toLap + 1 … toLap`.
- **Escape user strings** with `esc()` before putting them into HTML. Everything is built from template
  strings, so team and driver names are an injection risk.
- Match the existing style: 2-space indent, single quotes, semicolons, small comments that explain *why*.

## Architecture

| File | Role |
| --- | --- |
| `docker-entrypoint.sh` | Starts as root (so hooks like Unraid's Tailscale integration can run), chowns `DATA_DIR` to `PUID:PGID` (default 99:100), then `su-exec`s the app. Without root it just runs the command. |
| `server.js` | `node:http` server. Static files from `public/` with an SPA fallback, and a JSON API that reads/writes `DATA_DIR/races/<id>.json` (atomic tmp+rename). PUT/DELETE need `Authorization: Bearer $ADMIN_TOKEN` (constant-time compare). Creates an empty `drivers.json` / `teams.json` on first start; there is no bundled data. |
| `public/app.js` | The whole UI. Hash routes: `#/` (race list), `#/r/:id` (dashboard), `#/r/:id/:driverKey` (highlight a driver),
`#/r/:id/team/:kart` (open a team's lap list), `#/edit/:id`, `#/new`, `#/drivers` (driver list, colors,
photos), `#/teams` (team list, colors, photos, rosters). The dashboard is rebuilt with `innerHTML` on each route change; clicks go through one delegated `app.onclick`. |
| `public/lib/race.js` | `parseRaceMonitor`, `mergeLaps`, `missingLaps`, `pitCandidates`, `computeDrivers`, formatters. |
| `public/lib/images.js` | `imageId`, `imageType` (magic-byte check), `IMAGE_SIZE`, `MAX_IMAGE_BYTES`. Used by the browser and `server.js`. |
| `public/lib/color.js` | OKLCH helpers. `teamShades(hex, n, mode)` steps a color's lightness, clamped to a readable lightness band per theme. |
| `public/style.css` | Theme tokens on `:root`, dark mode under both `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and `:root[data-theme="dark"]`. Mobile breakpoint is 640px. |

Key UI pieces in `app.js`:

- `kartRuns(race, drivers)`: per kart, every lap tagged with its driver plus consecutive-driver `chunks`.
  Used by both the chart and the lap list.
- `lapChart`: hand-rolled SVG, one line per kart. Legs touching a slow lap are dotted. Laps above the y-range
  (pit stops) aren't plotted; a gray dashed `.bridge` joins the on-scale laps either side. Drivers with a
  personal color are drawn as two overlaid dashed polylines (team `9 7`, driver `4 12` offset `5.5`).
  Hover/tap tooltip and crosshair.
- `lapSection(focus, karts, kart)`: Race Monitor-style list for one team (team buttons switch it). One
  continuous list with a Driver column. Δ best is against that driver's best, and Δ prev resets at each
  driver change. `focus` (from a driver link) only highlights rows.
- `applyTeamColors`: writes `--t-*` (team) and `--d-*` (driver) CSS variables for both themes. `swatch(d)`
  renders a split team/driver swatch for drivers with their own color.
- `leaderboard`: per-driver table sorted by best lap.
- Editor: `showEditor` / `renderEditor` / `bindEditor` / `kartEditor` keep a draft in `state.edit` and PUT
  the whole race on save.

## Charts and colors

- Team color = `kart.color`, else a slot of `DEFAULT_TEAM_COLORS`. A driver's color = their personal color
  from the driver list if set (lightness nudged per theme by `teamShades(hex, 1, mode)`), otherwise exactly
  the team color, so teammates always match. Drivers with their own color show team + personal color together.
- Text stays in the text tokens (`--text-primary/secondary/muted`), never the series color.
- Lap-bar colors are status tokens (`--status-good/warn/crit`) and always come with a text label or pill.
- If you change team colors or the palette, check that the two teams can still be told apart in both themes,
  including for colorblind viewers.

## Verifying changes

1. `npm test` must pass. Add a test in `test/` for any change to `public/lib/`.
2. For UI changes, run the dev server and check the race page at desktop width **and** ~375px (no horizontal
   page scroll; the Drivers table must fit without sideways scrolling), in light and dark mode.
3. The page loads ES modules: after editing, do a real reload. Changing only the URL hash doesn't reload.

## Data in the repo

The repo ships with **no race data**: no sample races, drivers or teams. Tests use small inline fixtures with
made-up names. Never commit real race exports, driver or team names, or anything from a `data/` folder.
