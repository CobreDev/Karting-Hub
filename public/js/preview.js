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

// Cards saved before this date use an older design; an admin opening the race redraws them.
export const CARD_DESIGN = Date.parse('2026-10-28T03:33Z');

// Hairline dark theme: rules instead of boxes, the fastest lap as the biggest number, a checkered edge.
const INK = '#ecebe6', SECONDARY = '#bdbbb2', MUTED = '#8f8d85', RULE = '#2f2e2b', PAPER = '#0f0f0e', SURFACE = '#222220';

async function drawPreviewCard(race) {
  const sum = raceSummary(race);
  const W = 1200, H = 630, PAD = 64, STRIP = 60, maxW = W - STRIP - PAD * 2;
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
  const themeColor = (hex) => teamShades(hex, 1, 'dark')[0];
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
  const SQ = 30;
  ctx.fillStyle = INK;
  for (let y = 0; y < H; y += SQ) for (let c = 0; c < 2; c++) if ((y / SQ + c) % 2 === 0) ctx.fillRect(W - STRIP + c * SQ, y, SQ, SQ);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) ctx.fillRect(PAD + i * 6, 62 + j * 6, 6, 6);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  text('Karting Hub', PAD + 36, 84, { weight: 600, size: 24, color: MUTED });

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
  const lapsOf = (k) => (k.laps.length ? k.laps[k.laps.length - 1].lap : 0);
  const totalOf = (k) => k.laps.reduce((a, l) => a + l.ms, 0);
  const longest = Math.max(0, ...karts.map(totalOf));
  const hrs = longest / 3600000;
  // 1:59:01 -> "2 h", 1:30:00 -> "1.5 h"
  const hours = hrs < 1 ? `${Math.round(longest / 60000)} min` : Math.abs(hrs - Math.round(hrs)) < 0.1 ? `${Math.round(hrs)} h` : `${hrs.toFixed(1)} h`;
  const teamImgs = await Promise.all(karts.map((k) => loadImg(k.team && photoUrl('teams', k.team))));
  const LABEL = RULE1 + 54, FIG = LABEL + 72, SUB = FIG + 46;
  const label = (str, x) => text(str, x, LABEL, { weight: 500, size: 24, color: MUTED });
  const figure = (str, x) => text(str, x, FIG, { weight: 650, size: 68, track: -0.02 });
  // a photo or initials, a bold name and a quieter detail, all on the line under a figure
  const byline = (img, color, second, name, detail, x, max) => {
    disc(img, x + 17, SUB - 9, 17, color, name, second);
    ctx.font = font(600, 26);
    const nw = text(fit(name, max - 46), x + 46, SUB, { weight: 600, size: 26 });
    ctx.font = font(400, 26);
    text(fit(detail, max - 46 - nw), x + 46 + nw, SUB, { size: 26, color: SECONDARY });
  };

  // winner: most laps, then the shorter total time (same rule as the race page)
  const wi = karts.reduce((b, k, i) => (b < 0 || lapsOf(k) > lapsOf(karts[b]) || (lapsOf(k) === lapsOf(karts[b]) && totalOf(k) < totalOf(karts[b])) ? i : b), -1);
  if (wi >= 0) {
    const w = karts[wi];
    const name = w.team || `Kart #${w.number}`;
    label('Winner', PAD);
    disc(teamImgs[wi], PAD + 24, FIG - 18, 24, themeColor(teamColor(w, wi)), name);
    // long team names step down in size before they get cut off
    let size = 44;
    for (; size > 32; size -= 2) { ctx.font = font(700, size); if (ctx.measureText(name).width <= 380) break; }
    text(fit(name, 380), PAD + 62, FIG - 4, { weight: 700, size, track: -0.015 });
    ctx.font = font(400, 26);
    text(fit(`${lapsOf(w)} laps${w.team ? ` · #${w.number}` : ''}`, 420), PAD, SUB, { size: 26, color: SECONDARY });
  }
  const FX = PAD + 480;
  if (sum.fastest) {
    const f = sum.fastest;
    const ki = karts.findIndex((k) => k.number === f.kart);
    const tColor = themeColor(teamColor(karts[ki] || {}, Math.max(0, ki)));
    const own = ownColors().get(driverId(f.driver));
    label('Fastest lap', FX);
    figure(fmtTime(f.ms), FX);
    byline(await loadImg(photoUrl('drivers', f.driver)), own ? themeColor(own) : tColor, own && tColor, f.driver, ` · lap ${f.lap}`, FX, 320);
  }
  label('Duration', FX + 340);
  figure(hours, FX + 340);

  const RULE2 = SUB + 34;
  rule(RULE2);
  const ty = RULE2 + 62;
  let tx = PAD;
  karts.forEach((k, i) => {
    ctx.font = font(650, 28);
    const name = fit(k.team || `Kart #${k.number}`, 320);
    const nameW = ctx.measureText(name).width;
    ctx.font = font(400, 24);
    const num = k.team ? `#${k.number}` : '';
    const w = 50 + nameW + (num ? 10 + ctx.measureText(num).width : 0);
    if (tx + w > W - STRIP - PAD) return; // more teams than fit: the rest are left off the card
    disc(teamImgs[i], tx + 18, ty - 10, 18, themeColor(teamColor(k, i)), name);
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
