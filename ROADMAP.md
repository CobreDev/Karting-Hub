# Roadmap

Planned work, roughly in order of usefulness. Each item stands on its own.

## Features

Driver pages (`/drivers/<name>`): every race a driver has been in, their best lap, how their pace has changed,
and which teams they raced for. The driver list and the race summaries already have this information.

Team pages (`/teams/<name>`): race history, best results, the roster, and the team's fastest laps.

Race results: finishing order, laps completed and the gap between karts, plus position by lap. The exports
record each lap's position (`pos`), which nothing uses yet.

Head-to-head: pick two drivers, from the same race or different ones, and compare best lap, average,
consistency and lap-time spread, with both on one chart.

Track records: the fastest lap at each track, with driver, team and race.

## Data

Export a race as JSON, or as CSV with one row per lap and the driver who drove it.

Back up and restore everything (races, drivers, teams, photos) as one download. Until then, copy the data
folder.

## Tests

Server tests: start `server.js` against a temporary data folder and cover races, drivers, teams, images, the
wrong-token lockout and the link-preview tags. Only `public/lib/` has tests today.

A UI smoke test that renders every page with awkward data: no teams, no stints, rosters missing, long names.
Most past bugs were in that area.
