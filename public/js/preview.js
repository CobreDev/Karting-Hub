import { fmtTime, driverId, raceSummary } from '../lib/race.js';
import { teamShades } from '../lib/color.js';
import { api, state, token } from './core.js';
import { photoUrl } from './photos.js';
import { ownColors, teamColor } from './registry.js';

// Link-preview card. Drawn in the browser because the server has no image library.
const loadImg = async (url) => {
  if (!url) return null;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  }
};

// Hairline light theme: ink on paper, rules instead of boxes, the fastest lap as the biggest number.
// Cards saved before this date use an older design; an admin opening the race redraws them.
export const CARD_DESIGN = Date.parse('2026-10-28T03:30Z');
const INK = '#161614', SECONDARY = '#55534d', MUTED = '#6d6b64', RULE = '#dcdad2', PAPER = '#f6f5f1', SURFACE = '#efeee9';

async function drawPreviewCard(race) {
  const sum = raceSummary(race);
  const W = 1200, H = 630, PAD = 64, maxW = W - PAD * 2;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const font = (weight, size) => `${weight} ${size}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const text = (str, x, y, { weight = 400, size = 26, color = INK, track = 0 } = {}) => {
    ctx.font = font(weight, size);
    ctx.fillStyle = color;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${track * size}px`;
    ctx.fillText(str, x, y);
    const w = ctx.measureText(str).width;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    return w;
  };
  const lightColor = (hex) => teamShades(hex, 1, 'light')[0];
  const initialsOf = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const fit = (str, max) => {
    if (ctx.measureText(str).width <= max) return str;
    while (str.length > 1 && ctx.measureText(`${str}…`).width > max) str = str.slice(0, -1);
    return `${str}…`;
  };
  const rule = (y) => { ctx.fillStyle = RULE; ctx.fillRect(PAD, y, maxW, 2); };
  // photo or initials in a ring of the item's color; a second color takes the top-left half of the ring
  const disc = (img, x, y, r, color, label, second) => {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    if (second) { ctx.beginPath(); ctx.arc(x, y, r + 3, Math.PI * 0.75, Math.PI * 1.75); ctx.closePath(); ctx.fillStyle = second; ctx.fill(); }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath();
    if (img) { ctx.clip(); ctx.drawImage(img, x - r, y - r, r * 2, r * 2); }
    else {
      ctx.fillStyle = SURFACE; ctx.fill();
      ctx.fillStyle = SECONDARY; ctx.font = font(650, r * 0.75); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(initialsOf(label), x, y + 1);
    }
    ctx.restore();
  };

  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  text('Karting Hub', PAD, 84, { weight: 600, size: 24, color: MUTED });

  // title block sits on the first rule, so a one-line name leaves the space above it
  const RULE1 = 318;
  ctx.font = font(750, 62);
  const lines = [''];
  for (const w of sum.name.split(/\s+/)) {
    const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
    if (ctx.measureText(next).width > maxW && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = next;
  }
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] = fit(`${shown[1]} ${lines.slice(2).join(' ')}`, maxW);
  const metaY = RULE1 - 40;
  // a second line steps down a size so it clears the wordmark
  const size = shown.length > 1 ? 56 : 62;
  shown.forEach((l, i) => text(l, PAD, metaY - 54 - (shown.length - 1 - i) * (size + 6), { weight: 750, size, track: -0.025 }));
  ctx.font = font(400, 28);
  text(fit([sum.date, sum.track].filter(Boolean).join(' · '), maxW), PAD, metaY, { size: 28, color: SECONDARY });
  rule(RULE1);

  const karts = race.karts || [];
  const lapCount = Math.max(0, ...karts.map((k) => (k.laps.length ? k.laps[k.laps.length - 1].lap : 0)));
  const longest = Math.max(0, ...karts.map((k) => k.laps.reduce((a, l) => a + l.ms, 0)));
  const hrs = longest / 3600000;
  // 1:59:01 -> "2 h", 1:30:00 -> "1.5 h"
  const hours = hrs < 1 ? `${Math.round(longest / 60000)} min` : Math.abs(hrs - Math.round(hrs)) < 0.1 ? `${Math.round(hrs)} h` : `${hrs.toFixed(1)} h`;
  const LABEL = RULE1 + 54, FIG = LABEL + 72, SUB = FIG + 46;
  const figure = (label, value, x) => {
    text(label, x, LABEL, { weight: 500, size: 24, color: MUTED });
    return text(value, x, FIG, { weight: 650, size: 68, track: -0.02 });
  };

  if (sum.fastest) {
    const f = sum.fastest;
    const ki = karts.findIndex((k) => k.number === f.kart);
    const tColor = lightColor(teamColor(karts[ki] || {}, Math.max(0, ki)));
    const own = ownColors().get(driverId(f.driver));
    figure('Fastest lap', fmtTime(f.ms), PAD);
    const dImg = await loadImg(photoUrl('drivers', f.driver));
    disc(dImg, PAD + 17, SUB - 9, 17, own ? lightColor(own) : tColor, f.driver, own && tColor);
    ctx.font = font(600, 26);
    const name = fit(f.driver, 300);
    const nw = text(name, PAD + 46, SUB, { weight: 600, size: 26 });
    ctx.font = font(400, 26);
    text(fit(` · lap ${f.lap}`, 420 - nw), PAD + 46 + nw, SUB, { size: 26, color: SECONDARY });
  }
  const cols = [['Laps', String(lapCount)], ['Duration', hours], ['Drivers', String(sum.drivers.length)]];
  cols.forEach(([label, value], i) => figure(label, value, PAD + 520 + i * 210));

  const RULE2 = SUB + 34;
  rule(RULE2);
  const ty = RULE2 + 62;
  let tx = PAD;
  const teamImgs = await Promise.all(karts.map((k) => loadImg(k.team && photoUrl('teams', k.team))));
  karts.forEach((k, i) => {
    ctx.font = font(650, 28);
    const name = fit(k.team || `Kart #${k.number}`, 320);
    const nameW = ctx.measureText(name).width;
    ctx.font = font(400, 24);
    const num = k.team ? `#${k.number}` : '';
    const w = 50 + nameW + (num ? 10 + ctx.measureText(num).width : 0);
    if (tx + w > W - PAD) return; // more teams than fit: the rest are left off the card
    disc(teamImgs[i], tx + 18, ty - 10, 18, lightColor(teamColor(k, i)), name);
    text(name, tx + 50, ty, { weight: 650, size: 28 });
    if (num) text(num, tx + 60 + nameW, ty, { size: 24, color: MUTED });
    tx += w + 40;
  });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export async function uploadPreview(race) {
  if (!token.get() || !race?.id) return false;
  const blob = await drawPreviewCard(race);
  const res = await fetch(`/api/images/previews/${encodeURIComponent(race.id)}`, {
    method: 'PUT', body: blob, headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token.get()}` },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  state.images.previews = { ...(state.images.previews || {}), [race.id]: (await res.json()).version };
  return true;
}

// Redraw the cards of races that use a changed photo or color. Debounced so a burst of edits is one pass.
const previewQueue = { drivers: new Set(), teams: new Set(), races: new Set() };
let previewTimer;
export function refreshPreviews({ drivers = [], teams = [], races = [] } = {}) {
  if (!state.config.editable || !token.get()) return;
  drivers.forEach((n) => previewQueue.drivers.add(driverId(n)));
  teams.forEach((n) => previewQueue.teams.add(driverId(n)));
  races.forEach((id) => previewQueue.races.add(id));
  clearTimeout(previewTimer);
  previewTimer = setTimeout(flushPreviews, 1500);
}
async function flushPreviews() {
  const q = { drivers: new Set(previewQueue.drivers), teams: new Set(previewQueue.teams), races: new Set(previewQueue.races) };
  Object.values(previewQueue).forEach((set) => set.clear());
  const summaries = await api('races').catch(() => []);
  for (const r of summaries) {
    const hit = q.races.has(r.id) || (r.lineups || []).some((l) => q.teams.has(driverId(l.team)) || l.drivers.some((d) => q.drivers.has(driverId(d))));
    if (!hit) continue;
    try { await uploadPreview(await api(`races/${encodeURIComponent(r.id)}`)); } catch { /* best effort: the next change retries */ }
  }
}
export const colorChanges = (before, after) => {
  const was = new Map(before.map((x) => [driverId(x.name), x.color || '']));
  const now = new Map(after.map((x) => [driverId(x.name), x.color || '']));
  return [...new Set([...was.keys(), ...now.keys()])].filter((id) => was.get(id) !== now.get(id));
};
