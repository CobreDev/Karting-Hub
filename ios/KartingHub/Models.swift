import Foundation

// The server's JSON, as documented in docs/data-format.md. Decoding is lenient because race files are
// hand-editable: kart numbers can be strings or numbers and optional fields can be missing or empty.

struct RaceSummary: Decodable, Identifiable, Hashable {
  let id: String
  let name: String
  let track: String?
  let date: String?
  let teams: [String]
  let drivers: [String]
  let lineups: [Lineup]

  struct Lineup: Decodable, Hashable {
    let team: String
    let kart: String
    let drivers: [String]
  }

  enum CodingKeys: String, CodingKey { case id, name, track, date, teams, drivers, lineups }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    name = (try? c.decode(String.self, forKey: .name)) ?? "Race"
    track = try? c.decode(String.self, forKey: .track)
    date = try? c.decode(String.self, forKey: .date)
    teams = (try? c.decode([String].self, forKey: .teams)) ?? []
    drivers = (try? c.decode([String].self, forKey: .drivers)) ?? []
    lineups = (try? c.decode([Lineup].self, forKey: .lineups)) ?? []
  }
}

extension RaceSummary.Lineup {
  enum CodingKeys: String, CodingKey { case team, kart, drivers }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    team = (try? c.decode(String.self, forKey: .team)) ?? ""
    kart = c.flexibleString(.kart) ?? ""
    drivers = (try? c.decode([String].self, forKey: .drivers)) ?? []
  }
}

struct Race: Decodable {
  let id: String
  let name: String
  let track: String
  let date: String
  let slowFactor: Double?
  let karts: [Kart]

  enum CodingKeys: String, CodingKey { case id, name, track, date, slowFactor, karts }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    name = (try? c.decode(String.self, forKey: .name)) ?? "Race"
    track = (try? c.decode(String.self, forKey: .track)) ?? ""
    date = (try? c.decode(String.self, forKey: .date)) ?? ""
    slowFactor = try? c.decode(Double.self, forKey: .slowFactor)
    karts = (try? c.decode([Kart].self, forKey: .karts)) ?? []
  }

  init(id: String = "test", name: String = "Race", track: String = "", date: String = "", slowFactor: Double? = nil, karts: [Kart]) {
    self.id = id; self.name = name; self.track = track; self.date = date; self.slowFactor = slowFactor; self.karts = karts
  }
}

struct Kart: Decodable {
  let number: String
  let team: String
  let color: String
  let laps: [Lap]
  let stints: [Stint]

  enum CodingKeys: String, CodingKey { case number, team, color, laps, stints }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    number = c.flexibleString(.number) ?? "?"
    team = ((try? c.decode(String.self, forKey: .team)) ?? "").trimmingCharacters(in: .whitespaces)
    color = (try? c.decode(String.self, forKey: .color)) ?? ""
    laps = ((try? c.decode([Lap].self, forKey: .laps)) ?? []).sorted { $0.lap < $1.lap }
    stints = (try? c.decode([Stint].self, forKey: .stints)) ?? []
  }

  init(number: String, team: String = "", color: String = "", laps: [Lap], stints: [Stint] = []) {
    self.number = number; self.team = team; self.color = color; self.laps = laps; self.stints = stints
  }

  /// "Team Apex", or "Kart #7" for a kart without a team.
  var label: String { team.isEmpty ? "Kart #\(number)" : team }
  /// Karts race at the same time, so a kart's distance is its last lap number, not its lap count.
  var lastLap: Int { laps.last?.lap ?? 0 }
  var totalMs: Double { laps.reduce(0) { $0 + $1.ms } }
}

struct Lap: Codable, Hashable {
  let lap: Int
  let pos: Int?
  let ms: Double
  var session: String? = nil

  enum CodingKeys: String, CodingKey { case lap, pos, ms, session }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    lap = try c.decode(Int.self, forKey: .lap)
    pos = try? c.decode(Int.self, forKey: .pos)
    ms = try c.decode(Double.self, forKey: .ms)
    session = c.flexibleString(.session)
  }
  init(lap: Int, pos: Int? = nil, ms: Double, session: String? = nil) { self.lap = lap; self.pos = pos; self.ms = ms; self.session = session }
}

struct Stint: Decodable {
  let driver: String
  /// The driver's last lap; nil means to the finish.
  let toLap: Int?

  enum CodingKeys: String, CodingKey { case driver, toLap }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    driver = (try? c.decode(String.self, forKey: .driver)) ?? ""
    toLap = c.flexibleString(.toLap).flatMap { Int($0) }
  }
  init(driver: String, toLap: Int?) { self.driver = driver; self.toLap = toLap }
}

struct DriverRecord: Codable, Hashable {
  var name: String
  var color: String
  init(name: String, color: String = "") { self.name = name; self.color = color }
  enum CodingKeys: String, CodingKey { case name, color }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    name = try c.decode(String.self, forKey: .name)
    color = (try? c.decode(String.self, forKey: .color)) ?? ""
  }
}

struct TeamRecord: Codable, Hashable {
  var name: String
  var color: String
  var members: [Member]

  init(name: String, color: String = "", members: [Member] = []) { self.name = name; self.color = color; self.members = members }

  struct Member: Codable, Hashable {
    var driver: String
    var role: Role
  }

  enum Role: String, Codable, Comparable, CaseIterable {
    case owner, core, rotating
    var label: String { rawValue.capitalized }
    /// Owner and core drivers belong to one team; rotating drivers can be on several.
    var bound: Bool { self != .rotating }
    static func < (a: Role, b: Role) -> Bool { a.order < b.order }
    private var order: Int { self == .owner ? 0 : self == .core ? 1 : 2 }
  }

  enum CodingKeys: String, CodingKey { case name, color, members }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    name = try c.decode(String.self, forKey: .name)
    color = (try? c.decode(String.self, forKey: .color)) ?? ""
    members = (try? c.decode([Lenient<Member>].self, forKey: .members))?.compactMap(\.value) ?? []
  }
}

struct DriverList: Decodable { let drivers: [DriverRecord] }
struct TeamList: Decodable {
  let teams: [TeamRecord]
  enum CodingKeys: String, CodingKey { case teams }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    teams = ((try? c.decode([Lenient<TeamRecord>].self, forKey: .teams)) ?? []).compactMap(\.value)
  }
}

/// Image versions by kind and id: { drivers: { "alex": 1730000000000 }, teams: {...}, previews: {...} }.
typealias ImageIndex = [String: [String: Double]]

/// Decodes an array element as nil instead of failing the whole array.
struct Lenient<T: Decodable>: Decodable {
  let value: T?
  init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

extension KeyedDecodingContainer {
  /// A value that may be a string or a number in the JSON, as a string. Empty strings become nil.
  func flexibleString(_ key: Key) -> String? {
    if let s = try? decode(String.self, forKey: key) { return s.isEmpty ? nil : s }
    if let i = try? decode(Int.self, forKey: key) { return String(i) }
    if let d = try? decode(Double.self, forKey: key) { return String(d) }
    return nil
  }
}
