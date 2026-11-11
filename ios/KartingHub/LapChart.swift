import Charts
import SwiftUI

/// Lap time by lap number, one line per kart. Pit laps are off the scale: a gray dashed bridge joins the laps
/// either side. Legs touching a slow lap are dotted. Drag across it for every kart's driver and time on a lap.
struct LapChart: View {
  let runs: [KartRun]
  let all: [KartRun]
  let data: RaceData
  @Environment(\.isWide) private var wide
  @Environment(\.trailingInset) private var trailingInset
  @State private var width: CGFloat = 0
  @State private var selectedLap: Int?
  /// The last lap scrubbed to. It stays after the finger lifts so the times can be read.
  @State private var shownLap: Int?

  private struct Leg: Identifiable {
    enum Kind { case normal, slow, bridge }
    let id: String
    let a: FlaggedLap
    let b: FlaggedLap
    let kind: Kind
    let color: Color
    var dash: [CGFloat] = []
    var phase: CGFloat = 0
  }

  /// Same range as the web chart: a little under the fastest lap, to the 99.5th percentile of clean laps.
  private var range: (lo: Double, hi: Double) {
    let laps = runs.flatMap(\.laps).map(\.lap)
    let clean = laps.filter { $0.flag == nil }.map(\.ms)
    let lo = (((laps.map(\.ms).min() ?? 0) - 300) / 500).rounded(.down) * 500
    let hi = ((RaceMath.quantile(clean.isEmpty ? laps.map(\.ms) : clean, 0.995) + 300) / 500).rounded(.up) * 500
    return (lo, max(hi, lo + 500))
  }

  var body: some View {
    let (lo, hi) = range
    let lastLap = all.map(\.kart.lastLap).max() ?? 1
    let ticks = yTicks(lo, hi)

    VStack(alignment: .leading, spacing: 10) {
      if runs.isEmpty {
        Text("Pick a team above to show its laps.").font(.subheadline).foregroundStyle(Color.textMuted)
          .frame(height: 200)
      } else {
        Chart {
          ForEach(legs(maxMs: hi)) { leg in
            ForEach([leg.a, leg.b], id: \.lap) { p in
              LineMark(x: .value("Lap", p.lap), y: .value("Time", p.ms / 1000), series: .value("Leg", leg.id))
            }
            .foregroundStyle(leg.kind == .bridge ? Color.textMuted.opacity(0.6) : leg.color)
            .lineStyle(leg.dash.isEmpty ? style(leg.kind) : StrokeStyle(lineWidth: 2, dash: leg.dash, dashPhase: leg.phase))
          }
          ForEach(runs) { r in
            ForEach(Array(r.chunks.dropFirst())) { c in
              RuleMark(x: .value("Lap", Double(c.from) - 0.5))
                .foregroundStyle(Color.rule)
                .lineStyle(StrokeStyle(lineWidth: 1))
            }
            ForEach(r.chunks) { c in
              PointMark(x: .value("Lap", c.best.lap), y: .value("Time", c.best.ms / 1000))
                .foregroundStyle(data.color(c.driver))
                .symbolSize(45)
            }
          }
          if let lap = shownLap {
            RuleMark(x: .value("Lap", lap))
              .foregroundStyle(Color.textMuted)
              .lineStyle(StrokeStyle(lineWidth: 1))
              .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                tooltip(lap)
              }
          }
        }
        .chartYScale(domain: (lo / 1000)...(hi / 1000))
        .chartXScale(domain: 1...max(2, lastLap))
        // drag across the chart (or tap) for every team's driver and time on that lap, like the website's hover
        .chartXSelection(value: $selectedLap)
        .onChange(of: selectedLap) { if let selectedLap { shownLap = min(max(1, selectedLap), lastLap) } }
        .chartYAxis {
          AxisMarks(position: .leading, values: ticks) { v in
            AxisValueLabel { if let s = v.as(Double.self) { Text(axisTime(s)) } }
          }
        }
        // gridlines drawn by hand so they can run on under the right-hand system strip like the page's other
        // rules; the plot itself keeps its frame
        .chartBackground { proxy in
          GeometryReader { geo in
            if let frame = proxy.plotFrame {
              let plot = geo[frame]
              let length = geo.size.width - plot.minX + trailingInset
              ForEach(ticks, id: \.self) { t in
                if let y = proxy.position(forY: t) {
                  Rectangle().fill(Color.grid)
                    .frame(width: length, height: 1)
                    .position(x: plot.minX + length / 2, y: plot.minY + y)
                }
              }
            }
          }
        }
        .chartXAxis {
          AxisMarks(values: [1] + Array(stride(from: lapStep(lastLap), through: lastLap, by: lapStep(lastLap)))) { _ in
            AxisValueLabel()
          }
        }
        // about half as tall as it is wide: taller exaggerates every wobble on a narrow screen
        .frame(height: min(320, max(170, width * (wide ? 0.4 : 0.55))))
      }
      legend
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
  }

  /// Gridline values in seconds, stepped like the website's: 0.5, 1 or 2 seconds depending on the range.
  private func yTicks(_ lo: Double, _ hi: Double) -> [Double] {
    let span = hi - lo
    let step = span > 8000 ? 2000.0 : span > 4000 ? 1000 : 500
    return Array(stride(from: (lo / step).rounded(.up) * step, through: hi, by: step)).map { $0 / 1000 }
  }

  /// 58.000 -> "58", 56.500 -> "56.5", as the website's axis does.
  private func axisTime(_ seconds: Double) -> String {
    var s = Fmt.time(seconds * 1000)
    while s.contains(".") && (s.hasSuffix("0") || s.hasSuffix(".")) { s.removeLast() }
    return s
  }

  /// Lap ticks every 10, 20, 25 or 50 laps, about six across.
  private func lapStep(_ laps: Int) -> Int {
    [5, 10, 20, 25, 50, 100].first { laps / $0 <= 6 } ?? 100
  }

  private func style(_ kind: Leg.Kind) -> StrokeStyle {
    switch kind {
    case .normal: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round)
    case .slow: StrokeStyle(lineWidth: 1.6, lineCap: .round, dash: [1, 3.5])
    case .bridge: StrokeStyle(lineWidth: 1.2, dash: [4, 4])
    }
  }

  /// Off-scale laps aren't drawn; a gray dashed bridge joins the laps either side. Missing laps break the line.
  private func legs(maxMs: Double) -> [Leg] {
    var out: [Leg] = []
    for r in runs {
      var prevValid: RunLap?, prevLap: Int?, skipped = false
      for l in r.laps {
        if let p = prevLap, l.lap.lap != p + 1 { prevValid = nil; skipped = false }
        prevLap = l.lap.lap
        if l.lap.ms > maxMs { skipped = true; continue }
        if let p = prevValid {
          let id = "\(r.id)-\(l.lap.lap)"
          if skipped {
            out.append(Leg(id: id, a: p.lap, b: l.lap, kind: .bridge, color: .textMuted))
          } else if p.lap.flag != nil || l.lap.flag != nil {
            out.append(Leg(id: id, a: p.lap, b: l.lap, kind: .slow, color: data.color(l.driver)))
          } else if data.hasOwnColor(l.driver) {
            // long team-color dashes, short driver-color dashes in the gaps
            out.append(Leg(id: id + "t", a: p.lap, b: l.lap, kind: .normal, color: data.teamColor(l.driver), dash: [9, 7]))
            out.append(Leg(id: id + "d", a: p.lap, b: l.lap, kind: .normal, color: data.color(l.driver), dash: [4, 12], phase: 5.5))
          } else {
            out.append(Leg(id: id, a: p.lap, b: l.lap, kind: .normal, color: data.color(l.driver)))
          }
        }
        prevValid = l
        skipped = false
      }
    }
    return out
  }

  private func tooltip(_ lap: Int) -> some View {
    let rows = runs.compactMap { r in r.laps.first { $0.lap.lap == lap }.map { (r, $0) } }.sorted { $0.1.lap.ms < $1.1.lap.ms }
    return VStack(alignment: .leading, spacing: 4) {
      Text("Lap \(lap)").font(.caption.weight(.semibold)).foregroundStyle(Color.textPrimary)
      if rows.isEmpty { Text("No data").font(.caption).foregroundStyle(Color.textMuted) }
      ForEach(rows, id: \.0.id) { r, l in
        HStack(spacing: 6) {
          RoundedRectangle(cornerRadius: 2).fill(r.color).frame(width: 8, height: 8)
          Text(l.driver.driver).foregroundStyle(Color.textPrimary)
          Spacer(minLength: 8)
          Text(Fmt.time(l.lap.ms)).monospacedDigit().foregroundStyle(Color.textPrimary)
          if let f = l.lap.flag { Text(f == .pit ? "pit" : "slow").foregroundStyle(Color.textMuted) }
        }
        .font(.caption)
      }
    }
    .padding(10)
    .frame(minWidth: 170)
    .background(RoundedRectangle(cornerRadius: 6).fill(Color.surface1).shadow(color: .black.opacity(0.12), radius: 8, y: 4))
    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.rule))
  }

  private var legend: some View {
    let item = { (sample: AnyView, text: String) in
      HStack(spacing: 6) { sample.frame(width: 22, height: 10); Text(text) }
    }
    return FlowLayout(spacing: 14, lineSpacing: 6) {
      item(AnyView(Sample(style: style(.normal), color: .textSecondary)), "Lap")
      item(AnyView(Sample(style: style(.slow), color: .textSecondary)), "Slow lap")
      item(AnyView(Sample(style: style(.bridge), color: .textMuted)), "Off the chart, usually a pit stop")
      item(AnyView(Circle().fill(Color.textSecondary).frame(width: 7, height: 7)), "Best lap")
      item(AnyView(Rectangle().fill(Color.rule).frame(width: 1, height: 12)), "Driver change")
    }
    .font(.caption12).foregroundStyle(Color.textMuted)
  }

  private struct Sample: View {
    let style: StrokeStyle
    let color: Color
    var body: some View {
      Canvas { ctx, size in
        var p = Path(); p.move(to: CGPoint(x: 1, y: size.height / 2)); p.addLine(to: CGPoint(x: size.width - 1, y: size.height / 2))
        ctx.stroke(p, with: .color(color), style: style)
      }
    }
  }
}

/// Lays children out left to right, wrapping onto new lines.
struct FlowLayout: Layout {
  var spacing: CGFloat = 8
  var lineSpacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = arrange(width: proposal.width ?? .infinity, subviews)
    let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(0, rows.count - 1))
    return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in arrange(width: bounds.width, subviews) {
      var x = bounds.minX
      for i in row.items {
        let size = subviews[i].sizeThatFits(.unspecified)
        subviews[i].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: .unspecified)
        x += size.width + spacing
      }
      y += row.height + lineSpacing
    }
  }

  private func arrange(width: CGFloat, _ subviews: Subviews) -> [(items: [Int], width: CGFloat, height: CGFloat)] {
    var rows: [(items: [Int], width: CGFloat, height: CGFloat)] = []
    var current: (items: [Int], width: CGFloat, height: CGFloat) = ([], 0, 0)
    for (i, v) in subviews.enumerated() {
      let s = v.sizeThatFits(.unspecified)
      let needed = current.items.isEmpty ? s.width : current.width + spacing + s.width
      if needed > width && !current.items.isEmpty { rows.append(current); current = ([i], s.width, s.height) }
      else { current = (current.items + [i], needed, max(current.height, s.height)) }
    }
    if !current.items.isEmpty { rows.append(current) }
    return rows
  }
}
