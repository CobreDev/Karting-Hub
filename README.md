# Karting Hub

A lap-time dashboard for endurance kart races. Upload the per-kart `.txt` exports from Race Monitor, say
which driver drove which laps, and share one link. Each race page shows a driver table (best lap, average,
consistency), a lap-time chart, and a lap-by-lap list for each team.

Drivers and teams are saved once and reused across races, with optional colors and photos. Race links get
a preview card in iMessage, Slack and similar apps. There are no runtime dependencies: one Node server,
plain browser JavaScript, and JSON files on disk.

## Running it

```bash
docker run -d --name karting-hub -p 8080:8080 \
  -e ADMIN_TOKEN=change-me \
  -v karting-hub-data:/data \
  ghcr.io/cobredev/karting-hub:latest
```

Anyone with the URL can view. Adding and editing races needs the admin token. A new install has no data.

| Variable | Default | |
| --- | --- | --- |
| `ADMIN_TOKEN` | empty | Password for editing. Leave empty for a read-only site. |
| `PUBLIC_URL` | guessed from the request | Public address, used in link previews. |
| `DATA_DIR` | `/data` | Where races, drivers, teams and photos are stored. |
| `PORT` | `8080` | Port inside the container. |
| `PUID` / `PGID` | `99` / `100` | User the app runs as (Unraid's `nobody:users`). |

Mount `/data` on the host. Without a mapping the data lives in an anonymous volume, which Unraid leaves
behind when it recreates the container on update. The container fixes the folder's ownership on start, then
drops root. To back up, copy the folder.

After 10 wrong admin tokens in 15 minutes, that address can't edit for 15 minutes. Use a long random token
(`openssl rand -hex 24`), especially if the site is public.

## Adding a race

1. **New race**, then enter the admin token at the bottom of the editor.
2. Add every `.txt` export. Long races are often split across two timing sessions; files for the same kart
   are merged by lap number. The kart number comes from the file name (`7 2.txt` is kart 7) because the
   header can show a different transponder, so check the Kart # column before **Add to race**.
3. For each kart, pick the team and the drivers in order, with the last lap each one drove. Leave the last
   driver's lap empty to mean "to the finish". The buttons under "Likely driver changes" fill in pit laps.
4. **Save race**.

Teams and drivers come from the Teams and Drivers pages. **New team…** and **New driver…** in the editor's
dropdowns add one without leaving the race. There is also a command-line importer:

```bash
node scripts/import.mjs --name "Saturday Enduro" --track "My Track" --date 2026-03-14 \
  --stints "7=Alex:52,Jordan:90,Sam" --team "7=Team Apex:#eb6834" \
  --out race.json exports/*.txt
```

[docs/data-format.md](docs/data-format.md) describes the export format, the stored JSON, and how pit and
slow laps are detected.

## Unraid

Install the template once from the terminal, then add the container from the Docker tab:

```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-karting-hub.xml \
  https://raw.githubusercontent.com/CobreDev/Karting-Hub/main/unraid/karting-hub.xml
```

**Add Container**, pick **karting-hub**, set the admin token and **Apply**. Data goes to
`/mnt/user/appdata/karting-hub`. [`docker-compose.yml`](docker-compose.yml) works with the Compose Manager
plugin instead.

### Sharing with Tailscale Funnel

The image works with Unraid's **Use Tailscale** option. In the Tailscale admin console, turn on MagicDNS and
HTTPS certificates. Then edit the container: turn on Use Tailscale, set Tailscale Serve to `Funnel` and the
serve port to `8080`, and apply. The container log prints a login link the first time. Set **Public URL** to
the resulting `https://<hostname>.<tailnet>.ts.net` address so link previews point there.

## Builds

[`.github/workflows/docker.yml`](.github/workflows/docker.yml) runs the tests, starts the image and checks
that it runs as 99:100 and can save a race, then publishes to `ghcr.io/cobredev/karting-hub` for amd64 and
arm64. Pushes to `main` publish `latest`; tags like `v1.2.3` publish `1.2.3`, `1.2` and `1`.

## Development

Node 20 or newer. There is nothing to install.

```bash
ADMIN_TOKEN=dev npm start   # http://localhost:8080
npm test
```

```
server.js              HTTP server and JSON API; data is files under DATA_DIR
public/app.js          entry point: theme toggle and first route
public/js/             UI modules: router, chart, photos, preview card, autosave, one file per page
public/lib/            parsing, stats, colors and image checks, shared with the server and tests
scripts/import.mjs     command-line importer
unraid/                container template and icon
```

API, all JSON. Writes need `Authorization: Bearer <ADMIN_TOKEN>`.

| | |
| --- | --- |
| `GET /api/races`, `GET /api/races/:id` | race list, one race |
| `PUT /api/races/:id`, `DELETE /api/races/:id` | save, delete a race |
| `GET /api/drivers`, `PUT /api/drivers` | driver list with colors |
| `POST /api/drivers/rename` | rename a driver in the list, every race, rosters and photo |
| `GET /api/teams`, `PUT /api/teams` | team list with colors and rosters |
| `POST /api/teams/rename` | rename a team in the list, every race and its photo |
| `GET /api/images`, `PUT`/`DELETE /api/images/:kind/:id` | photos and preview cards |
| `GET /api/config`, `GET /api/health` | whether editing is enabled; health check |

Race Monitor's own API needs approval from Race Monitor, so races are imported from the `.txt` exports.
Planned work is in [ROADMAP.md](ROADMAP.md).
