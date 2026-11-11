import SwiftUI

struct RaceListView: View {
  @Environment(Hub.self) private var hub
  @State private var newRace = false

  var body: some View {
    Loadable(key: hub.revision, load: {
      async let races = hub.races()
      try await hub.loadLists()
      return try await races
    }) { races in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          Brand().padding(.bottom, 8)
          if races.isEmpty {
            ContentUnavailableView("No races yet", systemImage: "flag.checkered",
                                   description: Text("Races you upload on the website show up here."))
              .padding(.top, 60)
          }
          Columns {
            ForEach(races) { race in
              VStack(spacing: 0) {
                NavigationLink(value: race) { RaceRow(race: race) }.buttonStyle(.plain)
                Rule(color: .grid)
              }
            }
          }
        }
        .page()
      }
    }
    .background(Color.bg)
    .navigationTitle("Races")
    .navigationDestination(for: RaceSummary.self) { RaceView(id: $0.id, title: $0.name) }
    .toolbar {
      if hub.isAdmin {
        Button { newRace = true } label: { Label("Add race", systemImage: "plus") }
      }
    }
    .sheet(isPresented: $newRace) { RaceEditor(draft: .new(), isNew: true) }
  }
}

private struct RaceRow: View {
  @Environment(Hub.self) private var hub
  let race: RaceSummary

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(race.name).font(.itemTitle).foregroundStyle(Color.textPrimary)
        Text([Fmt.raceDate(race.date), race.track ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
          .font(.subheadline).foregroundStyle(Color.textSecondary)
        HStack(spacing: -6) {
          ForEach(Array(race.lineups.prefix(6).enumerated()), id: \.offset) { i, l in
            let color = hub.savedTeam(l.team).map(\.color).flatMap { TeamColors.isHex($0) ? Color(identity: $0) : nil }
            Avatar(kind: "teams", name: l.team.isEmpty ? "#\(l.kart)" : l.team, size: 24, ring: color ?? Color(identity: TeamColors.defaults[i % 8]))
          }
          Text(race.teams.joined(separator: ", ")).font(.label).foregroundStyle(Color.textMuted).lineLimit(1).padding(.leading, 12)
        }
        .padding(.top, 4)
      }
      Spacer(minLength: 0)
      Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.textMuted)
    }
    .padding(.vertical, 14)
    .contentShape(Rectangle())
  }
}

/// The logo above the race list. Holding it opens the hidden Settings.
private struct Brand: View {
  @Environment(Hub.self) private var hub

  var body: some View {
    HStack(spacing: 8) {
      CheckerMark()
      Text("Karting Hub").font(.label).foregroundStyle(Color.textMuted)
      if hub.isAdmin { Tag(text: "Admin") }
    }
    .padding(.vertical, 6)
    .contentShape(Rectangle())
    .onLongPressGesture(minimumDuration: 1.5) {
      UIImpactFeedbackGenerator(style: .medium).impactOccurred()
      hub.showSettings = true
    }
    .accessibilityAction(named: "Open settings") { hub.showSettings = true }
  }
}
