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

async function drawPreviewCard(race) {
  const sum = raceSummary(race);
  const W = 1200, H = 630, PAD = 64, STRIP = 60;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const font = (weight, size) => `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const darkColor = (hex) => teamShades(hex, 1, 'dark')[0];
  const initialsOf = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const fit = (text, max) => {
    if (ctx.measureText(text).width <= max) return text;
    while (text.length > 1 && ctx.measureText(`${text}…`).width > max) text = text.slice(0, -1);
    return `${text}…`;
  };
  const disc = (img, x, y, r, color, label) => {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath();
    if (img) { ctx.clip(); ctx.drawImage(img, x - r, y - r, r * 2, r * 2); }
    else {
      ctx.fillStyle = '#242422'; ctx.fill();
      ctx.fillStyle = '#f0efec'; ctx.font = font(700, r * 0.8); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(initialsOf(label), x, y + 1);
    }
    ctx.restore();
  };

  ctx.fillStyle = '#111110'; ctx.fillRect(0, 0, W, H);
  const sq = 30;
  for (let y = 0; y < H; y += sq) for (let c = 0; c < 2; c++) {
    if ((y / sq + c) % 2 === 0) { ctx.fillStyle = '#f0efec'; ctx.fillRect(W - STRIP + c * sq, y, sq, sq); }
  }
  const maxW = W - STRIP - PAD * 2;

  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) { ctx.fillStyle = '#f0efec'; ctx.fillRect(PAD + i * 7, 48 + j * 7, 7, 7); }
  ctx.fillStyle = '#8e8d86'; ctx.font = font(700, 22); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillText('KARTING HUB', PAD + 42, 70);

  ctx.fillStyle = '#f0efec'; ctx.font = font(800, 62);
  const words = sum.name.split(/\s+/);
  const lines = [''];
  for (const w of words) {
    const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
    if (ctx.measureText(next).width > maxW && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = next;
  }
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] = fit(`${shown[1]} ${lines.slice(2).join(' ')}`, maxW);
  let y = 150;
  for (const l of shown) { ctx.fillText(l, PAD, y); y += 70; }
  ctx.fillStyle = '#c3c2b7'; ctx.font = font(500, 30);
  ctx.fillText(fit([sum.date, sum.track].filter(Boolean).join('  ·  '), maxW), PAD, y - 12);

  const karts = race.karts || [];
  let tx = PAD;
  const ty = y + 58;
  const teamImgs = await Promise.all(karts.map((k) => loadImg(k.team && photoUrl('teams', k.team))));
  ctx.font = font(650, 28);
  karts.slice(0, 4).forEach((k, i) => {
    const color = darkColor(teamColor(k, i));
    ctx.font = font(650, 28);
    const name = fit(k.team || `Kart #${k.number}`, 300);
    const nameW = ctx.measureText(name).width;
    ctx.font = font(500, 24);
    const num = k.team ? `#${k.number}` : '';
    const w = 54 + nameW + (num ? 10 + ctx.measureText(num).width : 0);
    if (tx + w > W - STRIP - PAD) return; // more teams than fit: the rest are left off the card
    disc(teamImgs[i], tx + 22, ty - 9, 20, color, name);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f0efec'; ctx.font = font(650, 28); ctx.fillText(name, tx + 54, ty);
    if (num) { ctx.fillStyle = '#8e8d86'; ctx.font = font(500, 24); ctx.fillText(num, tx + 64 + nameW, ty); }
    tx += w + 36;
  });

  const lapCount = Math.max(0, ...karts.map((k) => (k.laps.length ? k.laps[k.laps.length - 1].lap : 0)));
  const longest = Math.max(0, ...karts.map((k) => k.laps.reduce((a, l) => a + l.ms, 0)));
  const hrs = longest / 3600000;
  // 1:59:01 -> "2 h", 1:30:00 -> "1.5 h"
  const hours = hrs < 1 ? `${Math.round(longest / 60000)} min` : Math.abs(hrs - Math.round(hrs)) < 0.1 ? `${Math.round(hrs)} h` : `${hrs.toFixed(1)} h`;
  ctx.fillStyle = '#8e8d86'; ctx.font = font(500, 24); ctx.textAlign = 'left';
  ctx.fillText(`${karts.length} kart${karts.length === 1 ? '' : 's'}  ·  ${sum.drivers.length} driver${sum.drivers.length === 1 ? '' : 's'}  ·  ${lapCount} laps  ·  ${hours}`, PAD, ty + 62);

  if (sum.fastest) {
    const f = sum.fastest;
    const ki = karts.findIndex((k) => k.number === f.kart);
    const tColor = darkColor(teamColor(karts[ki] || {}, Math.max(0, ki)));
    const own = ownColors().get(driverId(f.driver));
    const dColor = own ? darkColor(own) : tColor;
    const bx = PAD, by = 438, bw = maxW, bh = 132;
    ctx.fillStyle = '#1c1c1b';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 18); ctx.fill();
    ctx.fillStyle = tColor; ctx.beginPath(); ctx.roundRect(bx, by, 10, bh, [18, 0, 0, 18]); ctx.fill();
    const dImg = await loadImg(photoUrl('drivers', f.driver));
    disc(dImg, bx + 92, by + bh / 2, 46, dColor, f.driver);
    if (own) { ctx.beginPath(); ctx.arc(bx + 92, by + bh / 2, 54, Math.PI * 0.75, Math.PI * 1.75); ctx.strokeStyle = tColor; ctx.lineWidth = 4; ctx.stroke(); }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8e8d86'; ctx.font = font(700, 20); ctx.fillText('FASTEST LAP', bx + 170, by + 42);
    ctx.fillStyle = '#f0efec'; ctx.font = font(800, 64); ctx.fillText(fmtTime(f.ms), bx + 166, by + 108);
    const tw = ctx.measureText(fmtTime(f.ms)).width;
    ctx.font = font(700, 34); ctx.fillStyle = '#f0efec';
    ctx.fillText(fit(f.driver, bw - tw - 230), bx + 196 + tw, by + 74);
    ctx.font = font(500, 26); ctx.fillStyle = '#c3c2b7';
    ctx.fillText(fit(`${f.team || `Kart #${f.kart}`} · lap ${f.lap}`, bw - tw - 230), bx + 196 + tw, by + 110);
  }
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
