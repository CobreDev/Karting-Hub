import Foundation
import Testing
@testable import KartingHub

// Mirrors test/race.test.js, so the app and the website agree on every number.

@Test func computeDriversSplitsStintsAndFlagsPitLaps() {
  let laps = (1...20).map { n in Lap(lap: n, ms: n == 10 ? 140000 : 50000 + Double(n)) }
  let race = Race(karts: [Kart(number: "7", team: "Team Apex", laps: laps,
                               stints: [Stint(driver: "Alex", toLap: 10), Stint(driver: "Jordan", toLap: nil)])])
  let drivers = RaceMath.computeDrivers(race)
  #expect(drivers.count == 2)
  let alex = drivers[0], jordan = drivers[1]
  #expect(alex.driver == "Alex")
  #expect(alex.stints == [1...10])
  #expect(alex.laps.first { $0.lap == 10 }?.flag == .pit)
  #expect(alex.cleanCount == 9)
  #expect(alex.best == 50001)
  #expect(alex.avg < 51000)
  #expect(jordan.stints == [11...20])
  #expect(jordan.team == "Team Apex")
}

@Test func kartWithoutStintsIsOneDriver() {
  let race = Race(karts: [Kart(number: "7", laps: [Lap(lap: 1, ms: 50000)])])
  #expect(RaceMath.computeDrivers(race).first?.driver == "Kart 7")
}

@Test func stintsAreOrderedByEndLap() {
  let laps = (1...6).map { Lap(lap: $0, ms: 50000) }
  let race = Race(karts: [Kart(number: "1", laps: laps, stints: [Stint(driver: "B", toLap: nil), Stint(driver: "A", toLap: 3)])])
  #expect(RaceMath.computeDrivers(race).map(\.driver) == ["A", "B"])
}

@Test func missingLapsFindsGaps() {
  #expect(RaceMath.missingLaps([Lap(lap: 8, ms: 1), Lap(lap: 9, ms: 1), Lap(lap: 14, ms: 1)]) == [10, 11, 12, 13])
}

@Test func winnerHasMostLapsThenLeastTime() {
  let a = Kart(number: "1", laps: [Lap(lap: 1, ms: 50000), Lap(lap: 2, ms: 50000)])
  let b = Kart(number: "2", laps: [Lap(lap: 1, ms: 49000), Lap(lap: 2, ms: 49000)])
  let c = Kart(number: "3", laps: [Lap(lap: 1, ms: 40000)])
  #expect(RaceMath.winner([a, b, c]) == 1)
}

@Test func formatters() {
  #expect(Fmt.time(49250) == "49.250")
  #expect(Fmt.time(61234) == "1:01.234")
  #expect(Fmt.time(7215000) == "2:00:15.000")
  #expect(Fmt.delta(412) == "+0.412")
  #expect(Fmt.delta(-1205) == "−1.205")
  #expect(Fmt.clock(49250) == "00:49.250")
  #expect(Fmt.raceDate("2026-10-17") == "Sat, Oct 17, 2026")
  #expect(Fmt.shortName("Alex Morgan") == "Alex M.")
  #expect(Fmt.hours(7_141_000) == "2 h")
  #expect(Fmt.hours(5_400_000) == "1.5 h")
}

@Test func teamShadeKeepsAReadableColor() {
  // same as teamShades('#6250d6', 3, 'light')[0] in color.js
  #expect(TeamColors.shadeHex("#6250d6", mode: .light) == "#6250d6")
  for hex in TeamColors.defaults {
    #expect(TeamColors.shadeHex(hex, mode: .dark).count == 7)
  }
}

@Test func namesMatchIgnoringCaseAndSpaces() {
  #expect(driverId(" Alex ") == driverId("alex"))
  #expect(driverId("Alex") != driverId("Alexa"))
  #expect(imageId("Team Apex") == "team-apex")
  #expect(imageId(" Alex ") == "alex")
  #expect(imageId("../../etc/passwd").allSatisfy { $0.isLowercase || $0.isNumber || $0 == "-" })
}

@Test func serverAddressesAreNormalized() {
  #expect(Hub.normalize("karting.example.com/")?.absoluteString == "https://karting.example.com")
  #expect(Hub.normalize("http://192.168.1.20:8080")?.absoluteString == "http://192.168.1.20:8080")
  #expect(Hub.normalize("ftp://example.com") == nil)
  #expect(Hub.normalize("  ") == nil)
}

@Test func decodesLenientRaceJSON() throws {
  let json = #"{"id":"r","name":"Test","karts":[{"number":7,"laps":[{"lap":2,"ms":50000},{"lap":1,"pos":3,"ms":51000}],"stints":[{"driver":"A","toLap":""}]}]}"#
  let race = try JSONDecoder().decode(Race.self, from: Data(json.utf8))
  #expect(race.karts[0].number == "7")
  #expect(race.karts[0].laps.map(\.lap) == [1, 2])
  #expect(race.karts[0].stints[0].toLap == nil)
}

// MARK: - Race Monitor import (mirrors the parseRaceMonitor / mergeLaps tests)

private let export = """
12 - #7 7
Laps: 3
Total time: 02:31.000
Best time: 00:49.904 in lap 29

Lap, Position, Time
31, 4, 00:50.100
30, 4, 00:51.000
29, 4, 00:49.904

http://www.race-monitor.com/Results/Session/1000002
"""

@Test func lapTimesParse() {
  #expect(RaceMonitor.lapTime("00:49.250") == 49250)
  #expect(RaceMonitor.lapTime("02:10.500") == 130500)
  #expect(RaceMonitor.lapTime("1:02:03.456") == 3723456)
}

@Test func parseReadsHeaderLapsAndSession() {
  let p = RaceMonitor.parse(export, filename: "7.txt")
  #expect(p.kart == "7")
  #expect(p.headerNumber == "7")
  #expect(p.session == "1000002")
  #expect(p.laps.map(\.lap) == [29, 30, 31])
  #expect(p.laps[0] == Lap(lap: 29, pos: 4, ms: 49904))
}

@Test func kartNumberComesFromTheFileName() {
  let p = RaceMonitor.parse(export.replacingOccurrences(of: "#7 7", with: "#99 99"), filename: "12 2.txt")
  #expect(p.kart == "12")
  #expect(p.headerNumber == "99")
}

@Test func mergeKeepsExistingLapsOnDuplicates() {
  let (laps, duplicates) = RaceMonitor.merge([Lap(lap: 1, ms: 50000)], [Lap(lap: 1, ms: 99999), Lap(lap: 2, ms: 51000)], session: "s")
  #expect(laps.map(\.ms) == [50000, 51000])
  #expect(laps[1].session == "s")
  #expect(duplicates == [1])
}

@Test func draftAddsFilesToKartsAndSavesNullForOpenStints() throws {
  var draft = RaceDraft.new()
  draft.name = "Saturday Enduro"
  let notes = draft.add([RaceMonitor.parse(export, filename: "7.txt")])
  #expect(notes.count == 1)
  #expect(draft.karts.map(\.number) == ["7"])
  #expect(draft.karts[0].laps.count == 3)
  let encoder = JSONEncoder()
  encoder.outputFormatting = .sortedKeys // key order isn't guaranteed otherwise
  let json = String(decoding: try encoder.encode(draft.karts[0].stints), as: UTF8.self)
  #expect(json == #"[{"driver":"","toLap":null}]"#)
  #expect(slugify("2026-03-14 Saturday Enduro") == "2026-03-14-saturday-enduro")
}
