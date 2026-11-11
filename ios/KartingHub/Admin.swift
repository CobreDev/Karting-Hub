import Foundation
import Security
import UIKit

// MARK: - Admin token, kept in the Keychain

enum Keychain {
  private static let service = "com.cobredev.kartinghub.admin"

  static func read(_ account: String) -> String? {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: account, kSecReturnData as String: true]
    var out: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func write(_ account: String, _ value: String?) {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: account]
    SecItemDelete(query as CFDictionary)
    guard let value else { return }
    var add = query
    add[kSecValueData as String] = Data(value.utf8)
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(add as CFDictionary, nil)
  }
}

// MARK: - Admin API

extension Hub {
  /// Tokens are per server, so switching servers doesn't send one server's token to another.
  var tokenAccount: String { server.absoluteString }

  /// Sends an admin request. The server locks an address out after 10 wrong tokens in 15 minutes.
  @discardableResult
  func send(_ method: String, _ path: String, json: Encodable? = nil, data: Data? = nil, contentType: String? = nil,
            token: String? = nil) async throws -> Data {
    guard let token = token ?? adminToken else { throw AdminError.noToken }
    var request = URLRequest(url: server.appending(path: "api/" + path), timeoutInterval: 30)
    request.httpMethod = method
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let json {
      request.httpBody = try JSONEncoder().encode(json)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    } else if let data {
      request.httpBody = data
      request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    }
    let (body, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw HubError.notKartingHub }
    guard (200..<300).contains(http.statusCode) else {
      struct Failure: Decodable { let error: String }
      let message = (try? JSONDecoder().decode(Failure.self, from: body))?.error
      if http.statusCode == 401 { throw AdminError.rejected(message ?? "wrong admin token") }
      if http.statusCode == 429 { throw AdminError.rejected(message ?? "too many wrong tokens, try again later") }
      throw AdminError.rejected(message ?? "error \(http.statusCode)")
    }
    return body
  }

  /// Checks a token against the server before admin mode is turned on.
  func verify(token: String) async throws {
    try await send("GET", "auth", token: token)
  }

  func saveDrivers(_ list: [DriverRecord]) async throws {
    struct Body: Encodable { let drivers: [DriverRecord] }
    try await send("PUT", "drivers", json: Body(drivers: list))
    try await loadLists()
  }

  func saveTeams(_ list: [TeamRecord]) async throws {
    struct Body: Encodable { let teams: [TeamRecord] }
    try await send("PUT", "teams", json: Body(teams: list))
    try await loadLists()
  }

  /// Renames everywhere at once on the server: the list, every race, rosters and the photo.
  func rename(_ kind: String, from: String, to: String) async throws {
    struct Body: Encodable { let from: String; let to: String }
    try await send("POST", "\(kind)/rename", json: Body(from: from, to: to))
    try await loadLists()
  }

  /// Uploads a photo, cropped square and resized to 256 px like the website does.
  func uploadPhoto(_ kind: String, name: String, image: UIImage) async throws {
    guard let jpeg = image.squareThumbnail(256).jpegData(compressionQuality: 0.85) else { throw AdminError.rejected("couldn't read that photo") }
    try await send("PUT", "images/\(kind)/\(imageId(name))", data: jpeg, contentType: "image/jpeg")
    try await loadLists()
  }

  func deletePhoto(_ kind: String, name: String) async throws {
    try await send("DELETE", "images/\(kind)/\(imageId(name))")
    try await loadLists()
  }

  func saveRace(_ draft: RaceDraft) async throws {
    try await send("PUT", "races/\(draft.id)", json: draft)
    await dropPreviews([draft.id])
  }

  func deleteRace(_ id: String) async throws {
    try await send("DELETE", "races/\(id)")
  }

  func raceExists(_ id: String) async -> Bool {
    (try? await race(id)) != nil
  }

  /// Link-preview cards are drawn by the website. After a change here, remove the stale ones: the website
  /// draws a missing card again the next time an admin opens that race there.
  func dropPreviews(_ ids: [String]) async {
    for id in Set(ids) where images["previews"]?[id] != nil {
      _ = try? await send("DELETE", "images/previews/\(id)")
    }
  }

  /// Races whose card shows this driver or team.
  func racesShowing(driver: String? = nil, team: String? = nil) async -> [String] {
    guard let races = try? await races() else { return [] }
    return races.filter { r in
      (driver.map { d in r.drivers.contains { driverId($0) == driverId(d) } } ?? false)
        || (team.map { t in r.lineups.contains { driverId($0.team) == driverId(t) } } ?? false)
    }.map(\.id)
  }
}

enum AdminError: LocalizedError {
  case noToken, rejected(String)
  var errorDescription: String? {
    switch self {
    case .noToken: "Turn on admin mode in Settings first."
    case .rejected(let message): message.prefix(1).uppercased() + message.dropFirst() + (message.hasSuffix(".") ? "" : ".")
    }
  }
}

extension UIImage {
  /// Center-cropped square, `size` pixels on a side.
  func squareThumbnail(_ size: CGFloat) -> UIImage {
    let side = min(self.size.width, self.size.height)
    let scale = size / side
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: format).image { _ in
      draw(in: CGRect(x: (side - self.size.width) / 2 * scale, y: (side - self.size.height) / 2 * scale,
                      width: self.size.width * scale, height: self.size.height * scale))
    }
  }
}

// MARK: - Race editing

/// A race as it is saved: laps and stints only, never derived stats.
struct RaceDraft: Encodable {
  var id: String
  var name: String
  var track: String
  var date: String
  var slowFactor: Double
  var karts: [KartDraft]

  struct KartDraft: Encodable, Identifiable {
    var number: String
    var team: String
    var color: String
    var laps: [Lap]
    var stints: [StintDraft]
    var id: String { number }

    enum CodingKeys: String, CodingKey { case number, team, color, laps, stints }
    func encode(to encoder: Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(number, forKey: .number)
      try c.encode(team, forKey: .team)
      if !color.isEmpty { try c.encode(color, forKey: .color) }
      try c.encode(laps, forKey: .laps)
      try c.encode(stints, forKey: .stints)
    }
  }

  struct StintDraft: Encodable, Identifiable {
    var driver: String
    var toLap: Int?
    let id = UUID()
    enum CodingKeys: String, CodingKey { case driver, toLap }
    func encode(to encoder: Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(driver, forKey: .driver)
      try c.encode(toLap, forKey: .toLap) // null means to the finish
    }
  }

  static func new() -> RaceDraft {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return RaceDraft(id: "", name: "", track: "", date: f.string(from: Date()), slowFactor: defaultSlowFactor, karts: [])
  }

  init(id: String, name: String, track: String, date: String, slowFactor: Double, karts: [KartDraft]) {
    self.id = id; self.name = name; self.track = track; self.date = date; self.slowFactor = slowFactor; self.karts = karts
  }

  init(_ race: Race) {
    self.init(id: race.id, name: race.name, track: race.track, date: race.date, slowFactor: race.slowFactor ?? defaultSlowFactor,
              karts: race.karts.map { k in
                KartDraft(number: k.number, team: k.team, color: k.color, laps: k.laps,
                          stints: k.stints.map { StintDraft(driver: $0.driver, toLap: $0.toLap) })
              })
  }

  /// Adds parsed exports to their karts, creating karts as needed. Returns one line per file.
  mutating func add(_ files: [RaceMonitorFile]) -> [String] {
    var notes: [String] = []
    for p in files {
      guard !p.kart.isEmpty else { notes.append("\(p.filename): no kart number, skipped"); continue }
      if !karts.contains(where: { $0.number == p.kart }) {
        karts.append(KartDraft(number: p.kart, team: "", color: "", laps: [], stints: [StintDraft(driver: "", toLap: nil)]))
      }
      let i = karts.firstIndex { $0.number == p.kart }!
      let (laps, duplicates) = RaceMonitor.merge(karts[i].laps, p.laps, session: p.session)
      karts[i].laps = laps
      notes.append("\(p.filename): kart #\(p.kart), \(p.laps.count - duplicates.count) laps added"
                   + (duplicates.isEmpty ? "" : ", \(duplicates.count) duplicate lap numbers ignored"))
    }
    karts.sort { $0.number.localizedStandardCompare($1.number) == .orderedAscending }
    return notes
  }

  /// Stints in order of their end lap; the open one runs to the finish.
  mutating func sortStints(_ k: Int) {
    karts[k].stints.sort { ($0.toLap ?? .max) < ($1.toLap ?? .max) }
  }
}

// MARK: - Race Monitor exports, a port of parseRaceMonitor / mergeLaps in race.js

struct RaceMonitorFile {
  let filename: String
  let kart: String
  let headerNumber: String?
  let session: String?
  let laps: [Lap]
}

enum RaceMonitor {
  /// "00:49.250" | "1:01.234" | "1:02:03.456" -> milliseconds
  static func lapTime(_ s: String) -> Double {
    var sec = 0.0
    for part in s.trimmingCharacters(in: .whitespaces).split(separator: ":") { sec = sec * 60 + (Double(part) ?? 0) }
    return (sec * 1000).rounded()
  }

  /// One kart's "lap times" export. The kart number comes from the file name ("7 2.txt" -> 7), because split
  /// sessions can carry a different transponder number in the header.
  static func parse(_ text: String, filename: String) -> RaceMonitorFile {
    let lines = text.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n")
    let header = lines.first.flatMap { $0.firstMatch(of: #/^\s*(\d+)\s*-\s*#(\S+)\s*(.*)$/#) }
    var laps: [Lap] = []
    var session: String?
    for line in lines {
      if let m = line.firstMatch(of: #/^\s*(\d+)\s*,\s*(?:(\d+)\s*,\s*)?(\d[\d:.]*)\s*$/#) {
        laps.append(Lap(lap: Int(m.1)!, pos: m.2.flatMap { Int($0) }, ms: lapTime(String(m.3))))
      }
      if let s = line.firstMatch(of: #/race-monitor\.com\/Results\/Session\/(\d+)/#.ignoresCase()) { session = String(s.1) }
    }
    laps.sort { $0.lap < $1.lap }
    let fileNumber = filename.firstMatch(of: #/^\s*#?(\d+)/#).map { String($0.1) }
    let headerNumber = header.map { String($0.2) }
    return RaceMonitorFile(filename: filename, kart: fileNumber ?? headerNumber ?? "", headerNumber: headerNumber, session: session, laps: laps)
  }

  /// Existing laps win on duplicate lap numbers.
  static func merge(_ existing: [Lap], _ incoming: [Lap], session: String?) -> (laps: [Lap], duplicates: [Int]) {
    var byLap = Dictionary(existing.map { ($0.lap, $0) }, uniquingKeysWith: { a, _ in a })
    var duplicates: [Int] = []
    for l in incoming {
      if byLap[l.lap] != nil { duplicates.append(l.lap) }
      else { byLap[l.lap] = Lap(lap: l.lap, pos: l.pos, ms: l.ms, session: session) }
    }
    return (byLap.values.sorted { $0.lap < $1.lap }, duplicates)
  }
}

/// "2026-03-14 Saturday Enduro" -> "2026-03-14-saturday-enduro", the website's race id rule.
func slugify(_ s: String) -> String {
  let id = imageId(s)
  return id.isEmpty ? "race" : id
}
