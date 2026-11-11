import SwiftUI

struct RaceView: View {
  @Environment(Hub.self) private var hub
  @Environment(\.dismiss) private var dismiss
  let id: String
  let title: String
  @State private var editing: RaceDraft?
  @State private var loaded: Race?

  var body: some View {
    Loadable(key: hub.revision, load: {
      async let race = hub.race(id)
      if hub.drivers.isEmpty && hub.teams.isEmpty { try? await hub.loadLists() }
      let r = try await race
      loaded = r
      return r
    }) { race in
      RaceContent(race: race, hub: hub)
    }
    .background(Color.bg)
    .navigationTitle("")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if hub.isAdmin, let loaded {
        Button("Edit") { editing = RaceDraft(loaded) }
      }
      ShareLink(item: hub.webURL("r/\(id)")) { Label("Share", systemImage: "square.and.arrow.up") }
    }
    .sheet(item: $editing) { RaceEditor(draft: $0, isNew: false, onDelete: { dismiss() }) }
  }
}

// MARK: - Prepared data

/// A lap with the driver who drove it.
struct RunLap: Identifiable, Hashable {
  let lap: FlaggedLap
  let driver: DriverEntry
  var id: Int { lap.lap }
}

/// Consecutive laps by one driver.
struct Chunk: Identifiable, Hashable {
  let driver: DriverEntry
  let laps: [RunLap]
  var id: Int { laps[0].lap.lap }
  var from: Int { laps.first!.lap.lap }
  var to: Int { laps.last!.lap.lap }
  var best: FlaggedLap { laps.map(\.lap).min { $0.ms < $1.ms }! }
  var avg: Double { let c = laps.map(\.lap).filter { $0.flag == nil }.map(\.ms); return c.reduce(0, +) / Double(c.count) }
}

/// One kart: every lap tagged with its driver, and the driver chunks. Used by the chart and the lap list.
struct KartRun: Identifiable {
  let index: Int
  let kart: Kart
  let color: Color
  let laps: [RunLap]
  let chunks: [Chunk]
  var id: String { kart.number }
}

@MainActor
struct RaceData {
  let race: Race
  let drivers: [DriverEntry]
  let ranked: [DriverEntry]
  let runs: [KartRun]
  let winner: KartRun?
  private let teamColors: [String: Color]
  private let ownColors: [String: Color]

  init(race: Race, hub: Hub) {
    self.race = race
    drivers = RaceMath.computeDrivers(race)
    ranked = drivers.sorted { $0.best < $1.best }
    var tc: [String: Color] = [:]
    for (i, k) in race.karts.enumerated() { tc[k.number] = Color(identity: hub.teamHex(k, i)) }
    teamColors = tc
    var oc: [String: Color] = [:]
    for d in drivers { if let hex = hub.ownHex(d.driver) { oc[d.key] = Color(identity: hex) } }
    ownColors = oc
    let drivers = drivers
    let runs: [KartRun] = race.karts.enumerated().map { i, k in
      let laps = drivers.filter { $0.kart == k.number }
        .flatMap { d in d.laps.map { RunLap(lap: $0, driver: d) } }
        .sorted { $0.lap.lap < $1.lap.lap }
      var chunks: [Chunk] = []
      var current: [RunLap] = []
      for l in laps {
        if let last = current.last, last.driver != l.driver { chunks.append(Chunk(driver: last.driver, laps: current)); current = [] }
        current.append(l)
      }
      if let last = current.last { chunks.append(Chunk(driver: last.driver, laps: current)) }
      return KartRun(index: i, kart: k, color: tc[k.number] ?? .textMuted, laps: laps, chunks: chunks)
    }
    self.runs = runs
    winner = RaceMath.winner(race.karts).map { runs[$0] }
  }

  func teamColor(_ d: DriverEntry) -> Color { teamColors[d.kart] ?? .textMuted }
  /// The driver's own color if they have one, else exactly the team color, so teammates match.
  func color(_ d: DriverEntry) -> Color { ownColors[d.key] ?? teamColor(d) }
  func hasOwnColor(_ d: DriverEntry) -> Bool { ownColors[d.key] != nil }

  @ViewBuilder func avatar(_ d: DriverEntry, size: CGFloat = 30) -> some View {
    Avatar(kind: "drivers", name: d.driver, size: size, ring: color(d), second: hasOwnColor(d) ? teamColor(d) : nil)
  }
}

// MARK: - Page

private struct RaceContent: View {
  let data: RaceData
  @State private var hidden: Set<String> = []
  @State private var lapKart: String?
  @State private var newestFirst = false

  init(race: Race, hub: Hub) { data = RaceData(race: race, hub: hub) }

  var body: some View {
    let race = data.race
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        VStack(alignment: .leading, spacing: 6) {
          Text(race.name).font(.pageTitle).foregroundStyle(Color.textPrimary)
          Text([Fmt.raceDate(race.date), race.track].filter { !$0.isEmpty }.joined(separator: " · "))
            .font(.subheadline).foregroundStyle(Color.textSecondary)
        }
        .padding(.top, 8)

        // side by side on a wide screen, like the website's race head
        AdaptiveStack {
          entries.frame(maxWidth: .infinity, alignment: .leading)
          figures.frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, 20)

        HairlineSection(title: "Drivers",
                        note: "Averages leave out pit laps and laps more than \(Int(((race.slowFactor ?? defaultSlowFactor) - 1) * 100 + 0.5))% off the driver's median.") {
          DriverTable(data: data)
        }

        HairlineSection(title: "Lap times") {
          chips
          LapChart(runs: data.runs.filter { !hidden.contains($0.id) }, all: data.runs, data: data)
        }

        HairlineSection(title: "Lap by lap") {
          LapBook(data: data, selected: $lapKart, newestFirst: $newestFirst)
        }

        let gaps = race.karts.compactMap { k -> String? in
          let miss = RaceMath.missingLaps(k.laps)
          return miss.isEmpty ? nil : "#\(k.number) lap\(miss.count > 1 ? "s" : "") \(miss.map(String.init).joined(separator: ", "))"
        }
        if !gaps.isEmpty {
          Text("No timing data for \(gaps.joined(separator: "; ")).")
            .font(.caption12).foregroundStyle(Color.textMuted).padding(.top, 24)
        }
      }
      .page()
    }
  }

  private var entries: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(data.runs) { r in
        HStack(spacing: 12) {
          Avatar(kind: "teams", name: r.kart.team.isEmpty ? r.kart.number : r.kart.team, size: 40, ring: r.color)
          VStack(alignment: .leading, spacing: 2) {
            Text("\(Text(r.kart.label).font(.itemTitle).foregroundStyle(Color.textPrimary))\(Text(r.kart.team.isEmpty ? "" : "  #\(r.kart.number)").font(.subheadline).foregroundStyle(Color.textMuted))")
            Text(data.drivers.filter { $0.kart == r.kart.number }.map(\.driver).joined(separator: ", "))
              .font(.subheadline).foregroundStyle(Color.textSecondary)
          }
          Spacer(minLength: 0)
          if r.id == data.winner?.id && data.runs.count > 1 { Tag(text: "Winner", color: .good) }
        }
      }
    }
  }

  private var figures: some View {
    let fastest = data.ranked.first
    let consistent = data.drivers.filter { $0.cleanCount >= 10 }.min { $0.stdev < $1.stdev }
    let karts = data.race.karts
    return HStack(alignment: .top, spacing: 16) {
      if let fastest {
        Figure(label: "Fastest lap", value: Fmt.time(fastest.best), detail: "\(fastest.driver), lap \(fastest.bestLapNo)")
      }
      if let consistent {
        Figure(label: "Most consistent", value: "±" + String(format: "%.3f", consistent.stdev / 1000), detail: consistent.driver) {
          HelpButton(title: "Consistency (std dev)", text: stdevHelp)
        }
      }
      Figure(label: "Laps", value: "\(karts.map(\.lastLap).max() ?? 0)",
             detail: karts.count > 1 && karts.count <= 4 ? karts.map { "#\($0.number) \($0.lastLap)" }.joined(separator: ", ") : "\(karts.count) kart\(karts.count == 1 ? "" : "s")")
    }
  }

  private var chips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        ForEach(data.runs) { r in
          let on = !hidden.contains(r.id)
          Button {
            if on { hidden.insert(r.id) } else { hidden.remove(r.id) }
          } label: {
            HStack(spacing: 7) {
              RoundedRectangle(cornerRadius: 2).fill(r.color).frame(width: 10, height: 10).opacity(on ? 1 : 0.2)
              Text(r.kart.label).foregroundStyle(on ? Color.textPrimary : Color.textMuted)
              Text("#\(r.kart.number)").foregroundStyle(Color.textMuted)
            }
            .font(.system(size: 13))
            .padding(.horizontal, 10).frame(height: 30)
            .background(RoundedRectangle(cornerRadius: 6).fill(on ? Color.surface1 : .clear))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.rule))
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(on ? .isSelected : [])
        }
      }
    }
  }
}

let stdevHelp = """
The standard deviation of a driver's clean laps, with pit stops and slow laps left out. It's the typical distance \
between one of their laps and their own average.

For example, ±0.450 means most clean laps were within about half a second of the driver's average. Smaller is more \
consistent. It says nothing about speed: a slow, steady driver can score better than a fast, erratic one.
"""

let spreadHelp = """
The dot is the driver's best lap. The bar covers the middle 80% of their clean laps (10th to 90th percentile) and \
the tick marks the median. Every driver is drawn on the same scale, so further left is faster and a shorter bar is \
more consistent.
"""

// MARK: - Drivers table

private struct DriverTable: View {
  @Environment(\.isWide) private var wide
  @Environment(\.isWider) private var wider
  let data: RaceData

  var body: some View {
    let ranked = data.ranked
    // every driver's spread bar shares one scale, as on the website
    let lo = ranked.map(\.best).min() ?? 0
    let hi = ranked.map { $0.p90.isNaN ? $0.best : $0.p90 }.max() ?? 1
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        Text("#").frame(width: 18, alignment: .trailing)
        Text("Driver").frame(maxWidth: .infinity, alignment: .leading)
        if wide { Text("Laps").frame(width: 44, alignment: .trailing) }
        Text("Best").frame(width: 62, alignment: .trailing)
        Text("Gap").frame(width: 56, alignment: .trailing)
        if wide { Text("Best 5").frame(width: 62, alignment: .trailing) }
        Text("Avg").frame(width: 62, alignment: .trailing)
        if wide { Text("Median").frame(width: 62, alignment: .trailing) }
        if wider {
          HStack(spacing: 3) { Text("Std dev"); HelpButton(title: "Consistency (std dev)", text: stdevHelp) }
            .frame(width: 84, alignment: .trailing)
        }
        if wider {
          HStack(spacing: 3) { Text("Pace spread"); HelpButton(title: "Pace spread", text: spreadHelp) }
            .frame(minWidth: 120, maxWidth: 220, alignment: .leading).padding(.leading, 8)
        }
      }
      .font(.caption12).foregroundStyle(Color.textMuted)
      .padding(.bottom, 6)
      Rule(bleed: true)
      ForEach(Array(ranked.enumerated()), id: \.element.id) { i, d in
        NavigationLink {
          DriverRaceView(data: data, entry: d)
        } label: {
          HStack(spacing: 8) {
            Text("\(i + 1)").foregroundStyle(Color.textMuted).frame(width: 18, alignment: .trailing)
            HStack(spacing: 9) {
              data.avatar(d)
              VStack(alignment: .leading, spacing: 1) {
                Text(d.driver).font(.subheadline.weight(.semibold)).foregroundStyle(Color.textPrimary).lineLimit(2)
                Text(d.teamLabel).font(.caption12).foregroundStyle(Color.textMuted).lineLimit(1)
              }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if wide { Text("\(d.count)").foregroundStyle(Color.textPrimary).frame(width: 44, alignment: .trailing) }
            Text(Fmt.time(d.best)).fontWeight(i == 0 ? .semibold : .regular)
              .foregroundStyle(i == 0 ? Color.good : Color.textPrimary).frame(width: 62, alignment: .trailing)
            Text(i == 0 ? "—" : Fmt.delta(d.best - ranked[0].best)).foregroundStyle(Color.textMuted).frame(width: 56, alignment: .trailing)
            if wide { Text(Fmt.time(d.top5)).foregroundStyle(Color.textPrimary).frame(width: 62, alignment: .trailing) }
            Text(Fmt.time(d.avg)).foregroundStyle(Color.textPrimary).frame(width: 62, alignment: .trailing)
            if wide { Text(Fmt.time(d.median)).foregroundStyle(Color.textPrimary).frame(width: 62, alignment: .trailing) }
            if wider { Text("±" + String(format: "%.3f", d.stdev / 1000)).foregroundStyle(Color.textPrimary).frame(width: 84, alignment: .trailing) }
            if wider { SpreadBar(entry: d, color: data.color(d), lo: lo, hi: hi).frame(minWidth: 120, maxWidth: 220).frame(height: 18).padding(.leading, 8) }
          }
          .font(.subheadline.monospacedDigit())
          .padding(.vertical, 9)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        if i < ranked.count - 1 { Rule(color: .grid, bleed: true) }
      }
    }
  }
}

// MARK: - Lap by lap

private struct LapBook: View {
  let data: RaceData
  @Binding var selected: String?
  @Binding var newestFirst: Bool

  var body: some View {
    let run = data.runs.first { $0.id == selected } ?? data.winner ?? data.runs.first
    VStack(alignment: .leading, spacing: 16) {
      if data.runs.count > 1 {
        let pick = Binding(get: { run?.id ?? "" }, set: { selected = $0 })
        if data.runs.count <= 3 { teamPicker(pick).pickerStyle(.segmented) } else { teamPicker(pick).pickerStyle(.menu) }
      }
      if let run, !run.laps.isEmpty { KartLaps(data: data, run: run, newestFirst: $newestFirst) }
      else { Text("No laps yet.").foregroundStyle(Color.textMuted) }
    }
  }

  private func teamPicker(_ selection: Binding<String>) -> some View {
    Picker("Team", selection: selection) {
      ForEach(data.runs) { r in Text("\(r.kart.label) #\(r.kart.number)").tag(r.id) }
    }
  }
}

private struct KartLaps: View {
  @Environment(\.isWider) private var wide
  let data: RaceData
  let run: KartRun
  @Binding var newestFirst: Bool

  var body: some View {
    let fastest = data.runs.flatMap(\.laps).map(\.lap.ms).min() ?? 0
    let best = run.laps.map(\.lap).min { $0.ms < $1.ms }!
    let total = run.laps.reduce(0) { $0 + $1.lap.ms }
    let med = RaceMath.quantile(run.laps.map(\.lap.ms), 0.5)
    // cap the bar scale so one long pit stop doesn't flatten every other bar
    let scaleMax = min(run.laps.map(\.lap.ms).max() ?? 1, med * 3.2)
    var rows: [(RunLap, Chunk, Double?)] = run.chunks.flatMap { c in
      c.laps.enumerated().map { i, l in
        let p = i > 0 ? c.laps[i - 1] : nil
        return (l, c, p.flatMap { $0.lap.lap == l.lap.lap - 1 ? $0.lap.ms : nil })
      }
    }
    if newestFirst { rows.reverse() }

    let figures = Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 12) {
        GridRow {
          Figure(label: "Laps", value: "\(run.laps.count)")
          Figure(label: "Lap time total", value: String(Fmt.time(total).split(separator: ".").first ?? ""))
        }
        GridRow {
          Figure(label: "Best lap", value: Fmt.time(best.ms), detail: "lap \(best.lap)")
          Figure(label: "Gap to fastest", value: best.ms == fastest ? "—" : Fmt.delta(best.ms - fastest))
        }
      }
    let stints = VStack(spacing: 0) {
        HStack {
          Text("Driver").frame(maxWidth: .infinity, alignment: .leading)
          Text("Laps").frame(width: 70, alignment: .trailing)
          Text("Best").frame(width: 62, alignment: .trailing)
          Text("Avg").frame(width: 62, alignment: .trailing)
        }
        .font(.caption12).foregroundStyle(Color.textMuted).padding(.bottom, 6)
        Rule(bleed: true)
        ForEach(run.chunks) { c in
          HStack {
            HStack(spacing: 8) { data.avatar(c.driver, size: 22); Text(c.driver.driver).lineLimit(1) }
              .frame(maxWidth: .infinity, alignment: .leading)
            Text("\(c.from)–\(c.to)").frame(width: 70, alignment: .trailing)
            Text(Fmt.time(c.best.ms)).frame(width: 62, alignment: .trailing)
            Text(Fmt.time(c.avg)).frame(width: 62, alignment: .trailing)
          }
          .font(.subheadline.monospacedDigit()).foregroundStyle(Color.textPrimary)
          .padding(.vertical, 7)
          Rule(color: .grid, bleed: true)
        }
      }

    return VStack(alignment: .leading, spacing: 16) {
      if wide {
        HStack(alignment: .top, spacing: 40) { figures.frame(maxWidth: 420, alignment: .leading); stints }
      } else {
        figures
        stints
      }

      HStack {
        Spacer()
        Button(newestFirst ? "Oldest first" : "Newest first") { newestFirst.toggle() }
          .font(.subheadline).buttonStyle(.bordered).tint(Color.textPrimary)
      }

      LazyVStack(spacing: 0) {
        LapRowHeader(showDriver: true)
        ForEach(rows, id: \.0.id) { l, c, prev in
          let handover = newestFirst ? (l.lap.lap == c.to && c != run.chunks.last) : (l.lap.lap == c.from && c != run.chunks.first)
          if handover { Rule(color: data.color(c.driver), height: 2, bleed: true) }
          LapRow(lap: l.lap, driver: c.driver, color: data.color(c.driver), driverBest: c.best, prev: prev,
                 scaleMax: scaleMax, data: data, showDriver: true)
        }
        LapLegend().padding(.top, 10)
      }
    }
  }
}

struct LapRowHeader: View {
  @Environment(\.isWide) private var wide
  let showDriver: Bool
  var body: some View {
    VStack(spacing: 6) {
      HStack(spacing: wide ? 12 : 6) {
        Text("Lap").frame(width: 30, alignment: .trailing)
        Text("Pos").frame(width: 26, alignment: .trailing)
        if showDriver {
          Text("Driver").frame(minWidth: wide ? 130 : 0, maxWidth: wide ? 220 : .infinity, alignment: .leading)
        }
        if wide { Text("Time").frame(minWidth: 80, maxWidth: .infinity, alignment: .leading) }
        else { Text("Time").frame(width: 76, alignment: .leading) }
        Text("Δ best").frame(width: 58, alignment: .trailing)
        Text("Δ prev").frame(width: wide ? 74 : 58, alignment: .trailing)
        if wide { Text("").frame(width: 44) }
        if !showDriver { Spacer(minLength: 0) }
      }
      .font(.caption12).foregroundStyle(Color.textMuted)
      Rule(bleed: true)
    }
  }
}

/// One lap, Race Monitor style: a status bar under the time, deltas, and a tag for pit, slow and best laps.
/// On a wide page the driver gets their full name and photo, the bar gets room to show the difference between
/// laps, and the tag has its own column so Δ best always shows a number.
struct LapRow: View {
  @Environment(\.isWide) private var wide
  let lap: FlaggedLap
  let driver: DriverEntry
  let color: Color
  let driverBest: FlaggedLap
  let prev: Double?
  let scaleMax: Double
  let data: RaceData
  let showDriver: Bool

  var body: some View {
    let isBest = lap.lap == driverBest.lap
    let status: Color = lap.flag == .pit ? .statusCrit : lap.flag == .slow ? .statusWarn : .statusGood
    let dPrev = prev.map { lap.ms - $0 }
    let tag: Tag? = isBest ? Tag(text: "Best", color: .good) : lap.flag == .pit ? Tag(text: "Pit") : lap.flag == .slow ? Tag(text: "Slow") : nil
    HStack(spacing: wide ? 12 : 6) {
      Text("\(lap.lap)").foregroundStyle(Color.textPrimary).frame(width: 30, alignment: .trailing)
      Text(lap.pos.map(String.init) ?? "").foregroundStyle(Color.textMuted).frame(width: 26, alignment: .trailing)
      if showDriver {
        HStack(spacing: wide ? 8 : 6) {
          if wide { data.avatar(driver, size: 22) } else { RoundedRectangle(cornerRadius: 1).fill(color).frame(width: 3, height: 18) }
          Text(wide ? driver.driver : Fmt.shortName(driver.driver)).font(.footnote.weight(.semibold))
            .foregroundStyle(Color.textPrimary).lineLimit(1)
        }
        .frame(minWidth: wide ? 130 : 0, maxWidth: wide ? 220 : .infinity, alignment: .leading)
      }
      VStack(alignment: .leading, spacing: 3) {
        Text(Fmt.time(lap.ms)).fontWeight(isBest ? .semibold : .regular)
          .foregroundStyle(isBest ? Color.good : Color.textPrimary)
        GeometryReader { g in
          Rectangle().fill(status).frame(width: g.size.width * min(1, lap.ms / scaleMax))
        }
        .frame(height: 3)
      }
      // on a wide page the time column takes the spare room, so the bar shows differences between laps
      .frame(minWidth: wide ? 80 : 76, maxWidth: wide ? .infinity : 76, alignment: .leading)
      Group {
        if !wide, let tag { tag }
        else if isBest { Text("—").foregroundStyle(Color.textMuted) }
        else { Text(Fmt.delta(lap.ms - driverBest.ms)).foregroundStyle(Color.textSecondary) }
      }
      .lineLimit(1).minimumScaleFactor(0.6)
      .frame(width: 58, alignment: .trailing)
      Text(dPrev.map { ($0 < 0 ? "▼ " : "▲ ") + String(format: "%.3f", abs($0) / 1000) } ?? "")
        .foregroundStyle(dPrev.map { $0 < 0 ? Color.good : Color.textMuted } ?? .clear)
        .lineLimit(1).minimumScaleFactor(0.6)
        .frame(width: wide ? 74 : 58, alignment: .trailing)
      if wide { Group { if let tag { tag } }.frame(width: 44, alignment: .trailing) }
      if !showDriver { Spacer(minLength: 0) }
    }
    .font(.footnote.monospacedDigit())
    .padding(.vertical, 6)
    .overlay(alignment: .bottom) { Rule(color: .grid, bleed: true) }
    .accessibilityElement(children: .combine)
  }
}

struct LapLegend: View {
  var body: some View {
    HStack(spacing: 14) {
      key(.statusGood, "Clean"); key(.statusWarn, "Slow"); key(.statusCrit, "Pit")
      Spacer(minLength: 0)
    }
    .font(.caption12).foregroundStyle(Color.textMuted)
  }
  private func key(_ c: Color, _ s: String) -> some View {
    HStack(spacing: 6) { Rectangle().fill(c).frame(width: 16, height: 3); Text(s) }
  }
}

extension RaceDraft: Identifiable {}
