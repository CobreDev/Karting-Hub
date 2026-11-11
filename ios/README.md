# Karting Hub for iOS

Runs on iPhone and iPad.

A native SwiftUI app for the same server. It reads and writes the server's JSON API (`/api/races`,
`/api/drivers`, `/api/teams`, `/api/images`) and keeps nothing of its own except the server address and, in
admin mode, the admin token (in the Keychain).

- **Races**: every race on the server, newest first.
- **Race**: teams and the winner, fastest lap, most consistent driver, the drivers table, the lap-time chart
  (tap or drag for every team's time on a lap) and the lap-by-lap list per team. Tap a driver for their
  laps and pace spread. The share button sends the website link, which unfurls with the preview card.
- **Drivers** and **Teams**: photos, colors, rosters and race counts.
- **Settings** is hidden: press and hold the small "Karting Hub" logo above the race list for about a second
  and a half. It holds the server address (plain `http://` works for local addresses such as
  `http://192.168.1.20:8080`) and the **Admin mode** switch.
- **First launch**: there is no built-in server. A welcome screen asks for the address you open the website
  at and checks that it answers like a Karting Hub server before saving it.

## Admin mode

Turn it on in Settings and enter the server's `ADMIN_TOKEN` once; the app checks it with the server (wrong
tokens count toward the server's lockout) and keeps it in the Keychain, per server. "Forget the admin token"
removes it. With admin mode on, an "Admin" tag shows next to the logo and:

- **Races** gets a + button: name, track, date, slow-lap threshold, then import each kart's Race Monitor
  "lap times" `.txt` export from Files. Pick a team per kart and the drivers with the lap each one drove to
  (the last runs to the finish). "New team…" and "New driver…" create one on the spot. Saving uses the
  website's id rule (`date-name`) and asks before replacing a race with the same id.
- **A race** gets an Edit button: the same editor, plus Delete race.
- **Drivers** and **Teams** get a + button, and tapping a row edits it: rename (updates every race, roster
  and photo, like the website), color, photo (cropped to 256 px and uploaded as JPEG), roster roles, delete.

Link-preview cards are drawn by the website, not the app. After a change that affects a card, the app
removes that race's card; the website draws it again the next time you open the race there with the admin
token. Until then, shared links show the default card.

For Simulator testing, a Debug build reads a token from a launch default instead of the keyboard:
`xcrun simctl spawn booted defaults write com.cobredev.kartinghub debugAdminToken <token>`.

## Screens

Built for iOS 27.1 and later with the iOS 27.2 SDK. Layouts follow the room the page actually has, not the
device model, so the iPhone Duo's two screens, rotation and resizable scenes all adapt as they change:

- Under 560 points of content (any iPhone in portrait, the Duo's main screen): the phone layout.
- 560+: the race head sits beside the headline figures, the chart is taller, lap figures sit beside the
  stints table, and the drivers table adds Laps, Best 5 and Median.
- 760+ (the Duo's larger screen in landscape): race, driver and team lists go to two columns and the table
  adds Std dev.
- 900+: the pace-spread bar too, matching the website's desktop table.

## Building

Needs Xcode 27.2 or newer and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).
The Xcode project is generated from `project.yml` and isn't committed.

```bash
cd ios
xcodegen generate
open KartingHub.xcodeproj
```

To put it on your iPhone: in Xcode, select the KartingHub target, Signing & Capabilities, and choose your
team (a free Apple ID works). Plug in the phone, pick it as the run destination and press Run. With a free
Apple ID the app has to be re-installed from Xcode every 7 days; a paid developer account lasts a year and
can use TestFlight.

Tests:

```bash
xcodebuild -project KartingHub.xcodeproj -scheme KartingHub -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

## Releasing

1. Set `MARKETING_VERSION` in `project.yml` (and bump `CURRENT_PROJECT_VERSION`).
2. Run `scripts/build-ipa.sh`. It builds an unsigned release `.ipa` at `build/release/Karting-Hub-v<version>.ipa`.
3. Publish it on GitHub under the tag `ios-v<version>`, with the file named `Karting-Hub-v<version>.ipa`:

```bash
gh release create ios-v1.1 build/release/Karting-Hub-v1.1.ipa --title "Karting Hub for iOS 1.1"
```

Use the `ios-v` prefix, not `v`: tags starting with `v` publish a Docker image version. The `.ipa` stays unsigned
so it carries no Apple ID or device IDs; people sideload it with their own Apple ID (AltStore, Sideloadly).

## Code

| File | |
| --- | --- |
| `Hub.swift` | The server connection: address from Settings, API requests, photo URLs, team and driver colors. |
| `Models.swift` | The server's JSON, decoded leniently like the web app reads it. |
| `RaceMath.swift` | A port of `public/lib/race.js`: lap flags, driver stats, the winner rule, formatters. |
| `Theme.swift` | Hairline colors for light and dark, and a port of `teamShades` from `public/lib/color.js`. |
| `RaceView.swift`, `LapChart.swift` | The race page, its drivers table, chart and lap-by-lap list. |
| `PeopleViews.swift` | A driver in a race, and the Drivers and Teams tabs. |
| `WelcomeView.swift` | First launch: asks for the server address. |
| `SettingsView.swift` | Hidden settings: the server address, a connection check, admin mode. |
| `Admin.swift` | Keychain, the admin API calls, and a port of `parseRaceMonitor` / `mergeLaps` for imports. |
| `AdminViews.swift` | Driver, team and race editors. |

`RaceMath.swift` must give the same numbers as the website. When `public/lib/race.js` or `color.js` changes,
change the Swift port too and keep `KartingHubTests` in line with `test/race.test.js`.
