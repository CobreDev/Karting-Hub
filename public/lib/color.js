// OKLCH helpers that keep team and driver colors readable on light and dark backgrounds.

const BANDS = { light: [0.43, 0.72], dark: [0.54, 0.74] };
export const DEFAULT_TEAM_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToOklch(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) };
}

function oklchToRgb({ L, C, H }) {
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function oklchToHex(c) {
  // Reduce chroma until the color fits in sRGB.
  let rgb = oklchToRgb(c);
  for (let C = c.C; rgb.some((v) => v < -0.0005 || v > 1.0005) && C > 0; C -= 0.005) rgb = oklchToRgb({ ...c, C });
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, toSrgb(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')).join('');
}

export function isHex(s) {
  return /^#[0-9a-f]{6}$/i.test(s || '');
}

/** n shades of a team color for one theme: the base (clamped into the band) first, then lighter/darker steps. */
export function teamShades(hex, n, mode) {
  const [lo, hi] = BANDS[mode];
  const base = hexToOklch(hex);
  const L0 = Math.min(hi, Math.max(lo, base.L));
  if (n <= 1) return [oklchToHex({ ...base, L: L0 })];
  // n evenly spaced steps that fit in the band, positioned to include the base as closely as possible.
  const step = Math.min(0.085, (hi - lo) / (n - 1));
  const start = Math.min(hi - (n - 1) * step, Math.max(lo, L0 - Math.floor((n - 1) / 2) * step));
  const Ls = Array.from({ length: n }, (_, i) => start + i * step);
  // Base-nearest shade first (first driver gets the team color), then the rest by distance from it.
  Ls.sort((a, b) => Math.abs(a - L0) - Math.abs(b - L0));
  Ls[0] = L0;
  return Ls.map((L) => oklchToHex({ ...base, L }));
}
