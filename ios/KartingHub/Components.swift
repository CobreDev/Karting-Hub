import SwiftUI

/// A photo, or initials when there is none, in a ring of the item's color. A second color takes the top-left
/// half of the ring (a driver with their own color on a team).
struct Avatar: View {
  @Environment(Hub.self) private var hub
  let kind: String
  let name: String
  var size: CGFloat = 36
  var ring: Color = .rule
  var second: Color? = nil

  var body: some View {
    let inner = size - 4
    ZStack {
      Circle().fill(ring)
      if let second {
        Circle().trim(from: 0.375, to: 0.875).fill(second)
      }
      Group {
        if let url = hub.photoURL(kind, name) {
          AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { initials }
        } else {
          initials
        }
      }
      .frame(width: inner, height: inner)
      .clipShape(Circle())
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  private var initials: some View {
    ZStack {
      Color.surface2
      Text(Fmt.initials(name)).font(.system(size: size * 0.34, weight: .semibold)).foregroundStyle(Color.textSecondary)
    }
  }
}

/// The single line that separates sections: rules, not boxes.
struct Rule: View {
  var color: Color = .rule
  var height: CGFloat = 1
  /// Runs on under the system strip at the right edge (the Duo's camera and tab rail), so the line ends as far
  /// from the right edge of the screen as it starts from the left.
  var bleed = false
  @Environment(\.trailingInset) private var trailingInset
  var body: some View {
    Rectangle().fill(color).frame(height: height).padding(.trailing, bleed ? -trailingInset : 0)
  }
}

/// A titled section that starts with a rule.
struct HairlineSection<Content: View>: View {
  let title: String
  var note: String? = nil
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Rule(bleed: true)
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.sectionTitle).foregroundStyle(Color.textPrimary)
        if let note { Text(note).font(.label).foregroundStyle(Color.textMuted) }
      }
      .padding(.top, 4)
      content
    }
    .padding(.top, 28)
  }
}

/// A headline number: label, figure, and an optional line under it.
struct Figure<Accessory: View>: View {
  let label: String
  let value: String
  var detail: String? = nil
  @ViewBuilder var accessory: Accessory

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(.label).foregroundStyle(Color.textMuted)
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(value).font(.figure).foregroundStyle(Color.textPrimary).lineLimit(1).minimumScaleFactor(0.6)
        accessory
      }
      if let detail { Text(detail).font(.label).foregroundStyle(Color.textSecondary).lineLimit(2) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

extension Figure where Accessory == EmptyView {
  init(label: String, value: String, detail: String? = nil) {
    self.init(label: label, value: value, detail: detail) { EmptyView() }
  }
}

/// A short state label. Status color always comes with a word.
struct Tag: View {
  let text: String
  var color: Color = .textSecondary
  var body: some View {
    Text(text)
      .font(.system(size: 11, weight: .semibold))
      .foregroundStyle(color)
      .padding(.horizontal, 5).padding(.vertical, 1)
      .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.rule))
  }
}

/// A "?" that explains a number in place.
struct HelpButton: View {
  let title: String
  let text: String
  @State private var shown = false

  var body: some View {
    Button { shown = true } label: {
      Text("?").font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.textSecondary)
        .frame(width: 18, height: 18)
        .background(Circle().fill(Color.surface1))
        .overlay(Circle().stroke(Color.rule))
    }
    .buttonStyle(.plain)
    .accessibilityLabel("What does \(title) mean?")
    .popover(isPresented: $shown) {
      VStack(alignment: .leading, spacing: 8) {
        Text(title).font(.itemTitle)
        Text(text).font(.subheadline).foregroundStyle(Color.textSecondary).fixedSize(horizontal: false, vertical: true)
      }
      .padding(18)
      .frame(idealWidth: 320)
      .presentationCompactAdaptation(.popover)
    }
  }
}

/// Loads with `load`, shows a spinner the first time, and an error with Retry and a way to Settings.
struct Loadable<Value, Content: View>: View {
  /// Loads again whenever this changes (the hub bumps it after an admin edit).
  var key: Int = 0
  let load: () async throws -> Value
  @ViewBuilder let content: (Value) -> Content
  @State private var value: Value?
  @State private var error: String?

  var body: some View {
    Group {
      if let value {
        content(value)
      } else if let error {
        ContentUnavailableView {
          Label("Can't load this", systemImage: "wifi.exclamationmark")
        } description: {
          Text(error)
        } actions: {
          Button("Try again") { Task { await run() } }.buttonStyle(.bordered)
        }
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .task(id: key) { await run() }
    .refreshable { await run() }
  }

  private func run() async {
    do { value = try await load(); error = nil } catch is CancellationError {} catch { self.error = describe(error) }
  }
}

extension View {
  /// The page gutter used on every screen. It also measures the room the page has and passes it down
  /// (`isWide` and friends), so layouts follow the iPhone Duo's two screens, rotation and resizable scenes.
  func page() -> some View { modifier(Page()) }
}

extension EnvironmentValues {
  /// Content 560 points or wider: side-by-side headers and more table columns.
  @Entry var isWide = false
  /// 760 or wider: two-column lists and the std dev and pace-spread columns.
  @Entry var isWider = false
  /// Width of the system area at the right edge of the window: the Duo puts its camera, status and tab rail
  /// there in portrait.
  @Entry var trailingInset: CGFloat = 0
}

private struct Page: ViewModifier {
  @State private var width: CGFloat = 0
  func body(content: Content) -> some View {
    let inner = min(width, 1080) - 32
    content
      .environment(\.isWide, inner >= 560)
      .environment(\.isWider, inner >= 760)
      .padding(.horizontal, 16).padding(.bottom, 32)
      .frame(maxWidth: 1080, alignment: .leading)
      .frame(maxWidth: .infinity)
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
  }
}

/// One column on a phone, two side by side when there's room.
struct Columns<Content: View>: View {
  @Environment(\.isWider) private var wide
  @ViewBuilder let content: Content
  var body: some View {
    if wide {
      LazyVGrid(columns: [GridItem(.flexible(), spacing: 32, alignment: .top), GridItem(.flexible(), alignment: .top)],
                alignment: .leading, spacing: 0) { content }
    } else {
      LazyVStack(alignment: .leading, spacing: 0) { content }
    }
  }
}

/// Side by side when the page is wide, stacked on a phone.
struct AdaptiveStack<Content: View>: View {
  @Environment(\.isWide) private var wide
  var spacing: CGFloat = 40
  @ViewBuilder let content: Content
  var body: some View {
    if wide {
      HStack(alignment: .top, spacing: spacing) { content }
    } else {
      VStack(alignment: .leading, spacing: 22) { content }
    }
  }
}

/// Headline figures: one row when the page is wide, two per row on a phone.
struct FigureGrid<A: View, B: View, C: View, D: View>: View {
  @Environment(\.isWide) private var wide
  let a: A, b: B, c: C, d: D
  var body: some View {
    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 14) {
      if wide {
        GridRow { a; b; c; d }
      } else {
        GridRow { a; b }
        GridRow { c; d }
      }
    }
  }
}

/// The checkered-flag mark from the favicon and app icon.
struct CheckerMark: View {
  var size: CGFloat = 14
  var color: Color = .textMuted
  var body: some View {
    Canvas { ctx, canvas in
      let cell = canvas.width / 4
      for i in 0..<4 { for j in 0..<4 where (i + j) % 2 == 0 {
        ctx.fill(Path(CGRect(x: Double(i) * cell, y: Double(j) * cell, width: cell, height: cell)), with: .color(color))
      } }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}
