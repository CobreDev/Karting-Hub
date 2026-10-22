# Karting Hub

A shareable lap-time dashboard for endurance karting races, built from Race Monitor's per-kart `.txt` exports.

Split each kart into driver stints ("Alex to lap 52, Jordan to 90, Sam to the finish"), give each team a
name and color, and send one link around so everyone can see their best lap, clean-lap average,
consistency, and every lap of the race.

- **Drivers table**: best lap, gap to fastest, best-5 average, clean-lap average, median, std dev and pace spread.
- **Lap-time chart**: one line per kart, colored by driver, with driver-change markers. Slow laps are dotted;
  pit stops and other off-scale laps are skipped with a gray dashed line. Drivers with their own color get a
  two-tone dashed line (driver color + team color).
- **Race Monitor-style lap list**: pick a team and see every lap in race order, with the driver, position, a
  lap-time bar (green / yellow / red), Δ to the driver's best and Δ to the previous lap.
- **Teams page with rosters**: each team's color, photo and roster. Owner and core drivers are tied to one
  team; rotating drivers can race for several.
- **Driver list with personal colors and photos**: drivers are saved once and reused across races and teams.
  Teams can have a photo too. Photos are cropped square and shrunk to 256×256 in the browser before upload.
- **Per-driver links** (`#/r/<race>/<driver>|<kart>`) jump straight to that driver's laps.
- **Editor**: drop in Race Monitor files, merge split sessions, set teams, colors and driver changes.
- Light and dark mode, works on phones, zero dependencies.

## Quick start

```bash
docker run -d --name karting-hub -p 8080:8080 \
  -e ADMIN_TOKEN=change-me \
  -v karting-hub-data:/data \
  ghcr.io/cobredev/karting-hub:latest
```

Open http://localhost:8080. Viewing is open to anyone with the URL; **+ New race** and **Edit** need the
`ADMIN_TOKEN`. It starts empty: add your first race with **+ New race**.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `ADMIN_TOKEN` | *(empty)* | Password for uploads and edits. Empty = read-only dashboard. |
| `PORT` | `8080` | HTTP port inside the container. |
| `DATA_DIR` | `/data` | Where races are stored (`/data/races/*.json`). Mount a volume here. |

### Your data

Every race is saved as one JSON file in `/data/races/` inside the container (plus the shared driver and team lists in
`/data/drivers.json` and `/data/teams.json`, and profile photos in `/data/images/`), and written to disk the moment
you click **Save race**. Map `/data` to a folder on the host and your races survive restarts, stops,
container updates and re-creating the container. The Unraid template and `docker-compose.yml` already map it
to `/mnt/user/appdata/karting-hub`.

- **Always mount `/data`.** Without a mapping, Docker keeps the data in an anonymous volume. That survives a
  restart but is left behind when the container is recreated, which is what an Unraid update does.
- **The folder must be writable by uid 99 / gid 100** (Unraid's `nobody:users`). If it isn't, the container
  stops at startup with a message saying so. Fix it with
  `chown -R 99:100 /mnt/user/appdata/karting-hub`.
- **A new install starts empty.** The app creates `races/`, `drivers.json`, `teams.json` and `images/` on
  first start and never overwrites existing files.
- **Back up** by copying the folder. The Appdata Backup plugin on Unraid covers it automatically. To restore or
  move servers, drop the `.json` files back into `races/`.

## Adding a race

1. Click **+ New race** and enter your admin token at the bottom of the page.
2. Drop in every Race Monitor `.txt` file. Upload both files for a kart when the race was split over two timing
   sessions; they're merged by lap number. Check the **Kart #** column before clicking **Add to race**: it
   comes from the file name (`7 2.txt` → 7) because the header sometimes shows a different transponder.
3. For each kart, set the team name and color, then list the drivers in order with the last lap each one
   drove (leave the last driver blank = to the finish). Driver names autocomplete from the saved driver list,
   and the color box next to a name sets that driver's personal color for every race (optional). The "likely pit laps" buttons add a driver change
   after that lap.
4. **Save race**.

There's also a CLI importer that produces the same JSON:

```bash
node scripts/import.mjs --name "Saturday Enduro" --track "My Track" --date 2026-03-14 \
  --stints "7=Alex:52,Jordan:90,Sam" --team "7=Team Apex:#eb6834" \
  --out race.json exports/*.txt
```

See [docs/data-format.md](docs/data-format.md) for the file formats and how pit/slow laps are detected.

## Running on Unraid

Every push to `main` builds and publishes `ghcr.io/cobredev/karting-hub:latest` (see
[Docker image builds](#docker-image-builds)).

- **Unraid template (recommended)**:
  1. *Docker* tab → scroll to **Template repositories** → add `https://github.com/CobreDev/Karting-Hub`
     on its own line → **Save**.
  2. **Add Container** → **Template** dropdown → **karting-hub** (under the CobreDev section).
  3. Set **Admin token** to something long and random, check the **Data** path, then **Apply**.

  The template is [`unraid/karting-hub.xml`](unraid/karting-hub.xml). To install it by hand instead, copy it
  to `/boot/config/plugins/dockerMan/templates-user/my-karting-hub.xml`.
- **Compose Manager plugin**: use [`docker-compose.yml`](docker-compose.yml) (change `ADMIN_TOKEN` first).

Races are stored in `/mnt/user/appdata/karting-hub`. The container runs as `99:100` (nobody:users), which
matches Unraid's appdata ownership. To update, *Check for updates* / *Force update* in the Docker tab, or
`docker compose pull && docker compose up -d`.

**Sharing outside your network:** `http://tower:8080` only works at home. Put it behind a Cloudflare Tunnel,
Tailscale Funnel, or your reverse proxy (SWAG / Nginx Proxy Manager) to give friends a public URL, and use a
strong `ADMIN_TOKEN`.

## Docker image builds

[`.github/workflows/docker.yml`](.github/workflows/docker.yml) runs on every push and pull request:

1. `npm test` (parser, stint and color tests).
2. Builds the image for `linux/amd64` and `linux/arm64`.
3. On pushes (not PRs), publishes to GitHub Container Registry:
   - `main` → `latest` and `sha-<commit>`
   - tag `v1.2.3` → `1.2.3`, `1.2`, `1`

No secrets to set up: it uses the repository's built-in `GITHUB_TOKEN`. New GHCR packages are **private**;
either make it public (GitHub → your profile → *Packages* → *karting-hub* → *Package settings* → *Change
visibility*) or run `docker login ghcr.io` on the server with a token that has `read:packages`.

To build locally instead: `docker build -t karting-hub .`

## Development

Requires Node 20+. No install step: there are no dependencies.

```bash
ADMIN_TOKEN=dev npm start    # http://localhost:8080
npm test                     # node --test
```

```
server.js            HTTP server: static files + JSON API, stores races as files
public/
  index.html         page shell
  app.js             the whole UI: routing, dashboard, chart, lap list, editor
  style.css          theme tokens (light/dark) and layout
  lib/race.js        parsing, merging, stint splitting, stats, formatting (shared with Node)
  lib/color.js       team color -> per-driver shades for light and dark mode
  lib/images.js      photo ids, size limits, image type check (shared with the server)
scripts/import.mjs   CLI: Race Monitor .txt files -> race JSON
test/                node:test suites
unraid/              Unraid container template and icon
docs/                data format reference
```

### API

| Method | Path | Auth | |
| --- | --- | --- | --- |
| GET | `/api/races` | – | Race summaries |
| GET | `/api/races/:id` | – | Full race JSON |
| PUT | `/api/races/:id` | Bearer token | Create/replace a race |
| DELETE | `/api/races/:id` | Bearer token | Delete a race |
| GET | `/api/drivers` | – | Saved driver list `{ drivers: [{ name, color }] }` |
| PUT | `/api/drivers` | Bearer token | Replace the driver list |
| GET | `/api/teams` | – | Saved team list `{ teams: [{ name, color, members: [{ driver, role }] }] }` |
| PUT | `/api/teams` | Bearer token | Replace the team list (roster rules are validated) |
| GET | `/api/images` | – | Which drivers/teams have photos `{ drivers: { id: version }, teams: {...} }` |
| PUT | `/api/images/:drivers\|teams/:id` | Bearer token | Upload a photo (WebP/JPEG/PNG body, max 1 MB) |
| DELETE | `/api/images/:drivers\|teams/:id` | Bearer token | Remove a photo |
| GET | `/images/:drivers\|teams/:id?v=…` | – | The photo itself (cached forever per version) |
| GET | `/api/config` | – | `{ editable }` (is `ADMIN_TOKEN` set?) |
| GET | `/api/health` | – | Health check used by Docker |

## Automatic import from Race Monitor?

Race Monitor has an API (`api.race-monitor.com`), but it's only for authorized apps and access is by request
from Race Monitor. Until there's an API key, upload the `.txt` exports. The public results pages only show
each kart's totals, not individual laps.
