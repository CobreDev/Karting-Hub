import Foundation
import Observation
import SwiftUI

/// The Karting Hub server the app reads from. Everything comes from its JSON API; the app stores nothing
/// except the server address.
@MainActor @Observable
final class Hub {
  /// Shown as a hint only. There's no built-in server: the first launch asks for one.
  static let exampleServer = "https://karting.example.com"
  static let serverKey = "serverURL"

  var drivers: [DriverRecord] = []
  var teams: [TeamRecord] = []
  var images: ImageIndex = [:]

  /// Bumped after every admin change, so loaded pages fetch again.
  var revision = 0

  /// Settings is hidden: a long press on the logo at the top of the race list opens it.
  var showSettings = false
  /// The admin token for the current server, from the Keychain.
  var adminToken: String?
  var adminMode = UserDefaults.standard.bool(forKey: "adminMode") {
    didSet { UserDefaults.standard.set(adminMode, forKey: "adminMode") }
  }
  /// Editing controls show only with admin mode on and a saved token.
  var isAdmin: Bool { adminMode && adminToken != nil }

  init() {
    loadToken()
    #if DEBUG
    // for Simulator testing: `simctl spawn <device> defaults write com.cobredev.kartinghub debugAdminToken <token>`
    if let token = UserDefaults.standard.string(forKey: "debugAdminToken") {
      UserDefaults.standard.removeObject(forKey: "debugAdminToken")
      saveToken(token)
      adminMode = true
    }
    #endif
  }

  func loadToken() { adminToken = Keychain.read(tokenAccount) }

  func saveToken(_ token: String?) {
    Keychain.write(tokenAccount, token)
    adminToken = token
  }

  var server: URL {
    let saved = UserDefaults.standard.string(forKey: Self.serverKey) ?? ""
    // the first-launch screen sets this before anything loads; the fallback is never requested
    return Self.normalize(saved) ?? URL(string: Self.exampleServer)!
  }

  /// "karting.example.com/" -> https://karting.example.com, or nil if it isn't a usable address.
  nonisolated static func normalize(_ text: String) -> URL? {
    var s = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !s.isEmpty else { return nil }
    if !s.contains("://") { s = "https://" + s }
    while s.hasSuffix("/") { s.removeLast() }
    guard let url = URL(string: s), let scheme = url.scheme, ["http", "https"].contains(scheme), url.host() != nil else { return nil }
    return url
  }

  // MARK: API

  func get<T: Decodable>(_ path: String, as type: T.Type = T.self, from base: URL? = nil) async throws -> T {
    let url = (base ?? server).appending(path: "api/" + path)
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw HubError.notKartingHub }
    guard http.statusCode == 200 else {
      throw http.statusCode == 404 ? HubError.notFound : HubError.status(http.statusCode)
    }
    do { return try JSONDecoder().decode(T.self, from: data) } catch { throw HubError.notKartingHub }
  }

  func races() async throws -> [RaceSummary] {
    try await get("races", as: [RaceSummary].self).sorted { ($0.date ?? "", $0.name) > ($1.date ?? "", $1.name) }
  }

  func race(_ id: String) async throws -> Race {
    try await get("races/" + id)
  }

  /// Drivers, teams and the photo index, which every page needs for colors and avatars.
  func loadLists() async throws {
    async let d = get("drivers", as: DriverList.self)
    async let t = get("teams", as: TeamList.self)
    async let i = try? get("images", as: ImageIndex.self)
    let (dl, tl, il) = try await (d, t, i)
    drivers = dl.drivers.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    teams = tl.teams.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    if let il { images = il }
  }

  /// Checks that an address answers like a Karting Hub server, for the Settings screen.
  func check(_ base: URL) async throws -> Int {
    struct Health: Decodable { let ok: Bool }
    _ = try await get("health", as: Health.self, from: base)
    return try await get("races", as: [RaceSummary].self, from: base).count
  }

  // MARK: Lookups

  func photoURL(_ kind: String, _ name: String) -> URL? {
    let id = imageId(name)
    guard !id.isEmpty, let v = images[kind]?[id] else { return nil }
    var c = URLComponents(url: server.appending(path: "images/\(kind)/\(id)"), resolvingAgainstBaseURL: false)!
    c.queryItems = [URLQueryItem(name: "v", value: String(Int(v)))]
    return c.url
  }

  func webURL(_ path: String) -> URL { server.appending(path: path) }

  func savedTeam(_ name: String) -> TeamRecord? {
    name.isEmpty ? nil : teams.first { driverId($0.name) == driverId(name) }
  }

  /// Saved team color, then the kart's own color (older races), then a palette slot.
  func teamHex(_ kart: Kart, _ index: Int) -> String {
    if let saved = savedTeam(kart.team)?.color, TeamColors.isHex(saved) { return saved }
    return TeamColors.isHex(kart.color) ? kart.color : TeamColors.defaults[index % TeamColors.defaults.count]
  }

  /// A driver's personal color, if they have one.
  func ownHex(_ driver: String) -> String? {
    drivers.first { driverId($0.name) == driverId(driver) && TeamColors.isHex($0.color) }?.color
  }

  func teamsFor(driver: String) -> [(team: TeamRecord, role: TeamRecord.Role)] {
    teams.compactMap { t in t.members.first { driverId($0.driver) == driverId(driver) }.map { (t, $0.role) } }
      .sorted { $0.role < $1.role }
  }
}

enum HubError: LocalizedError {
  case notFound, status(Int), notKartingHub

  var errorDescription: String? {
    switch self {
    case .notFound: "Not found on the server."
    case .status(let code): "The server answered with error \(code)."
    case .notKartingHub: "That address didn't answer like a Karting Hub server."
    }
  }
}

/// A plain-language message for a failed request.
func describe(_ error: Error) -> String {
  if let e = error as? URLError {
    switch e.code {
    case .notConnectedToInternet: return "You're offline."
    case .cannotFindHost, .dnsLookupFailed: return "Couldn't find the server. Check the address in Settings."
    case .cannotConnectToHost, .timedOut, .networkConnectionLost: return "The server didn't answer. Is it running?"
    case .appTransportSecurityRequiresSecureConnection: return "Use an https address, or http only for a local address."
    default: return e.localizedDescription
    }
  }
  return error.localizedDescription
}
