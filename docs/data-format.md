# Data formats

## Race Monitor lap export (input)

Race Monitor's per-competitor "lap times" export is plain text:

```
12 - #7 7                       <- finishing position, "#" + kart number, name
Laps: 125
Total time: 02:00:15.000
Best time: 00:49.250 in lap 19

Lap, Position, Time             <- one row per lap, newest first
125, 12, 02:09.400
124, 12, 00:50.118
...

http://www.race-monitor.com/Results/Session/1000002   <- session id
```

Quirks the parser (`parseRaceMonitor` in `public/lib/race.js`) handles:

- **Long races are split across timing sessions.** The same kart can have two files, e.g. laps 1–28
  in one session and laps 29–125 in the next. Files are merged per kart by lap number;
  if two files contain the same lap number the first one wins and the duplicate is reported.
- **The header number can be wrong.** In a split session the header may show a different
  transponder (`12 2.txt` can say `#99 99`). The kart number therefore comes from the **leading number
  of the file name** (`7 2.txt` → `7`) and falls back to the header. The upload screen shows both
  and flags mismatches.
- **Laps can be missing** when the timing loop misses a crossing (e.g. a kart with no laps 10–13).
  Gaps are kept as gaps: lines break, and the dashboard lists them.
- Times are `mm:ss.mmm`, or `h:mm:ss.mmm` for totals. Position may be absent.

## Race JSON (storage)

One file per race in `DATA_DIR/races/<id>.json`.

```jsonc
{
  "id": "2026-03-14-saturday-enduro",      // [a-z0-9-], must match the file name
  "name": "Saturday Enduro",
  "track": "My Track",
  "date": "2026-03-14",                    // YYYY-MM-DD
  "slowFactor": 1.1,                       // lap > 1.1 x the stint median = "slow"
  "karts": [
    {
      "number": "7",
      "team": "Team Apex",                 // optional
      "color": "#eb6834",                  // optional team color (hex); falls back to a palette slot
      "laps": [
        { "lap": 1, "pos": 10, "ms": 54200, "session": "1000001" }
      ],
      "stints": [                          // drivers in order; toLap = last lap they drove
        { "driver": "Alex",   "toLap": 52 },
        { "driver": "Jordan", "toLap": 90 },
        { "driver": "Sam",    "toLap": null }   // null / missing = to the finish
      ]
    }
  ]
}
```

## Driver list (storage)

`DATA_DIR/drivers.json` (created empty on first start) is shared by every race:

```json
{ "drivers": [ { "name": "Alex", "color": "#e34948" }, { "name": "Jordan", "color": "" } ] }
```

- Stints refer to drivers **by name**, matched ignoring case and surrounding spaces (`driverId`), so the same
  driver can be reused on different teams and in different races.
- `color` is optional. Empty means the driver uses their team's color, like their teammates. When set,
  the driver shows both: team color plus their own (a split swatch and a two-tone dashed chart line).
- New names from a saved race are added automatically. Colors are set in the race editor or on the
  **Drivers** page. `PUT /api/drivers` replaces the whole list.

## Team list (storage)

`DATA_DIR/teams.json` (created empty on first start) is shared by every race:

```json
{
  "teams": [
    {
      "name": "Team Apex",
      "color": "#eb6834",
      "members": [
        { "driver": "Alex", "role": "owner" },
        { "driver": "Sam", "role": "rotating" }
      ]
    }
  ]
}
```

- Races refer to teams **by name** (`kart.team`), matched like drivers (`driverId`).
- `color` is the team color everywhere. It wins over the older per-race `kart.color`, which is only used
  for karts without a saved team.
- `members` is the roster. Its drivers are picked from the driver list (removing a driver there also takes
  them off rosters). Roles (`ROLES` in `race.js`): `owner` and `core` are **bound**, so a driver can be
  owner/core of only one team. `rotating` drivers can be on any number of rosters. `teamListErrors()`
  enforces this in both the browser and `PUT /api/teams`.
- A roster is a list of who's on the team, not who drove: who drove is still each race's stints. The race
  editor offers roster drivers as one-click rows, and the Teams page offers drivers who raced for the
  team as one-click roster additions.

## Profile photos (storage)

`DATA_DIR/images/drivers/<id>.img` and `DATA_DIR/images/teams/<id>.img`, where `<id>` is
`imageId(name)`: the slugified driver or team name (`Team Apex` → `team-apex`). So a photo
follows the name across races, like personal colors do.

- The browser center-crops to a square and resizes to 256×256 before upload (`resizeImage` in `app.js`),
  encoding WebP, or JPEG where WebP encoding isn't available. A typical photo ends up 10–40 KB.
- The server only accepts WebP, JPEG or PNG (checked by magic bytes, not the upload's content type) up to 1 MB,
  and serves them with `X-Content-Type-Options: nosniff`.
- No database entry: `GET /api/images` lists the files, using each file's modification time as a
  cache-busting version.

### Derived values (computed in the browser, never stored)

`computeDrivers(race)` turns karts + stints into one entry per driver-per-kart and flags each lap:

| Flag | Rule | Effect |
| --- | --- | --- |
| `pit` | lap > 1.8 × that stint's median | Excluded from averages; red bar; "Pit / change" |
| `slow` | lap > `slowFactor` × that stint's median | Excluded from averages; yellow bar; dotted on the chart |
| `null` | everything else | "Clean" lap |

Best lap always uses every lap. Averages, median, std dev and percentiles use clean laps only.
A kart with no stints is treated as a single driver named `Kart <number>`.
