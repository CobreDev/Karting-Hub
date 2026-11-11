import SwiftUI

/// One driver in one race: their numbers, pace spread and every lap.
struct DriverRaceView: View {
  let data: RaceData
  let entry: DriverEntry

  var body: some View {
    let d = entry
    let rank = (data.ranked.firstIndex(of: d) ?? 0) + 1
    let lo = data.ranked.map(\.best).min() ?? d.best
    let hi = data.ranked.map { $0.p90.isNaN ? $0.best : $0.p90 }.max() ?? d.best
    let scaleMax = min(d.laps.map(\.ms).max() ?? 1, d.median * 3.2)
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 14) {
          data.avatar(d, size: 56)
          VStack(alignment: .leading, spacing: 3) {
            Text(d.driver).font(.pageTitle).foregroundStyle(Color.textPrimary)
            Text("\(d.teamLabel)\(d.team.isEmpty ? "" : " #\(d.kart)") · laps \(d.stintText)")
              .font(.subheadline).foregroundStyle(Color.textSecondary)
          }
        }
        .padding(.top, 8)

        let best = Figure(label: "Best lap", value: Fmt.time(d.best), detail: "lap \(d.bestLapNo) · \(ordinal(rank)) of \(data.ranked.count)")
        let average = Figure(label: "Average", value: Fmt.time(d.avg), detail: "\(d.cleanCount) clean of \(d.count) laps")
        let top5 = Figure(label: "Best 5 average", value: Fmt.time(d.top5))
        let stdev = Figure(label: "Std dev", value: "±" + String(format: "%.3f", d.stdev / 1000)) {
          HelpButton(title: "Consistency (std dev)", text: stdevHelp)
        }
        FigureGrid(a: best, b: average, c: top5, d: stdev).padding(.top, 22)

        HairlineSection(title: "Pace spread") {
          HStack(alignment: .center) {
            SpreadBar(entry: d, color: data.color(d), lo: lo, hi: hi).frame(height: 18)
            HelpButton(title: "Pace spread", text: spreadHelp)
          }
          Text("Best \(Fmt.time(d.best)), median \(Fmt.time(d.median)), middle 80% of clean laps \(Fmt.time(d.p10))–\(Fmt.time(d.p90)).")
            .font(.label).foregroundStyle(Color.textSecondary)
        }

        HairlineSection(title: "Laps") {
          LazyVStack(spacing: 0) {
            LapRowHeader(showDriver: false)
            ForEach(Array(d.laps.enumerated()), id: \.element.lap) { i, l in
              let p = i > 0 ? d.laps[i - 1] : nil
              LapRow(lap: l, driver: d, color: data.color(d), driverBest: d.bestLap,
                     prev: p.flatMap { $0.lap == l.lap - 1 ? $0.ms : nil }, scaleMax: scaleMax, data: data, showDriver: false)
            }
            LapLegend().padding(.top, 10)
          }
        }
      }
      .page()
    }
    .background(Color.bg)
    .navigationTitle("")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func ordinal(_ n: Int) -> String {
    let suffix = (11...13).contains(n % 100) ? "th" : [1: "st", 2: "nd", 3: "rd"][n % 10] ?? "th"
    return "\(n)\(suffix)"
  }
}

/// Best lap as a dot, the middle 80% of clean laps as a bar, the median as a tick, all on a shared scale.
struct SpreadBar: View {
  let entry: DriverEntry
  let color: Color
  let lo: Double
  let hi: Double

  var body: some View {
    Canvas { ctx, size in
      let pad = 6.0
      let x = { (ms: Double) in pad + (ms - lo) / max(1, hi - lo) * (size.width - 2 * pad) }
      let mid = size.height / 2
      if !entry.p10.isNaN {
        var bar = Path(); bar.move(to: CGPoint(x: x(entry.p10), y: mid)); bar.addLine(to: CGPoint(x: x(entry.p90), y: mid))
        ctx.stroke(bar, with: .color(color.opacity(0.45)), style: StrokeStyle(lineWidth: 6, lineCap: .round))
        var tick = Path(); tick.move(to: CGPoint(x: x(entry.median), y: mid - 6)); tick.addLine(to: CGPoint(x: x(entry.median), y: mid + 6))
        ctx.stroke(tick, with: .color(color), lineWidth: 2)
      }
      let dot = CGRect(x: x(entry.best) - 5, y: mid - 5, width: 10, height: 10)
      ctx.fill(Path(ellipseIn: dot.insetBy(dx: -2, dy: -2)), with: .color(.bg))
      ctx.fill(Path(ellipseIn: dot), with: .color(color))
    }
    .accessibilityLabel("Best \(Fmt.time(entry.best)), median \(Fmt.time(entry.median))")
  }
}

// MARK: - Drivers tab

struct DriversView: View {
  @Environment(Hub.self) private var hub
  @State private var editing: DriverRecord?
  @State private var adding = false

  var body: some View {
    Loadable(key: hub.revision, load: {
      async let races = hub.races()
      try await hub.loadLists()
      return try await races
    }) { races in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          Text("Photos and colors follow a driver into every race.")
            .font(.subheadline).foregroundStyle(Color.textSecondary).padding(.bottom, 12)
          if hub.drivers.isEmpty {
            ContentUnavailableView("No drivers yet", systemImage: "person.2", description: Text("Add drivers on the website."))
          }
          Columns {
            ForEach(hub.drivers, id: \.name) { d in
              VStack(spacing: 0) {
                DriverRow(driver: d, races: races.filter { $0.drivers.contains { driverId($0) == driverId(d.name) } })
                  .contentShape(Rectangle())
                  .onTapGesture { if hub.isAdmin { editing = d } }
                  .accessibilityAddTraits(hub.isAdmin ? .isButton : [])
                Rule(color: .grid)
              }
            }
          }
        }
        .page()
      }
    }
    .background(Color.bg)
    .navigationTitle("Drivers")
    .toolbar {
      if hub.isAdmin { Button { adding = true } label: { Label("Add driver", systemImage: "plus") } }
    }
    .sheet(item: $editing) { DriverEditor(original: $0) }
    .sheet(isPresented: $adding) { DriverEditor(original: nil) }
  }
}

private struct DriverRow: View {
  @Environment(Hub.self) private var hub
  let driver: DriverRecord
  let races: [RaceSummary]

  var body: some View {
    let teams = hub.teamsFor(driver: driver.name)
    let teamColor = teams.first.flatMap { TeamColors.isHex($0.team.color) ? Color(identity: $0.team.color) : nil }
    let own = TeamColors.isHex(driver.color) ? Color(identity: driver.color) : nil
    HStack(alignment: .top, spacing: 12) {
      Avatar(kind: "drivers", name: driver.name, size: 44, ring: own ?? teamColor ?? .rule, second: own != nil ? teamColor : nil)
      VStack(alignment: .leading, spacing: 5) {
        Text(driver.name).font(.itemTitle).foregroundStyle(Color.textPrimary)
        if !teams.isEmpty {
          FlowLayout(spacing: 8, lineSpacing: 4) {
            ForEach(teams, id: \.team.name) { t in
              HStack(spacing: 5) {
                Avatar(kind: "teams", name: t.team.name, size: 18, ring: TeamColors.isHex(t.team.color) ? Color(identity: t.team.color) : .rule)
                Text(t.team.name).font(.subheadline).foregroundStyle(Color.textSecondary)
                Tag(text: t.role.label)
              }
            }
          }
        }
        Text(raceCount(races))
          .font(.label).foregroundStyle(Color.textMuted).lineLimit(2)
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 12)
  }
}

// MARK: - Teams tab

struct TeamsView: View {
  @Environment(Hub.self) private var hub
  @State private var editing: TeamRecord?
  @State private var adding = false

  var body: some View {
    Loadable(key: hub.revision, load: {
      async let races = hub.races()
      try await hub.loadLists()
      return try await races
    }) { races in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          Text("Owners and core drivers belong to one team. Rotating drivers can be on several.")
            .font(.subheadline).foregroundStyle(Color.textSecondary).padding(.bottom, 12)
          if hub.teams.isEmpty {
            ContentUnavailableView("No teams yet", systemImage: "person.3", description: Text("Add teams on the website."))
          }
          Columns {
            ForEach(hub.teams, id: \.name) { t in
              VStack(spacing: 0) {
                TeamRow(team: t, races: races.filter { $0.lineups.contains { driverId($0.team) == driverId(t.name) } })
                  .contentShape(Rectangle())
                  .onTapGesture { if hub.isAdmin { editing = t } }
                  .accessibilityAddTraits(hub.isAdmin ? .isButton : [])
                Rule(color: .grid)
              }
            }
          }
        }
        .page()
      }
    }
    .background(Color.bg)
    .navigationTitle("Teams")
    .toolbar {
      if hub.isAdmin { Button { adding = true } label: { Label("Add team", systemImage: "plus") } }
    }
    .sheet(item: $editing) { TeamEditor(original: $0) }
    .sheet(isPresented: $adding) { TeamEditor(original: nil) }
  }
}

private struct TeamRow: View {
  @Environment(Hub.self) private var hub
  let team: TeamRecord
  let races: [RaceSummary]

  var body: some View {
    let color = TeamColors.isHex(team.color) ? Color(identity: team.color) : Color.rule
    HStack(alignment: .top, spacing: 12) {
      Avatar(kind: "teams", name: team.name, size: 44, ring: color)
      VStack(alignment: .leading, spacing: 6) {
        Text(team.name).font(.itemTitle).foregroundStyle(Color.textPrimary)
        if team.members.isEmpty {
          Text("No roster yet").font(.subheadline).foregroundStyle(Color.textMuted)
        } else {
          FlowLayout(spacing: 10, lineSpacing: 6) {
            ForEach(team.members.sorted { ($0.role, $0.driver) < ($1.role, $1.driver) }, id: \.driver) { m in
              let own = hub.ownHex(m.driver).map { Color(identity: $0) }
              HStack(spacing: 5) {
                Avatar(kind: "drivers", name: m.driver, size: 20, ring: own ?? color, second: own != nil ? color : nil)
                Text(m.driver).font(.subheadline).foregroundStyle(Color.textPrimary)
                Tag(text: m.role.label)
              }
            }
          }
        }
        Text(raceCount(races))
          .font(.label).foregroundStyle(Color.textMuted).lineLimit(2)
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 12)
  }
}

/// "2 races, latest Sat, Oct 17, 2026". Race names repeat (the same event every season), so dates say more.
func raceCount(_ races: [RaceSummary]) -> String {
  guard let latest = races.first else { return "No races yet" }
  return "\(races.count) race\(races.count == 1 ? "" : "s"), latest \(Fmt.raceDate(latest.date))"
}

extension DriverRecord: Identifiable { var id: String { driverId(name) } }
extension TeamRecord: Identifiable { var id: String { driverId(name) } }
