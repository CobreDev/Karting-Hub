import SwiftUI

// Hairline tokens (the web app's style.css), each with a light and a dark value.
extension Color {
  static let bg = Color(light: 0xf6f5f1, dark: 0x0f0f0e)
  static let surface1 = Color(light: 0xffffff, dark: 0x181817)
  static let surface2 = Color(light: 0xefeee9, dark: 0x222220)
  static let rule = Color(light: 0xdcdad2, dark: 0x2f2e2b)
  static let grid = Color(light: 0xe9e7e0, dark: 0x262624)
  static let textPrimary = Color(light: 0x161614, dark: 0xecebe6)
  static let textSecondary = Color(light: 0x55534d, dark: 0xbdbbb2)
  static let textMuted = Color(light: 0x6d6b64, dark: 0x8f8d85)
  static let good = Color(light: 0x17773a, dark: 0x4cbf6b)
  static let danger = Color(light: 0xb8322a, dark: 0xe66767)
  static let statusGood = Color(light: 0x1b9a3e, dark: 0x2fa24a)
  static let statusWarn = Color(light: 0xb89400, dark: 0xa8920a)
  static let statusCrit = Color(light: 0xc0302f, dark: 0xb3261e)

  init(light: UInt32, dark: UInt32) {
    self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: dark) : UIColor(rgb: light) })
  }

  /// A team or driver color, with its lightness nudged per theme so it reads on that background.
  init(identity hex: String) {
    let light = UIColor(rgb: TeamColors.shade(hex, mode: .light))
    let dark = UIColor(rgb: TeamColors.shade(hex, mode: .dark))
    self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
  }
}

extension UIColor {
  convenience init(rgb: UInt32) {
    self.init(red: CGFloat((rgb >> 16) & 0xff) / 255, green: CGFloat((rgb >> 8) & 0xff) / 255, blue: CGFloat(rgb & 0xff) / 255, alpha: 1)
  }
}

/// A port of public/lib/color.js: OKLCH lightness clamped into a readable band per theme.
enum TeamColors {
  enum Mode { case light, dark }
  static let defaults = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]

  static func isHex(_ s: String) -> Bool { parse(s) != nil }

  static func parse(_ s: String) -> UInt32? {
    guard s.count == 7, s.first == "#" else { return nil }
    return UInt32(s.dropFirst(), radix: 16)
  }

  /// teamShades(hex, 1, mode)[0] in color.js.
  static func shade(_ hex: String, mode: Mode) -> UInt32 {
    let (lo, hi) = mode == .light ? (0.43, 0.72) : (0.54, 0.74)
    var c = oklch(parse(hex) ?? 0x8e8d86)
    c.L = min(hi, max(lo, c.L))
    return rgbHex(c)
  }

  static func shadeHex(_ hex: String, mode: Mode) -> String { String(format: "#%06x", shade(hex, mode: mode)) }

  private struct LCH { var L: Double, C: Double, H: Double }
  private static func toLin(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
  private static func toSrgb(_ c: Double) -> Double { c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055 }

  private static func oklch(_ n: UInt32) -> LCH {
    let r = toLin(Double((n >> 16) & 255) / 255), g = toLin(Double((n >> 8) & 255) / 255), b = toLin(Double(n & 255) / 255)
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    let L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    let A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    let B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    return LCH(L: L, C: hypot(A, B), H: atan2(B, A))
  }

  private static func rgb(_ c: LCH) -> [Double] {
    let A = c.C * cos(c.H), B = c.C * sin(c.H)
    let l = pow(c.L + 0.3963377774 * A + 0.2158037573 * B, 3)
    let m = pow(c.L - 0.1055613458 * A - 0.0638541728 * B, 3)
    let s = pow(c.L - 0.0894841775 * A - 1.291485548 * B, 3)
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
  }

  private static func rgbHex(_ c: LCH) -> UInt32 {
    // reduce chroma until the color fits in sRGB
    var out = rgb(c), C = c.C
    while out.contains(where: { $0 < -0.0005 || $0 > 1.0005 }) && C > 0 { C -= 0.005; out = rgb(LCH(L: c.L, C: C, H: c.H)) }
    let bytes = out.map { UInt32((min(1, max(0, toSrgb(max(0, $0)))) * 255).rounded()) }
    return bytes[0] << 16 | bytes[1] << 8 | bytes[2]
  }
}

// MARK: - Type scale (Hairline)

extension Font {
  static let pageTitle = Font.system(size: 28, weight: .bold)
  static let sectionTitle = Font.system(size: 19, weight: .bold)
  static let itemTitle = Font.system(size: 17, weight: .bold)
  static let figure = Font.system(size: 26, weight: .semibold).monospacedDigit()
  static let label = Font.system(size: 13, weight: .medium)
  static let caption12 = Font.system(size: 12, weight: .medium)
}
