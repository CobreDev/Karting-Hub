import Foundation

// A port of public/lib/race.js. The numbers must match the web app, so keep the two in step.

let pitFactor = 1.8
let defaultSlowFactor = 1.1

enum LapFlag { case pit, slow }

struct FlaggedLap: Hashable {
  let lap: Int
  let pos: Int?
  let ms: Double
  let flag: LapFlag?
}

/// One driver's laps in one kart, with the stats the race page shows.
struct DriverEntry: Identifiable, Hashable {
  let key: String
  let driver: String
  let kart: String
  let team: String
  let stints: [ClosedRange<Int>]
  let laps: [FlaggedLap]

  var id: String { key }
  var count: Int { laps.count }
  var clean: [Double] { laps.filter { $0.flag == nil }.map(\.ms) }
  var cleanCount: Int { clean.count }
  var bestLap: FlaggedLap { laps.min { $0.ms < $1.ms }! }
  var best: Double { bestLap.ms }
  var bestLapNo: Int { bestLap.lap }
  var avg: Double { let c = clean; return c.reduce(0, +) / Double(c.count) }
  var median: Double { RaceMath.median(clean) }
  var p10: Double { RaceMath.quantile(clean, 0.1) }
  var p90: Double { RaceMath.quantile(clean, 0.9) }
  var stdev: Double {
    let c = clean, a = avg
    return (c.reduce(0) { $0 + ($1 - a) * ($1 - a) } / Double(c.count)).squareRoot()
  }
  var top5: Double { let top = laps.map(\.ms).sorted().prefix(5); return top.reduce(0, +) / Double(top.count) }
  var total: Double { laps.reduce(0) { $0 + $1.ms } }
  var teamLabel: String { team.isEmpty ? "Kart #\(kart)" : team }
  var stintText: String { stints.map { "\($0.lowerBound)–\($0.upperBound)" }.joined(separator: ", ") }
}

enum RaceMath {
  static func median(_ xs: [Double]) -> Double {
    guard !xs.isEmpty else { return .nan }
    let s = xs.sorted(), m = s.count / 2
    return s.count % 2 == 1 ? s[m] : (s[m - 1] + s[m]) / 2
  }

  static func quantile(_ xs: [Double], _ q: Double) -> Double {
    guard !xs.isEmpty else { return .nan }
    let s = xs.sorted()
    let i = Double(s.count - 1) * q
    let lo = Int(i.rounded(.down)), hi = Int(i.rounded(.up))
    return s[lo] + (s[hi] - s[lo]) * (i - Double(lo))
  }

  static func missingLaps(_ laps: [Lap]) -> [Int] {
    guard let first = laps.first?.lap, let last = laps.last?.lap else { return [] }
    let have = Set(laps.map(\.lap))
    return (first...max(first, last)).filter { !have.contains($0) }
  }

  /// One entry per driver per kart. Laps over 1.8× the stint median are pit laps, over slowFactor× are slow;
  /// averages use unflagged laps and the best lap uses all of them. A kart without stints is one "Kart N" driver.
  static func computeDrivers(_ race: Race) -> [DriverEntry] {
    let slowFactor = race.slowFactor ?? defaultSlowFactor
    var order: [String] = []
    var parts: [String: (driver: String, kart: String, team: String, stints: [ClosedRange<Int>], laps: [FlaggedLap])] = [:]
    for kart in race.karts {
      var from = 1
      for stint in normalizedStints(kart.stints) {
        let to = stint.toLap ?? .max
        let laps = kart.laps.filter { $0.lap >= from && $0.lap <= to }
        let med = median(laps.map(\.ms))
        let flagged = laps.map { l in
          FlaggedLap(lap: l.lap, pos: l.pos, ms: l.ms, flag: l.ms > med * pitFactor ? .pit : l.ms > med * slowFactor ? .slow : nil)
        }
        let trimmed = stint.driver.trimmingCharacters(in: .whitespaces)
        let driver = trimmed.isEmpty ? "Kart \(kart.number)" : trimmed
        let key = "\(driver)|\(kart.number)"
        if parts[key] == nil { order.append(key); parts[key] = (driver, kart.number, kart.team, [], []) }
        if let a = laps.first?.lap, let b = laps.last?.lap { parts[key]!.stints.append(a...b) }
        parts[key]!.laps += flagged
        if to == .max { break }
        from = to + 1
      }
    }
    return order.compactMap { key in
      let p = parts[key]!
      return p.laps.isEmpty ? nil : DriverEntry(key: key, driver: p.driver, kart: p.kart, team: p.team, stints: p.stints, laps: p.laps)
    }
  }

  /// Ordered by end lap; an open-ended stint always runs to the flag. Ties keep their saved order.
  private static func normalizedStints(_ stints: [Stint]) -> [Stint] {
    let list = stints.isEmpty ? [Stint(driver: "", toLap: nil)] : stints
    return list.enumerated()
      .sorted { ($0.element.toLap ?? .max, $0.offset) < ($1.element.toLap ?? .max, $1.offset) }
      .map(\.element)
  }

  /// The winning kart: most laps, then the least time for them. Same rule as the race page.
  static func winner(_ karts: [Kart]) -> Int? {
    karts.indices.min { a, b in
      karts[a].lastLap != karts[b].lastLap ? karts[a].lastLap > karts[b].lastLap : karts[a].totalMs < karts[b].totalMs
    }
  }
}

// MARK: - Formatting, matching fmtTime / fmtDelta / fmtRaceDate in race.js

enum Fmt {
  /// 49250 -> "49.250", 61234 -> "1:01.234", 7215000 -> "2:00:15.000"
  static func time(_ ms: Double?) -> String {
    guard let ms, !ms.isNaN else { return "—" }
    let neg = ms < 0
    let v = Int(abs(ms).rounded())
    let h = v / 3_600_000, m = (v % 3_600_000) / 60000
    let s = String(format: "%.3f", Double(v % 60000) / 1000)
    let padded = String(repeating: "0", count: max(0, 6 - s.count)) + s
    let out = h > 0 ? "\(h):\(String(format: "%02d", m)):\(padded)" : m > 0 ? "\(m):\(padded)" : s
    return (neg ? "-" : "") + out
  }

  /// 412 -> "+0.412", -1205 -> "−1.205"
  static func delta(_ ms: Double?) -> String {
    guard let ms, !ms.isNaN else { return "—" }
    return (ms >= 0 ? "+" : "−") + String(format: "%.3f", abs(ms) / 1000)
  }

  /// 49250 -> "00:49.250", the Race Monitor style for lap rows.
  static func clock(_ ms: Double) -> String {
    let v = Int(ms.rounded())
    return String(format: "%02d:%06.3f", v / 60000, Double(v % 60000) / 1000)
  }

  /// "2026-10-17" -> "Sat, Oct 17, 2026", the same in every time zone.
  static func raceDate(_ date: String?) -> String {
    guard let date, !date.isEmpty else { return "" }
    let parse = DateFormatter()
    parse.locale = Locale(identifier: "en_US_POSIX")
    parse.timeZone = TimeZone(identifier: "UTC")
    parse.dateFormat = "yyyy-MM-dd"
    guard let d = parse.date(from: date) else { return date }
    let out = DateFormatter()
    out.locale = Locale(identifier: "en_US")
    out.timeZone = TimeZone(identifier: "UTC")
    out.dateFormat = "EEE, MMM d, yyyy"
    return out.string(from: d)
  }

  /// "Alex Morgan" -> "Alex M."
  static func shortName(_ name: String) -> String {
    let parts = name.split(whereSeparator: \.isWhitespace)
    guard parts.count > 1, let initial = parts.last?.first else { return String(parts.first ?? "") }
    return "\(parts[0]) \(initial)."
  }

  /// "Alex Morgan" -> "AM"
  static func initials(_ name: String) -> String {
    name.split(whereSeparator: \.isWhitespace).prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
  }

  /// 1:59:01 -> "2 h", 1:30:00 -> "1.5 h", 40 min -> "40 min"
  static func hours(_ ms: Double) -> String {
    let hrs = ms / 3_600_000
    if hrs < 1 { return "\(Int((ms / 60000).rounded())) min" }
    return abs(hrs - hrs.rounded()) < 0.1 ? "\(Int(hrs.rounded())) h" : String(format: "%.1f h", hrs)
  }
}

/// Drivers and teams are matched by name, ignoring case and surrounding spaces.
func driverId(_ name: String) -> String { name.trimmingCharacters(in: .whitespaces).lowercased() }

/// Photo file name for a driver or team: "Team Apex" -> "team-apex".
func imageId(_ name: String) -> String {
  let lower = name.trimmingCharacters(in: .whitespaces).lowercased()
  var out = "", dash = false
  for ch in lower.unicodeScalars {
    if ("a"..."z").contains(ch) || ("0"..."9").contains(ch) { out.unicodeScalars.append(ch); dash = false }
    else if !dash { out += "-"; dash = true }
  }
  out = out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  return String(out.prefix(80))
}
