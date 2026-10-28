# Data formats

## Race Monitor export

Each kart's "lap times" export is a text file:

```
12 - #7 7                       finishing position, kart number, name
Laps: 125
Total time: 02:00:15.000
Best time: 00:49.250 in lap 19

Lap, Position, Time             one row per lap, newest first
125, 12, 02:09.400
124, 12, 00:50.118
...

http://www.race-monitor.com/Results/Session/1000002   session id
```

`parseRaceMonitor()` in `public/lib/race.js` reads it. Things to know about these files:

- A long race can be split across two timing sessions, so one kart may have two files (say laps 1–28 and
  29–125). Files for the same kart are merged by lap number. If two files contain the same lap, the first one
  wins and the editor reports the duplicate.
- In a split session the header can show another transponder number (`12 2.txt` saying `#99 99`). The kart
  number is therefore taken from the leading number of the file name, falling back to the header. The upload
  table shows both and marks a mismatch.
- Laps go missing when the timing loop misses a crossing. Gaps stay gaps: the chart line breaks and the race
  page lists them.
- Times are `mm:ss.mmm`, or `h:mm:ss.mmm` for totals. The position column can be absent.

## Races

One file per race, `DATA_DIR/races/<id>.json`:

```jsonc
{
  "id": "2026-03-14-saturday-enduro",   // [a-z0-9-], same as the file name
  "name": "Saturday Enduro",
  "track": "My Track",
  "date": "2026-03-14",
  "slowFactor": 1.1,                    // a lap over 1.1 × the stint median counts as slow
  "karts": [
    {
      "number": "7",
      "team": "Team Apex",              // optional, a name from teams.json
      "color": "#eb6834",               // optional, only used when the team isn't saved
      "laps": [{ "lap": 1, "pos": 10, "ms": 54200, "session": "1000001" }],
      "stints": [                       // in order; toLap is the driver's last lap
        { "driver": "Alex", "toLap": 52 },
        { "driver": "Jordan", "toLap": 90 },
        { "driver": "Sam", "toLap": null }   // null: to the finish
      ]
    }
  ]
}
```

## Drivers

`DATA_DIR/drivers.json`, shared by all races:

```json
{ "drivers": [{ "name": "Alex", "color": "#e34948" }, { "name": "Jordan", "color": "" }] }
```

Stints refer to drivers by name, compared case-insensitively with surrounding spaces ignored (`driverId`).
An empty color means the driver uses their team's color. A driver with a color shows both: a split swatch
and a two-tone line on the chart. `PUT /api/drivers` replaces the whole list.

## Teams

`DATA_DIR/teams.json`:

```json
{
  "teams": [
    {
      "name": "Team Apex",
      "color": "#eb6834",
      "members": [{ "driver": "Alex", "role": "owner" }, { "driver": "Sam", "role": "rotating" }]
    }
  ]
}
```

Races refer to teams by name, matched like drivers. The team's color is used in every race. `members` is the
roster and only contains drivers from `drivers.json`; removing a driver also removes them from rosters.
`owner` and `core` tie a driver to one team; `rotating` drivers can be on several. `teamListErrors()` checks
this in the browser and in `PUT /api/teams`.

A roster says who belongs to a team, not who drove. Who drove is in each race's stints. The editor lists the
team's roster first in its driver dropdowns.

## Photos

`DATA_DIR/images/drivers/<id>.img`, `images/teams/<id>.img` and `images/previews/<race id>.img`. For drivers
and teams, `<id>` is `imageId(name)`, the slugified name (`Team Apex` becomes `team-apex`), so a photo follows
the name across races.

The browser crops photos square and resizes them to 256×256 before uploading, as WebP where the browser
supports it and JPEG otherwise. The server accepts WebP, JPEG or PNG up to 1 MB, identified by the file's
first bytes. There is no index: `GET /api/images` lists the files and uses each file's modification time as
its cache-busting version.

## Lap flags

`computeDrivers(race)` produces one entry per driver per kart and flags each lap. Nothing here is stored.

| Flag | Rule | Effect |
| --- | --- | --- |
| `pit` | over 1.8 × the stint's median | left out of averages; red bar; "Pit" |
| `slow` | over `slowFactor` × the stint's median | left out of averages; yellow bar; dotted on the chart |
| none | anything else | clean lap |

The best lap is taken from all laps. Averages, median, standard deviation and percentiles use clean laps.
A kart without stints is treated as one driver called `Kart <number>`.
