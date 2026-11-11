import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// Admin-mode editors. They write straight to the server, which validates everything again.

private let newTag = "\u{1}new"

// MARK: - Shared pieces

/// A photo with Choose and Remove. Uploads right away, like the website.
private struct PhotoField: View {
  @Environment(Hub.self) private var hub
  let kind: String
  let name: String
  let ring: Color
  @Binding var message: String?
  @State private var item: PhotosPickerItem?
  @State private var busy = false

  var body: some View {
    HStack(spacing: 14) {
      Avatar(kind: kind, name: name, size: 56, ring: ring)
      VStack(alignment: .leading, spacing: 8) {
        PhotosPicker(hub.photoURL(kind, name) == nil ? "Add photo" : "Change photo", selection: $item, matching: .images)
        if hub.photoURL(kind, name) != nil {
          Button("Remove photo", role: .destructive) { Task { await run { try await hub.deletePhoto(kind, name: name) } } }
        }
      }
      .disabled(busy)
      if busy { ProgressView() }
    }
    .onChange(of: item) {
      guard let item else { return }
      Task {
        await run {
          guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
            throw AdminError.rejected("couldn't read that photo")
          }
          try await hub.uploadPhoto(kind, name: name, image: image)
        }
        self.item = nil
      }
    }
  }

  private func run(_ work: () async throws -> Void) async {
    busy = true
    defer { busy = false }
    do {
      try await work()
      let ids = await (kind == "teams" ? hub.racesShowing(team: name) : hub.racesShowing(driver: name))
      await hub.dropPreviews(ids)
      hub.revision += 1
    } catch { message = describe(error) }
  }
}

/// A color the item can have or not; without one it falls back (to the team color, or a palette slot).
private struct OptionalColor: View {
  let label: String
  @Binding var hex: String
  var body: some View {
    Toggle(label, isOn: Binding(get: { TeamColors.isHex(hex) }, set: { hex = $0 ? "#2a78d6" : "" }))
    if TeamColors.isHex(hex) {
      ColorPicker("Color", selection: Binding(get: { Color(uiColor: UIColor(rgb: TeamColors.parse(hex)!)) },
                                              set: { hex = $0.hex }), supportsOpacity: false)
    }
  }
}

extension Color {
  /// "#rrggbb" in sRGB.
  var hex: String {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
    let c = { (v: CGFloat) in Int((min(1, max(0, v)) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", c(r), c(g), c(b))
  }
}

private struct EditorChrome: ViewModifier {
  let title: String
  let busy: Bool
  let canSave: Bool
  let save: () -> Void
  @Environment(\.dismiss) private var dismiss

  func body(content: Content) -> some View {
    content
      .scrollContentBackground(.hidden)
      .background(Color.bg)
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if busy { ProgressView() } else { Button("Save", action: save).disabled(!canSave) }
        }
      }
      .interactiveDismissDisabled(busy)
  }
}

private func messageSection(_ message: String?) -> some View {
  Group {
    if let message { Section { Text(message).foregroundStyle(Color.danger) } }
  }
}

// MARK: - Driver

struct DriverEditor: View {
  @Environment(Hub.self) private var hub
  @Environment(\.dismiss) private var dismiss
  let original: DriverRecord?
  @State private var name = ""
  @State private var color = ""
  @State private var message: String?
  @State private var busy = false
  @State private var confirmDelete = false

  var body: some View {
    NavigationStack {
      Form {
        Section("Name") {
          TextField("Driver name", text: $name).textInputAutocapitalization(.words)
        }
        Section {
          OptionalColor(label: "Own color", hex: $color)
        } header: { Text("Color") } footer: {
          Text("Without their own color a driver uses their team's color, so teammates match.")
        }
        if let original {
          Section("Photo") {
            PhotoField(kind: "drivers", name: original.name, ring: TeamColors.isHex(color) ? Color(identity: color) : .rule, message: $message)
          }
          let teams = hub.teamsFor(driver: original.name)
          if !teams.isEmpty {
            Section {
              ForEach(teams, id: \.team.name) { t in LabeledContent(t.team.name, value: t.role.label) }
            } header: { Text("Teams") } footer: { Text("Change rosters on the Teams tab.") }
          }
          Section {
            Button("Delete driver", role: .destructive) { confirmDelete = true }
          } footer: {
            Text("Their laps in saved races stay. They lose their color and photo link and leave every roster.")
          }
        }
        messageSection(message)
      }
      .modifier(EditorChrome(title: original == nil ? "New driver" : "Edit driver", busy: busy,
                             canSave: !name.trimmingCharacters(in: .whitespaces).isEmpty, save: { Task { await save() } }))
      .confirmationDialog("Delete \(original?.name ?? "")?", isPresented: $confirmDelete, titleVisibility: .visible) {
        Button("Delete", role: .destructive) { Task { await delete() } }
      }
    }
    .onAppear { name = original?.name ?? ""; color = original?.color ?? "" }
  }

  private func save() async {
    let to = name.trimmingCharacters(in: .whitespaces)
    guard to.count <= 60 else { message = "Keep names to 60 characters."; return }
    if hub.drivers.contains(where: { driverId($0.name) == driverId(to) && driverId($0.name) != driverId(original?.name ?? "\u{0}") }) {
      message = "There is already a driver called \(to)."
      return
    }
    busy = true
    defer { busy = false }
    do {
      if let original, original.name != to { try await hub.rename("drivers", from: original.name, to: to) }
      var list = hub.drivers
      if let i = list.firstIndex(where: { driverId($0.name) == driverId(to) }) { list[i].color = color }
      else { list.append(DriverRecord(name: to, color: color)) }
      try await hub.saveDrivers(list)
      if original?.color != color || original?.name != to { await hub.dropPreviews(await hub.racesShowing(driver: to)) }
      hub.revision += 1
      dismiss()
    } catch { message = describe(error) }
  }

  private func delete() async {
    guard let original else { return }
    busy = true
    defer { busy = false }
    do {
      try await hub.saveDrivers(hub.drivers.filter { driverId($0.name) != driverId(original.name) })
      let stripped = hub.teams.map { t in
        var t = t
        t.members.removeAll { driverId($0.driver) == driverId(original.name) }
        return t
      }
      if stripped != hub.teams { try await hub.saveTeams(stripped) }
      hub.revision += 1
      dismiss()
    } catch { message = describe(error) }
  }
}

// MARK: - Team

struct TeamEditor: View {
  @Environment(Hub.self) private var hub
  @Environment(\.dismiss) private var dismiss
  let original: TeamRecord?
  @State private var name = ""
  @State private var color = ""
  @State private var members: [TeamRecord.Member] = []
  @State private var message: String?
  @State private var busy = false
  @State private var confirmDelete = false

  var body: some View {
    NavigationStack {
      Form {
        Section("Name") {
          TextField("Team name", text: $name).textInputAutocapitalization(.words)
        }
        Section {
          OptionalColor(label: "Team color", hex: $color)
        } header: { Text("Color") } footer: {
          Text("Used for the team everywhere: chart lines, swatches and photo rings. Check it stands apart from the other teams.")
        }
        if let original {
          Section("Photo") {
            PhotoField(kind: "teams", name: original.name, ring: TeamColors.isHex(color) ? Color(identity: color) : .rule, message: $message)
          }
        }
        Section {
          ForEach($members, id: \.driver) { $m in
            HStack(spacing: 10) {
              Avatar(kind: "drivers", name: m.driver, size: 26)
              Text(m.driver)
              Spacer()
              Picker("Role", selection: $m.role) {
                ForEach(TeamRecord.Role.allCases, id: \.self) { Text($0.label).tag($0) }
              }
              .labelsHidden()
            }
          }
          .onDelete { members.remove(atOffsets: $0) }
          let available = hub.drivers.filter { d in !members.contains { driverId($0.driver) == driverId(d.name) } }
          if !available.isEmpty {
            Menu("Add a driver") {
              ForEach(available, id: \.name) { d in
                Button(d.name) {
                  // core on their first team, rotating after that: owner and core are one team only
                  let bound = hub.teams.contains { t in driverId(t.name) != driverId(original?.name ?? "\u{0}")
                    && t.members.contains { driverId($0.driver) == driverId(d.name) && $0.role.bound } }
                  members.append(TeamRecord.Member(driver: d.name, role: bound ? .rotating : .core))
                }
              }
            }
          }
        } header: { Text("Roster") } footer: {
          Text("Owners and core drivers belong to this team only. Rotating drivers can be on other rosters too. Swipe to remove someone.")
        }
        if original != nil {
          Section {
            Button("Delete team", role: .destructive) { confirmDelete = true }
          } footer: {
            Text("Races keep their laps. The team loses its saved color, photo link and roster.")
          }
        }
        messageSection(message)
      }
      .modifier(EditorChrome(title: original == nil ? "New team" : "Edit team", busy: busy,
                             canSave: !name.trimmingCharacters(in: .whitespaces).isEmpty, save: { Task { await save() } }))
      .confirmationDialog("Delete \(original?.name ?? "")?", isPresented: $confirmDelete, titleVisibility: .visible) {
        Button("Delete", role: .destructive) { Task { await delete() } }
      }
    }
    .onAppear {
      name = original?.name ?? ""
      color = original?.color ?? ""
      members = (original?.members ?? []).sorted { ($0.role, $0.driver) < ($1.role, $1.driver) }
    }
  }

  private func save() async {
    let to = name.trimmingCharacters(in: .whitespaces)
    guard to.count <= 60 else { message = "Keep names to 60 characters."; return }
    if hub.teams.contains(where: { driverId($0.name) == driverId(to) && driverId($0.name) != driverId(original?.name ?? "\u{0}") }) {
      message = "There is already a team called \(to)."
      return
    }
    busy = true
    defer { busy = false }
    do {
      if let original, original.name != to { try await hub.rename("teams", from: original.name, to: to) }
      var list = hub.teams
      let team = TeamRecord(name: to, color: color, members: members)
      if let i = list.firstIndex(where: { driverId($0.name) == driverId(to) }) { list[i] = team } else { list.append(team) }
      try await hub.saveTeams(list)
      if original?.color != color || original?.name != to { await hub.dropPreviews(await hub.racesShowing(team: to)) }
      hub.revision += 1
      dismiss()
    } catch { message = describe(error) }
  }

  private func delete() async {
    guard let original else { return }
    busy = true
    defer { busy = false }
    do {
      try await hub.saveTeams(hub.teams.filter { driverId($0.name) != driverId(original.name) })
      hub.revision += 1
      dismiss()
    } catch { message = describe(error) }
  }
}

// MARK: - Race

struct RaceEditor: View {
  @Environment(Hub.self) private var hub
  @Environment(\.dismiss) private var dismiss
  @State var draft: RaceDraft
  let isNew: Bool
  var onDelete: () -> Void = {}
  @State private var notes: [String] = []
  @State private var importing = false
  @State private var message: String?
  @State private var busy = false
  @State private var confirmOverwrite = false
  @State private var confirmDelete = false
  @State private var adding: AddTarget?
  @State private var newName = ""

  /// Where a "New driver…" or "New team…" choice should go once it's created.
  enum AddTarget { case team(kart: String), driver(kart: String, stint: UUID) }

  var body: some View {
    NavigationStack {
      Form {
        Section("Race") {
          TextField("Name", text: $draft.name).textInputAutocapitalization(.words)
          TextField("Track", text: $draft.track).textInputAutocapitalization(.words)
          DatePicker("Date", selection: dateBinding, displayedComponents: .date)
          Stepper("Slow lap: over \(slowPercent)% off the median", value: Binding(
            get: { slowPercent }, set: { draft.slowFactor = 1 + Double($0) / 100 }), in: 1...50)
        }

        Section {
          Button { importing = true } label: { Label("Import Race Monitor files", systemImage: "doc.badge.plus") }
          ForEach(notes, id: \.self) { Text($0).font(.footnote).foregroundStyle(Color.textSecondary) }
        } header: { Text("Lap times") } footer: {
          Text("Pick each kart's “lap times” .txt export. The kart number comes from the file name. A kart split over two sessions can take both files.")
        }

        ForEach($draft.karts) { $kart in
          kartSection($kart)
        }

        if !isNew {
          Section { Button("Delete race", role: .destructive) { confirmDelete = true } }
        }
        messageSection(message)
      }
      .modifier(EditorChrome(title: isNew ? "New race" : "Edit race", busy: busy,
                             canSave: !draft.name.trimmingCharacters(in: .whitespaces).isEmpty, save: { Task { await save(overwrite: false) } }))
      .fileImporter(isPresented: $importing, allowedContentTypes: [.plainText, .text], allowsMultipleSelection: true) { result in
        importFiles(result)
      }
      .confirmationDialog("A race called \(draft.name) on this date already exists.", isPresented: $confirmOverwrite, titleVisibility: .visible) {
        Button("Replace it", role: .destructive) { Task { await save(overwrite: true) } }
      }
      .confirmationDialog("Delete \(draft.name)?", isPresented: $confirmDelete, titleVisibility: .visible) {
        Button("Delete race", role: .destructive) { Task { await delete() } }
      } message: { Text("Its laps are removed from the server. This can't be undone.") }
      .alert(addTitle, isPresented: Binding(get: { adding != nil }, set: { if !$0 { adding = nil } })) {
        TextField("Name", text: $newName).textInputAutocapitalization(.words)
        Button("Add") { Task { await quickAdd() } }
        Button("Cancel", role: .cancel) { adding = nil }
      }
    }
  }

  private var slowPercent: Int { Int(((draft.slowFactor - 1) * 100).rounded()) }

  private var dateBinding: Binding<Date> {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return Binding(get: { f.date(from: draft.date) ?? Date() }, set: { draft.date = f.string(from: $0) })
  }

  @ViewBuilder private func kartSection(_ kart: Binding<RaceDraft.KartDraft>) -> some View {
    let k = kart.wrappedValue
    let lastLap = k.laps.last?.lap ?? 0
    Section {
      Picker("Team", selection: Binding(get: { k.team }, set: { v in
        if v == newTag { newName = ""; adding = .team(kart: k.number) } else { kart.wrappedValue.team = v }
      })) {
        Text("No team").tag("")
        ForEach(teamChoices(k.team), id: \.self) { Text($0).tag($0) }
        Text("New team…").tag(newTag)
      }
      ForEach(kart.stints) { $stint in
        HStack {
          Picker("Driver", selection: Binding(get: { stint.driver }, set: { v in
            if v == newTag { newName = ""; adding = .driver(kart: k.number, stint: stint.id) } else { stint.driver = v }
          })) {
            Text("Choose a driver").tag("")
            ForEach(driverChoices(stint.driver, team: k.team), id: \.self) { Text($0).tag($0) }
            Text("New driver…").tag(newTag)
          }
          .labelsHidden()
          .layoutPriority(1)
          Spacer(minLength: 4)
          Text("to lap").foregroundStyle(Color.textMuted).fixedSize()
          TextField("finish", value: $stint.toLap, format: .number)
            .keyboardType(.numberPad)
            .multilineTextAlignment(.trailing)
            .frame(width: 52)
            .onSubmit { sort(k.number) }
        }
      }
      .onDelete { offsets in
        kart.wrappedValue.stints.remove(atOffsets: offsets)
        // the last stint always runs to the finish
        if !kart.wrappedValue.stints.isEmpty && !kart.wrappedValue.stints.contains(where: { $0.toLap == nil }) {
          kart.wrappedValue.stints[kart.wrappedValue.stints.count - 1].toLap = nil
        }
      }
      Button("Add a driver change") {
        // the open stint now ends at the last lap; the new driver runs to the finish
        if let open = kart.wrappedValue.stints.firstIndex(where: { $0.toLap == nil }) {
          kart.wrappedValue.stints[open].toLap = max(1, lastLap)
        }
        kart.wrappedValue.stints.append(RaceDraft.StintDraft(driver: "", toLap: nil))
        sort(k.number)
      }
      Button("Remove kart", role: .destructive) { draft.karts.removeAll { $0.number == k.number } }
    } header: {
      Text("Kart #\(k.number) · \(k.laps.count) laps\(k.laps.isEmpty ? "" : ", \(k.laps.first!.lap)–\(lastLap)")")
    } footer: {
      Text("Each driver drove up to their lap number; leave the last one empty to run to the finish. Swipe to remove a driver.")
    }
  }

  /// Saved teams, plus this kart's team if it isn't saved (older races).
  private func teamChoices(_ current: String) -> [String] {
    var names = hub.teams.map(\.name)
    if !current.isEmpty && !names.contains(where: { driverId($0) == driverId(current) }) { names.append(current) }
    return names
  }

  /// The team's roster first, then everyone else, plus this stint's driver if they aren't saved.
  private func driverChoices(_ current: String, team: String) -> [String] {
    let roster = hub.savedTeam(team)?.members.map(\.driver) ?? []
    var names = roster + hub.drivers.map(\.name).filter { n in !roster.contains { driverId($0) == driverId(n) } }
    if !current.isEmpty && !names.contains(where: { driverId($0) == driverId(current) }) { names.append(current) }
    return names
  }

  private var addTitle: String {
    if case .team = adding { return "New team" }
    return "New driver"
  }

  private func sort(_ kart: String) {
    if let i = draft.karts.firstIndex(where: { $0.number == kart }) { draft.sortStints(i) }
  }

  private func importFiles(_ result: Result<[URL], Error>) {
    switch result {
    case .failure(let error): message = describe(error)
    case .success(let urls):
      let files = urls.compactMap { url -> RaceMonitorFile? in
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return nil }
        let text = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
        return RaceMonitor.parse(text, filename: url.lastPathComponent)
      }
      notes = draft.add(files)
      if files.count < urls.count { notes.append("\(urls.count - files.count) file(s) couldn't be read.") }
    }
  }

  private func quickAdd() async {
    let name = newName.trimmingCharacters(in: .whitespaces)
    guard let target = adding, !name.isEmpty else { adding = nil; return }
    adding = nil
    do {
      switch target {
      case .team(let kart):
        if hub.savedTeam(name) == nil { try await hub.saveTeams(hub.teams + [TeamRecord(name: name)]) }
        if let i = draft.karts.firstIndex(where: { $0.number == kart }) { draft.karts[i].team = hub.savedTeam(name)?.name ?? name }
      case .driver(let kart, let stint):
        if !hub.drivers.contains(where: { driverId($0.name) == driverId(name) }) {
          try await hub.saveDrivers(hub.drivers + [DriverRecord(name: name)])
        }
        if let i = draft.karts.firstIndex(where: { $0.number == kart }),
           let j = draft.karts[i].stints.firstIndex(where: { $0.id == stint }) {
          draft.karts[i].stints[j].driver = hub.drivers.first { driverId($0.name) == driverId(name) }?.name ?? name
        }
      }
      hub.revision += 1
    } catch { message = describe(error) }
  }

  private func save(overwrite: Bool) async {
    draft.name = draft.name.trimmingCharacters(in: .whitespaces)
    draft.track = draft.track.trimmingCharacters(in: .whitespaces)
    if isNew { draft.id = slugify("\(draft.date) \(draft.name)") }
    for i in draft.karts.indices {
      let all = draft.karts[i].stints
      draft.karts[i].stints = all.filter { !$0.driver.trimmingCharacters(in: .whitespaces).isEmpty || $0.toLap != nil || all.count == 1 }
      draft.sortStints(i)
    }
    busy = true
    defer { busy = false }
    if isNew && !overwrite, await hub.raceExists(draft.id) { confirmOverwrite = true; return }
    do {
      try await hub.saveRace(draft)
      hub.revision += 1
      dismiss()
    } catch { message = describe(error) }
  }

  private func delete() async {
    busy = true
    defer { busy = false }
    do {
      try await hub.deleteRace(draft.id)
      hub.revision += 1
      dismiss()
      onDelete()
    } catch { message = describe(error) }
  }
}
