# Roadmap

Ideas for later, roughly in the order they'd be most useful. Each is self-contained; pick any.

## Features

- **Driver profile pages** (`/drivers/<name>`): every race a driver has been in, best lap ever, average pace over
  time, teams raced for, and their photo/color. The driver list and race lineups already hold what's needed.
- **Team pages** (`/teams/<name>`): race history, best results, roster with roles, and the team's fastest laps.
- **Race results**: finishing order, laps completed and the gap between karts, plus a position-by-lap chart.
  Race Monitor exports include each lap's position (`pos`), which isn't used yet.
- **Head-to-head view**: pick two drivers (same race or across races) and compare best/average/consistency and
  lap-time spread side by side, with both on one chart.
- **Track records**: fastest lap ever at each track (`race.track`), with the driver, team and race.

## Data safety

- **Exports**: download a race as JSON or CSV (lap list with driver per lap) from the race page.
- **Backups**: one-click download of everything (races, drivers, teams, photos) as a zip, and a matching restore.
  Until then, copying the data folder (`/mnt/user/appdata/karting-hub`) is the backup.

## Code health

- **Tests for the server API**: start `server.js` on a temp data folder and exercise races, drivers, teams,
  images, the wrong-token lockout and link-preview tags. Only the shared logic in `public/lib/` is tested today.
- **Tests for the UI**: at least a smoke test that every page renders with odd data (no teams, no stints, missing
  rosters, long names), since that's where past bugs came from.
- **Organization**: split `public/app.js` (one large file) into modules per page (`race.js` dashboard, `editor.js`,
  `drivers.js`, `teams.js`, `preview.js`) with shared helpers, keeping the zero-dependency, no-build setup.
