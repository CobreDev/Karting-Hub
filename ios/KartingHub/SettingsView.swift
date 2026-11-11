import SwiftUI

/// Hidden settings, opened with a long press on the logo above the race list.
struct SettingsView: View {
  @Environment(Hub.self) private var hub
  @AppStorage(Hub.serverKey) private var saved = ""
  @State private var draft = ""
  @State private var status: Status = .idle
  @State private var askingToken = false
  @State private var tokenDraft = ""
  @State private var tokenStatus: Status = .idle
  @State private var wantAdmin = false
  @FocusState private var editing: Bool

  enum Status: Equatable { case idle, checking, ok(Int), failed(String) }

  var body: some View {
    @Bindable var hub = hub
    Form {
      Section {
        TextField(Hub.exampleServer, text: $draft)
          .keyboardType(.URL)
          .textContentType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .focused($editing)
          .submitLabel(.done)
          .onSubmit(save)
        Button("Check connection") { Task { await check() } }
          .disabled(status == .checking)
      } header: {
        Text("Server")
      } footer: {
        statusText
      }

      Section {
        Toggle("Admin mode", isOn: $wantAdmin)
          .onChange(of: wantAdmin) {
            if wantAdmin && hub.adminToken == nil { tokenDraft = ""; tokenStatus = .idle; askingToken = true }
            else { askingToken = false; hub.adminMode = wantAdmin }
          }
        if askingToken {
          SecureField("Admin token", text: $tokenDraft)
            .textContentType(.password)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.go)
            .onSubmit { Task { await signIn() } }
          HStack {
            Button("Turn on") { Task { await signIn() } }
              .disabled(tokenDraft.trimmingCharacters(in: .whitespaces).isEmpty || tokenStatus == .checking)
            Spacer()
            Button("Cancel") { wantAdmin = false }.foregroundStyle(Color.textSecondary)
          }
          .buttonStyle(.borderless)
        }
        if hub.adminToken != nil {
          Button("Forget the admin token", role: .destructive) { hub.saveToken(nil); wantAdmin = false }
        }
      } header: {
        Text("Admin")
      } footer: {
        switch tokenStatus {
        case .failed(let message) where askingToken: Text(message).foregroundStyle(Color.danger)
        case .checking: Text("Checking the token…")
        default:
          Text(askingToken ? "The ADMIN_TOKEN set on the server. It's kept in this phone's Keychain."
               : hub.isAdmin ? "You can add and edit races, drivers and teams. Changes go straight to the server."
               : "Edit drivers and teams and add races from this phone. Needs the server's admin token.")
        }
      }

      Section {
        LabeledContent("Website") {
          Link(hub.server.host() ?? hub.server.absoluteString, destination: hub.server)
        }
        LabeledContent("App version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")
      }
    }
    .scrollContentBackground(.hidden)
    .background(Color.bg)
    .navigationTitle("Settings")
    .navigationBarTitleDisplayMode(.inline)
    .onAppear {
      draft = saved
      wantAdmin = hub.isAdmin
    }
    .onChange(of: editing) { if !editing { save() } }
  }

  @ViewBuilder private var statusText: some View {
    switch status {
    case .idle: Text(verbatim: "The address of your Karting Hub server, such as https://karting.example.com or http://192.168.1.20:8080 on your home network.")
    case .checking: Text("Checking…")
    case .ok(let n): Text("Connected. \(n) race\(n == 1 ? "" : "s") on this server.").foregroundStyle(Color.good)
    case .failed(let message): Text(message).foregroundStyle(Color.danger)
    }
  }

  private func signIn() async {
    let token = tokenDraft.trimmingCharacters(in: .whitespaces)
    guard !token.isEmpty else { return }
    tokenStatus = .checking
    do {
      try await hub.verify(token: token)
      hub.saveToken(token)
      hub.adminMode = true
      askingToken = false
    } catch {
      tokenStatus = .failed(describe(error))
    }
  }

  private func save() {
    guard let url = Hub.normalize(draft) else {
      status = .failed("Enter an address that starts with https:// or http://.")
      return
    }
    draft = url.absoluteString
    let value = url.absoluteString
    if value != saved {
      saved = value
      status = .idle
      hub.loadToken()
    }
  }

  private func check() async {
    save()
    if case .failed = status, Hub.normalize(draft) == nil { return }
    status = .checking
    do { status = .ok(try await hub.check(hub.server)) } catch { status = .failed(describe(error)) }
  }
}
