# AGENTS.md

Notes for coding agents. User-facing docs are in [README.md](README.md), file formats in
[docs/data-format.md](docs/data-format.md), planned work in [ROADMAP.md](ROADMAP.md).

## Commands

```bash
npm test                    # node --test test/*.test.js
ADMIN_TOKEN=dev npm start   # http://localhost:8080, admin token "dev"
node --check public/js/pages/race.js   # syntax check; there is no build step
```

## Constraints

No runtime dependencies and no build step. The server is plain Node (ES modules, Node 20+) and the client
is plain browser JavaScript loaded as ES modules. Don't add packages, bundlers, frameworks or CDN scripts
unless the owner asks.

`public/lib/` is shared by the browser, the server, the importer and the tests, so it must not touch the DOM
or Node APIs. Changes there need a test in `test/`.

The repo contains no race data. Tests use small inline fixtures with made-up names. Never commit race
exports, real names, or anything from `data/`.

## Data model

Race files hold laps and stints only. Stats, lap flags (`pit`, `slow`) and colors are computed when a page
renders (`computeDrivers`, `applyTeamColors`) and are never stored.

Drivers and teams are referenced by name everywhere and matched with `driverId()` (trimmed, lowercased).
`drivers.json` holds personal colors; `teams.json` holds team colors and rosters. Because of that, renaming
goes through `renameDriver()` on the server, which rewrites races, rosters and the photo in one request. Photos are keyed by
`imageId(name)`. A saved team color takes precedence over the older per-race `kart.color`.

Roster roles are in `ROLES`: `owner` and `core` bind a driver to one team, `rotating` doesn't. The browser
and the server both validate with `teamListErrors()`.

A kart's number comes from the export's file name, not its header, because split sessions can report a
different transponder. Stints are `[{ driver, toLap }]` in order, with `toLap: null` meaning to the finish.

## Layout

| Path | |
| --- | --- |
| `server.js` | Static files, JSON API, Open Graph tags (`serveIndex`, `previewMeta`). Writes are atomic (temp file + rename). Every admin endpoint goes through `checkAuth()`, which applies the wrong-token lockout. |
| `docker-entrypoint.sh` | Starts as root so Unraid hooks can run, chowns `DATA_DIR` to `PUID:PGID`, then runs the app via `su-exec`. |
| `public/app.js` | Entry point: theme toggle and first route. |
| `public/js/core.js` | Shared state, `api()`, `esc()`, the admin token, small formatters. |
| `public/js/router.js` | Path routing (`/r/:id`, `/edit/:id`, `/drivers`, `/teams`, ...). Use `navigate()`; `<a href="/...">` clicks are intercepted. |
| `public/js/registry.js` | Loads the driver and team lists; team colors; per-theme color variables. |
| `public/js/photos.js` | Avatars, initials badges, browser-side resizing, upload controls. |
| `public/js/chart.js` | The lap-time SVG chart. |
| `public/js/preview.js` | Draws the 1200x630 link-preview card on a canvas and re-uploads it when a photo or color it uses changes. |
| `public/js/autosave.js` | Autosave for the Drivers and Teams pages. |
| `public/js/pages/` | One module per page: home, race, editor, drivers, teams. |

The server never decodes images. Photos are cropped and resized in the browser; the server checks the magic
bytes and size and stores the file.

## Conventions

All HTML is built from template strings, so escape user text with `esc()`. Style: 2-space indent, single
quotes, semicolons, and comments only where the reason isn't obvious from the code.

Team colors must stay distinguishable in both themes, including for colorblind viewers. Lap-bar status
colors always come with a text tag.

## Checking UI changes

Run the dev server and look at the race page at desktop width and at about 375px wide, in light and dark
mode. There should be no horizontal page scroll, and the Drivers table must fit without scrolling sideways.
