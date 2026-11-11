import SwiftUI

/// First launch: the app has no built-in server, so it asks for one. Only the address lives here; admin mode
/// stays in the hidden Settings.
struct WelcomeView: View {
  @Environment(Hub.self) private var hub
  @AppStorage(Hub.serverKey) private var saved = ""
  @State private var draft = ""
  @State private var checking = false
  @State private var error: String?
  @FocusState private var focused: Bool

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        CheckerMark(size: 44, color: .textPrimary)
        Text("Karting Hub").font(.pageTitle).foregroundStyle(Color.textPrimary).padding(.top, 20)
        Text("Lap times, drivers and teams from your Karting Hub server.")
          .font(.body).foregroundStyle(Color.textSecondary).padding(.top, 6)

        Rule().padding(.top, 32)
        Text("Server address").font(.label).foregroundStyle(Color.textMuted).padding(.top, 18)
        TextField(Hub.exampleServer, text: $draft)
          .font(.body)
          .keyboardType(.URL)
          .textContentType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.go)
          .focused($focused)
          .onSubmit { Task { await connect() } }
          .padding(.horizontal, 12).frame(height: 46)
          .background(RoundedRectangle(cornerRadius: 6).fill(Color.surface1))
          .overlay(RoundedRectangle(cornerRadius: 6).stroke(focused ? Color.textMuted : Color.rule))
          .padding(.top, 8)
        Group {
          if let error {
            Text(error).foregroundStyle(Color.danger)
          } else {
            Text(verbatim: "The address you open the website at, such as https://karting.example.com, or http://192.168.1.20:8080 on your home network.")
              .foregroundStyle(Color.textMuted)
          }
        }
        .font(.label).padding(.top, 8)

        Button { Task { await connect() } } label: {
          HStack(spacing: 8) {
            if checking { ProgressView().tint(Color.bg) }
            Text(checking ? "Connecting…" : "Connect").font(.body.weight(.semibold))
          }
          .frame(maxWidth: .infinity).frame(height: 46)
          .foregroundStyle(Color.bg)
          .background(RoundedRectangle(cornerRadius: 6).fill(Color.textPrimary))
        }
        .buttonStyle(.plain)
        .disabled(checking || draft.trimmingCharacters(in: .whitespaces).isEmpty)
        .opacity(draft.trimmingCharacters(in: .whitespaces).isEmpty ? 0.45 : 1)
        .padding(.top, 24)

        Text("You can change it later: hold the logo above the race list to open Settings.")
          .font(.label).foregroundStyle(Color.textMuted).padding(.top, 16)
      }
      .frame(maxWidth: 440, alignment: .leading)
      .padding(.horizontal, 24).padding(.top, 72).padding(.bottom, 32)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .background(Color.bg)
    .onAppear { focused = true }
  }

  /// Saves the address only once it answers like a Karting Hub server.
  private func connect() async {
    guard let url = Hub.normalize(draft) else {
      error = "Enter an address that starts with https:// or http://."
      return
    }
    checking = true
    defer { checking = false }
    do {
      _ = try await hub.check(url)
      error = nil
      saved = url.absoluteString
      hub.loadToken()
    } catch {
      self.error = describe(error)
    }
  }
}
