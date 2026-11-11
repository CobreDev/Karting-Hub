import SwiftUI

@main
struct KartingHubApp: App {
  @State private var hub = Hub()

  var body: some Scene {
    WindowGroup {
      RootView().environment(hub)
    }
  }
}

struct RootView: View {
  @Environment(Hub.self) private var hub
  @AppStorage(Hub.serverKey) private var serverText = ""
  @State private var trailingInset: CGFloat = 0

  var body: some View {
    if Hub.normalize(serverText) == nil {
      WelcomeView()
    } else {
      tabs
    }
  }

  private var tabs: some View {
    @Bindable var hub = hub
    return TabView {
      Tab("Races", systemImage: "flag.checkered") { NavigationStack { RaceListView() } }
      Tab("Drivers", systemImage: "person") { NavigationStack { DriversView() } }
      Tab("Teams", systemImage: "person.2") { NavigationStack { TeamsView() } }
    }
    .tint(Color.textPrimary)
    .environment(\.trailingInset, trailingInset)
    .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.trailing } action: { trailingInset = $0 }
    // a new server means new data everywhere
    .id(serverText)
    .sheet(isPresented: $hub.showSettings) {
      NavigationStack {
        SettingsView().toolbar { Button("Done") { hub.showSettings = false } }
      }
      .tint(Color.textPrimary)
    }
  }
}
