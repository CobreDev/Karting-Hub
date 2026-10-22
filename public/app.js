import {
  parseRaceMonitor, mergeLaps, missingLaps, pitCandidates, computeDrivers,
  fmtTime, fmtDelta, slugify, quantile, driverId, raceSummary, ROLES, teamListErrors, normalizeTeams, DEFAULT_SLOW_FACTOR,
} from './lib/race.js';
import { teamShades, isHex, DEFAULT_TEAM_COLORS } from './lib/color.js';
import { imageId, IMAGE_SIZE } from './lib/images.js';

const app = document.getElementById('app');
const state = { config: { editable: false }, hidden: new Set(), edit: null, pending: [], registry: [], teams: [], images: { drivers: {}, teams: {} } };

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const token = {
  get: () => { try { return localStorage.getItem('kh_token') || ''; } catch { return ''; } },
  set: (v) => { try { localStorage.setItem('kh_token', v); } catch {} },
};
async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.auth ? { Authorization: `Bearer ${token.get()}` } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(`${d}T12:00:00`);
  return Number.isNaN(+dt) ? d : dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};
/** Race Monitor's clock format: 49250 -> "00:49.250" */
const fmtClock = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
/** "Cooper Hull" -> "Cooper H." for narrow screens; single names stay as they are. */
const shortName = (name) => {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};

/** Width of the lap list's Driver column, sized to the longest name on the team (full on desktop, short on phones). */
let measureCtx;
function driverColumnWidths(kart) {
  measureCtx ||= document.createElement('canvas').getContext('2d');
  const widest = (names, px, weight) => {
    measureCtx.font = `${weight} ${px}px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    return Math.max(0, ...names.map((n) => measureCtx.measureText(n).width));
  };
  const names = [...new Set(kart.chunks.map((c) => c.d.driver))];
  // name (semibold when highlighted) + avatar + gap, with a little slack
  const full = Math.ceil(widest(names, 14, 600) + 22 + 8 + 6);
  const short = Math.ceil(widest(names.map(shortName), 12, 600) + 18 + 4 + 2);
  return `--dw:${Math.min(220, Math.max(90, full))}px;--dw-sm:${Math.min(110, Math.max(62, short))}px`;
}

/** Driver swatch: split team/driver color when the driver has their own color, otherwise the team color. */
const swatch = (d, style = '') => `<span class="swatch" style="background:${d.ownColor ? `linear-gradient(135deg, ${d.teamColor} 50%, ${d.color} 50%)` : d.color};${style}"></span>`;
const stintText =(e) => e.stints.map((s) => `${s.from}–${s.to}`).join(', ');
/** Team color: the saved team's color, then the kart's own (older races), then a palette slot. */
const teamColor = (kart, i) => {
  const saved = kart.team && savedTeam(kart.team)?.color;
  if (isHex(saved)) return saved;
  return isHex(kart.color) ? kart.color : DEFAULT_TEAM_COLORS[i % DEFAULT_TEAM_COLORS.length];
};
const teamLabel = (k) => k.team || `Kart #${k.number}`;

const ownColors = () => new Map(state.registry.filter((d) => isHex(d.color)).map((d) => [driverId(d.name), d.color]));
async function loadRegistry() {
  const [drivers, teams, images] = await Promise.all([
    api('drivers').catch(() => ({ drivers: [] })),
    api('teams').catch(() => ({ teams: [] })),
    api('images').catch(() => null),
  ]);
  state.registry = drivers.drivers;
  state.teams = normalizeTeams(teams.teams);
  if (images) state.images = images;
}
const savedTeam = (name) => state.teams.find((t) => driverId(t.name) === driverId(name));

// ---------- profile pictures ----------
const photoUrl = (kind, name) => {
  const id = imageId(name);
  const v = id && state.images[kind]?.[id];
  return v ? `/images/${kind}/${id}?v=${v}` : null;
};
/** Round photo with a ring in the driver/team color, or `fallback` HTML when there's no photo. */
const avatar = (kind, name, size, ring, fallback = '') => {
  const url = photoUrl(kind, name);
  return url ? `<img class="avatar" src="${url}" alt="" width="${size}" height="${size}" loading="lazy" style="--ring:${ring}">` : fallback;
};
/** Ring for a driver: their color, split with the team color when they have a personal one. */
const driverRingOf = (d) => (d.ownColor ? `linear-gradient(135deg, ${d.teamColor} 50%, ${d.color} 50%)` : d.color);
/** Round initials badge used wherever a driver or team has no photo. */
const initialsBadge = (name, size, ring) => `<span class="avatar placeholder" style="--ring:${ring};width:${size}px;height:${size}px;font-size:${Math.max(8, Math.round(size * 0.38))}px">${initials(name)}</span>`;
const personAvatar = (name, size, ring) => avatar('drivers', name, size, ring, initialsBadge(name, size, ring));
const driverAvatar = (d, size = 22) => personAvatar(d.driver, size, driverRingOf(d));
const initials = (name) => esc(String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());

/**
 * Center-crops to a square and scales to IMAGE_SIZE in the browser, so phones never upload 5 MB photos.
 * Steps down by halves for a sharper result than one big downscale. Returns a WebP (or JPEG) blob.
 */
async function resizeImage(file) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That file isn't an image this browser can read."));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const side = Math.min(w, h);
  let canvas = document.createElement('canvas');
  let cur = Math.max(IMAGE_SIZE, side);
  canvas.width = canvas.height = cur;
  let ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, cur, cur);
  while (cur / 2 >= IMAGE_SIZE) {
    const next = document.createElement('canvas');
    cur = Math.max(IMAGE_SIZE, Math.floor(cur / 2));
    next.width = next.height = cur;
    ctx = next.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, cur, cur);
    canvas = next;
  }
  if (cur !== IMAGE_SIZE) {
    const out = document.createElement('canvas');
    out.width = out.height = IMAGE_SIZE;
    ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
    canvas = out;
  }
  const encode = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode('image/webp');
  return webp && webp.type === 'image/webp' ? webp : encode('image/jpeg');
}

/** Upload control: current photo (or initials), a Choose/Change button, and Remove. */
function photoPicker(kind, name, ring) {
  return `<div class="photo-picker">
    ${avatar(kind, name, 48, ring, `<span class="avatar placeholder" style="--ring:${ring}">${initials(name)}</span>`)}
    ${photoButtons(kind, name)}
  </div>`;
}

/** Just the Add/Change photo and Remove photo buttons, for layouts that show the photo elsewhere. */
function photoButtons(kind, name) {
  const has = !!photoUrl(kind, name);
  const disabled = !String(name || '').trim();
  return `<label class="btn small ${disabled ? 'disabled' : ''}" title="${disabled ? 'Enter a name first' : 'Square crop, resized to 256 px'}">
      ${has ? 'Change photo' : 'Add photo'}
      <input type="file" accept="image/*" hidden data-photo-kind="${kind}" data-photo-name="${esc(name)}" ${disabled ? 'disabled' : ''}>
    </label>
    ${has ? `<button class="btn small" type="button" data-photo-remove="${kind}" data-photo-name="${esc(name)}">Remove photo</button>` : ''}`;
}

/** Wires up every photoPicker on the page; `done(message)` re-renders it. */
function bindPhotoPickers(done) {
  const tokenField = document.getElementById('token');
  const auth = () => { if (tokenField) token.set(tokenField.value.trim()); };
  const call = async (kind, name, opts) => {
    const res = await fetch(`/api/images/${kind}/${encodeURIComponent(imageId(name))}`, {
      ...opts, headers: { Authorization: `Bearer ${token.get()}`, ...(opts.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  };
  app.querySelectorAll('[data-photo-kind]').forEach((el) => el.addEventListener('change', async () => {
    const file = el.files[0];
    if (!file) return;
    const { photoKind: kind, photoName: name } = el.dataset;
    auth();
    try {
      const blob = await resizeImage(file);
      const { version } = await call(kind, name, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } });
      state.images[kind][imageId(name)] = version;
      refreshPreviews({ [kind]: [name] });
      done(`Photo saved for ${esc(name)} (${Math.round(blob.size / 1024)} KB).`);
    } catch (e) {
      done(`Couldn't save the photo: ${esc(e.message)}`);
    }
  }));
  app.querySelectorAll('[data-photo-remove]').forEach((el) => el.addEventListener('click', async () => {
    const kind = el.dataset.photoRemove, name = el.dataset.photoName;
    auth();
    try {
      await call(kind, name, { method: 'DELETE' });
      delete state.images[kind][imageId(name)];
      refreshPreviews({ [kind]: [name] });
      done(`Photo removed for ${esc(name)}.`);
    } catch (e) {
      done(`Couldn't remove the photo: ${esc(e.message)}`);
    }
  }));
}

/**
 * Drivers with a personal color (from the saved driver list) use it, nudged into each theme's readable band;
 * everyone else uses exactly their team's color, so teammates match. Written as CSS variables so the theme toggle just works.
 */
function applyTeamColors(race, drivers) {
  const vars = { light: [], dark: [] };
  const own = ownColors();
  race.karts.forEach((k, ki) => {
    const mine = drivers.filter((d) => d.kart === k.number);
    for (const mode of ['light', 'dark']) {
      const team = teamShades(teamColor(k, ki), 1, mode)[0];
      vars[mode].push(`--t-${ki}:${team}`);
      mine.forEach((d) => {
        const mineColor = own.get(driverId(d.driver));
        vars[mode].push(`--d-${drivers.indexOf(d)}:${mineColor ? teamShades(mineColor, 1, mode)[0] : team}`);
      });
    }
    mine.forEach((d) => {
      d.teamColor = `var(--t-${ki})`;
      d.ownColor = own.has(driverId(d.driver));
    });
  });
  drivers.forEach((d, i) => (d.color = `var(--d-${i})`));
  let el = document.getElementById('team-colors');
  if (!el) { el = document.createElement('style'); el.id = 'team-colors'; document.head.append(el); }
  const dark = vars.dark.join(';');
  el.textContent = `:root{${vars.light.join(';')}}
    @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}
    :root[data-theme="dark"]{${dark}}`;
}

// ---------- theme ----------
(() => {
  const btn = document.getElementById('theme-toggle');
  let saved = null;
  try { saved = localStorage.getItem('kh_theme'); } catch {}
  if (saved) document.documentElement.dataset.theme = saved;
  btn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('kh_theme', next); } catch {}
  });
})();

// ---------- routing ----------
// Real paths (/r/<race>) rather than #/ links, so the server sees the race and can serve link previews.
function navigate(path, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  route();
}

async function route() {
  // Old #/ links still work: move them to the matching path.
  if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1) || '/');
  const parts = location.pathname.replace(/^\/+/, '').split('/').filter(Boolean).map(decodeURIComponent);
  window.onresize = null;
  app.onclick = null;
  try {
    if (parts[0] === 'r' && parts[1]) return await showRace(parts[1], parts[2], parts[3]);
    if (parts[0] === 'edit' && parts[1]) return await showEditor(parts[1]);
    if (parts[0] === 'new') return await showEditor(null);
    if (parts[0] === 'drivers') return await showDrivers();
    if (parts[0] === 'teams') return await showTeams();
    return await showHome();
  } catch (e) {
    app.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p><a href="/">Back to races</a></div>`;
  }
}
window.addEventListener('popstate', route);
// In-app links navigate without a full page load.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || a.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
  window.scrollTo(0, 0);
});

// ---------- home ----------
async function showHome() {
  document.title = 'Karting Hub';
  const races = await api('races');
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Races</h1><div class="meta">Lap times and stints from Race Monitor exports</div></div>
      <div class="actions"><a class="btn" href="/teams">Teams</a><a class="btn" href="/drivers">Drivers</a>${state.config.editable ? '<a class="btn primary" href="/new">+ New race</a>' : ''}</div>
    </div>
    ${races.length ? `<div class="race-grid">${races.map((r) => `
      <a class="card race-card" href="/r/${encodeURIComponent(r.id)}">
        <h2>${esc(r.name)}</h2>
        <div class="secondary">${esc(fmtDate(r.date))}${r.track ? ` · ${esc(r.track)}` : ''}</div>
        <div class="drivers">${r.teams?.length ? esc(r.teams.join(' vs ')) : `${r.karts} kart${r.karts === 1 ? '' : 's'}`}${r.drivers.length ? ` · ${esc(r.drivers.join(', '))}` : ''}</div>
      </a>`).join('')}</div>`
    : `<div class="card muted">No races yet.${state.config.editable ? ' <a href="/new">Add one</a>.' : ''}</div>`}`;
}

// ---------- race dashboard ----------
/** `/r/:id` race; `/r/:id/:driverKey` highlights a driver; `/r/:id/team/:kart` opens a team's laps. */
async function showRace(id, focusKey, teamArg) {
  const [race] = await Promise.all([api(`races/${encodeURIComponent(id)}`), loadRegistry()]);
  document.title = `${race.name} · Karting Hub`;
  const drivers = computeDrivers(race);
  applyTeamColors(race, drivers);
  const ranked = [...drivers].sort((a, b) => a.best - b.best);
  const teamView = focusKey === 'team';
  // A driver link highlights that driver; a team link (or no link) just shows a team's laps.
  const focus = teamView ? null : drivers.find((d) => d.key === focusKey) || null;
  const karts = kartRuns(race, drivers);
  const lapKart = (teamView && karts.find((r) => r.k.number === teamArg)) || karts.find((r) => r.k.number === (focus || ranked[0])?.kart) || karts[0];
  if (state.raceId !== id) { state.hidden = new Set(); state.raceId = id; }
  state.slowFactor = race.slowFactor;

  const fastest = ranked[0];
  const consistent = [...drivers].filter((d) => d.cleanCount >= 10).sort((a, b) => a.stdev - b.stdev)[0];
  // Race distance is the most laps any kart completed (karts run at the same time, so don't add them up).
  const lapsOf = (k) => (k.laps.length ? k.laps[k.laps.length - 1].lap : 0);
  const raceLaps = Math.max(0, ...race.karts.map(lapsOf));
  const gaps = race.karts.map((k) => ({ k, miss: missingLaps(k.laps) })).filter((g) => g.miss.length);

  app.innerHTML = `
    <div class="page-head">
      <div>
        <div><a href="/">← All races</a></div>
        <h1 style="margin-top:6px">${esc(race.name)}</h1>
        <div class="meta">${esc(fmtDate(race.date))}${race.track ? ` · ${esc(race.track)}` : ''}</div>
      </div>
      <div class="actions">
        <button class="btn" id="copy-link" type="button">Copy link</button>
        ${state.config.editable ? `<a class="btn" href="/edit/${encodeURIComponent(race.id)}">Edit</a>` : ''}
      </div>
    </div>

    <div class="teams">${race.karts.map((k, ki) => `
      <div class="team"><span class="team-bar" style="background:var(--t-${ki})"></span>
        ${avatar('teams', k.team, 44, `var(--t-${ki})`)}
        <div><div class="team-name">${esc(teamLabel(k))}</div>
        <div class="muted">${k.team ? `#${esc(k.number)} · ` : ''}${esc(drivers.filter((d) => d.kart === k.number).map((d) => d.driver).join(' → '))}</div></div></div>`).join('')}</div>

    <div class="tiles">
      ${fastest ? `<div class="card tile"><div class="label">Fastest lap</div><div class="value">${fmtTime(fastest.best)}</div>
        <div class="sub">${esc(fastest.driver)} · #${esc(fastest.kart)} · lap ${fastest.bestLapNo}</div></div>` : ''}
      ${consistent ? `<div class="card tile"><div class="label">Most consistent</div><div class="value">±${(consistent.stdev / 1000).toFixed(3)}</div>
        <div class="sub">${esc(consistent.driver)} · std dev of clean laps</div></div>` : ''}
      <div class="card tile"><div class="label">Race laps</div><div class="value">${raceLaps}</div>
        <div class="sub">${race.karts.length > 1 && race.karts.length <= 4
          ? race.karts.map((k) => `#${esc(k.number)} ${lapsOf(k)}`).join(' · ')
          : `${race.karts.length} kart${race.karts.length === 1 ? '' : 's'}`} · ${drivers.length} driver${drivers.length === 1 ? '' : 's'}</div></div>
    </div>

    <section class="card section">
      <div class="section-head">
        <h2>Drivers</h2>
        <p>Averages use clean laps only — pit/driver-change laps and laps over ${Math.round(((race.slowFactor || DEFAULT_SLOW_FACTOR) - 1) * 100)}% off a driver's median are left out.</p>
      </div>
      <div class="table-wrap">${leaderboard(ranked, focus)}</div>
    </section>

    <section class="card section">
      <div class="section-head"><h2>Lap times</h2><p>One line per kart in the team color. Tap a team to show or hide it.</p></div>
      <div class="chips" id="chips" style="margin-bottom:12px">${karts.map((r) => `
        <button class="chip" type="button" data-key="${esc(r.k.number)}" aria-pressed="${!state.hidden.has(r.k.number)}">
          <span class="swatch" style="background:${r.color}"></span>${esc(r.label)} <span class="muted">#${esc(r.k.number)}</span></button>`).join('')}</div>
      <div class="chart" id="lap-chart"></div>
    </section>

    <section class="card section" id="focus">${lapSection(focus, karts, lapKart)}</section>

    ${gaps.length ? `<p class="muted" style="font-size:13px;margin-top:16px">Timing gaps: ${gaps.map((g) => `#${esc(g.k.number)} has no data for lap${g.miss.length > 1 ? 's' : ''} ${g.miss.join(', ')}`).join('; ')} (missed by the timing loop).</p>` : ''}
  `;

  const drawChart = () => lapChart(document.getElementById('lap-chart'), karts.filter((r) => !state.hidden.has(r.k.number)), focus);
  drawChart();
  let t;
  window.onresize = () => { clearTimeout(t); t = setTimeout(drawChart, 100); };

  document.getElementById('chips').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    const key = chip.dataset.key;
    state.hidden.has(key) ? state.hidden.delete(key) : state.hidden.add(key);
    chip.setAttribute('aria-pressed', String(!state.hidden.has(key)));
    drawChart();
  });
  app.onclick = (ev) => {
    const pick = ev.target.closest('[data-focus]');
    if (pick) navigate(`/r/${encodeURIComponent(race.id)}/${encodeURIComponent(pick.dataset.focus)}`);
    const rerender = () => (document.getElementById('focus').innerHTML = lapSection(focus, karts, lapKart));
    const team = ev.target.closest('[data-team]');
    if (team) navigate(`/r/${encodeURIComponent(race.id)}/team/${encodeURIComponent(team.dataset.team)}`);
    if (ev.target.closest('[data-order]')) { state.newestFirst = !state.newestFirst; rerender(); }

  };
  // Races saved before previews existed get one the first time an admin opens them.
  if (state.config.editable && token.get() && !state.images.previews?.[race.id]) uploadPreview(race).catch(() => {});
  document.getElementById('copy-link').addEventListener('click', async (ev) => {
    try { await navigator.clipboard.writeText(location.href); ev.target.textContent = 'Copied!'; }
    catch { prompt('Copy this link:', location.href); }
    setTimeout(() => (ev.target.textContent = 'Copy link'), 1500);
  });
  if (teamView) document.getElementById('focus').scrollIntoView({ block: 'start' });
  else if (focus) (document.getElementById('focus-start') || document.getElementById('focus')).scrollIntoView({ block: 'center' });
}

function leaderboard(ranked, focus) {
  const lo = Math.min(...ranked.map((d) => d.best));
  const hi = Math.max(...ranked.map((d) => d.p90 || d.best));
  return `<table>
    <thead><tr>
      <th>#</th><th>Driver</th><th class="hide-sm">Team</th><th class="num hide-sm">Laps</th>
      <th class="num">Best</th><th class="num">Gap</th><th class="num hide-sm">Best 5 avg</th>
      <th class="num">Avg</th><th class="num hide-sm">Median</th><th class="num hide-sm">Std dev</th>
      <th class="hide-sm">Pace spread <span title="dot = best lap, bar = 10th–90th percentile of clean laps, tick = median">ⓘ</span></th>
    </tr></thead>
    <tbody>${ranked.map((d, i) => `
      <tr class="clickable ${d.key === focus?.key ? 'focused' : ''}" data-focus="${esc(d.key)}">
        <td class="num muted">${i + 1}</td>
        <td><div class="driver-cell">${driverAvatar(d)}<span>${esc(d.driver)}<span class="show-sm team-sub">${esc(d.team || `Kart #${d.kart}`)}</span></span></div></td>
        <td class="secondary hide-sm" style="white-space:nowrap">${esc(d.team || `Kart #${d.kart}`)} <span class="muted">#${esc(d.kart)}</span></td>
        <td class="num hide-sm" title="Laps ${esc(stintText(d))}">${d.count} <span class="muted">(${esc(stintText(d))})</span></td>
        <td class="num ${i === 0 ? 'best-time' : ''}">${fmtTime(d.best)}</td>
        <td class="num muted">${i === 0 ? '—' : fmtDelta(d.best - ranked[0].best)}</td>
        <td class="num hide-sm">${fmtTime(d.top5)}</td>
        <td class="num">${fmtTime(d.avg)}</td>
        <td class="num hide-sm">${fmtTime(d.median)}</td>
        <td class="num hide-sm">±${(d.stdev / 1000).toFixed(3)}</td>
        <td class="hide-sm spread">${spreadBar(d, lo, hi)}</td>
      </tr>`).join('')}</tbody></table>`;
}

function spreadBar(d, lo, hi) {
  const W = 150, H = 18, pad = 6;
  const x = (ms) => pad + ((ms - lo) / Math.max(1, hi - lo)) * (W - 2 * pad);
  const label = `Best ${fmtTime(d.best)}, middle 80% of clean laps ${fmtTime(d.p10)}–${fmtTime(d.p90)}, median ${fmtTime(d.median)}`;
  return `<svg width="${W}" height="${H}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>
    <line x1="${x(d.p10)}" x2="${x(d.p90)}" y1="9" y2="9" stroke="${d.color}" stroke-width="6" stroke-linecap="round" opacity="0.45"/>
    <line x1="${x(d.median)}" x2="${x(d.median)}" y1="3" y2="15" stroke="${d.color}" stroke-width="2"/>
    <circle cx="${x(d.best)}" cy="9" r="4" fill="${d.color}" stroke="var(--surface-1)" stroke-width="2"/></svg>`;
}

/**
 * One entry per kart: every lap in order, tagged with who drove it, and grouped into
 * consecutive-driver chunks (stints) for the lap list and the chart's driver-change markers.
 */
function kartRuns(race, drivers) {
  return race.karts.map((k, ki) => {
    const laps = drivers.filter((d) => d.kart === k.number)
      .flatMap((d) => d.laps.map((l) => ({ ...l, d })))
      .sort((a, b) => a.lap - b.lap);
    const chunks = [];
    for (const l of laps) {
      const last = chunks[chunks.length - 1];
      if (last && last.d === l.d) last.laps.push(l);
      else chunks.push({ d: l.d, laps: [l] });
    }
    for (const c of chunks) {
      const clean = c.laps.filter((l) => !l.flag).map((l) => l.ms);
      c.from = c.laps[0].lap;
      c.to = c.laps[c.laps.length - 1].lap;
      c.best = c.laps.reduce((b, l) => (l.ms < b.ms ? l : b), c.laps[0]);
      c.avg = clean.reduce((a, b) => a + b, 0) / clean.length;
      c.total = c.laps.reduce((a, l) => a + l.ms, 0);
    }
    return { k, ki, label: teamLabel(k), color: `var(--t-${ki})`, laps, chunks };
  });
}

function lapSection(focus, karts, kart) {
  if (!kart || !kart.laps.length) return '<p class="muted">No laps yet.</p>';
  const fastest = Math.min(...karts.flatMap((r) => r.laps.map((l) => l.ms)));
  const kartBest = kart.laps.reduce((b, l) => (l.ms < b.ms ? l : b), kart.laps[0]);
  const kartTotal = kart.laps.reduce((a, l) => a + l.ms, 0);
  const med = quantile(kart.laps.map((l) => l.ms), 0.5);
  // Race Monitor-style bar: length proportional to lap time, capped so one long pit stop doesn't flatten the rest.
  const scaleMax = Math.min(Math.max(...kart.laps.map((l) => l.ms)), med * 3.2);
  // Δ best is against that driver's own best; Δ prev stays within a stint (no comparing with the last driver's pit lap).
  const rows = kart.chunks.flatMap((c) => c.laps.map((l, i) => {
    const p = c.laps[i - 1];
    return { ...l, c, firstOfStint: i === 0, prev: p && p.lap === l.lap - 1 ? p.ms : null };
  }));
  if (state.newestFirst) rows.reverse();

  return `
    <div class="section-head"><h2>Lap by lap</h2>
      <p>Every lap for the team in race order.</p></div>
    <div class="focus-tabs" role="tablist" aria-label="Team">${karts.map((r) => `
      <button class="chip tab team-tab" type="button" role="tab" data-team="${esc(r.k.number)}" aria-pressed="${r === kart}" aria-selected="${r === kart}">
        ${avatar('teams', r.k.team, 18, r.color, `<span class="swatch" style="background:${r.color}"></span>`)}${esc(r.label)} <span class="muted">#${esc(r.k.number)}</span></button>`).join('')}</div>

    <div class="rm" style="margin-top:14px;${driverColumnWidths(kart)}">
      <div class="rm-head">
        <div class="rm-team">${avatar('teams', kart.k.team, 32, kart.color, `<span class="swatch" style="background:${kart.color}"></span>`)}${esc(kart.label)} · #${esc(kart.k.number)}</div>
        <div class="rm-total"><span>Total:</span> ${kart.laps.length} laps</div>
        <div class="rm-big">${fmtTime(kartTotal)}</div>
        <div class="rm-sub">
          <div><span>Best Lap: ${kartBest.lap}</span><b>${fmtTime(kartBest.ms)}</b></div>
          <div><span>Diff:</span><b>${kartBest.ms === fastest ? '—' : (Math.abs(kartBest.ms - fastest) / 1000).toFixed(3)}</b></div>
        </div>
        <div class="stint-summary">${kart.chunks.map((c) => `
          <span class="stint-sum ${c.d.key === focus?.key ? 'focused' : ''}" style="--stint-color:${c.d.color}">
            ${driverAvatar(c.d, 20)}<b>${esc(c.d.driver)}</b>
            <span>laps ${c.from}–${c.to} · best ${fmtTime(c.best.ms)} · avg ${fmtTime(c.avg)}</span></span>`).join('')}</div>
      </div>
      <div class="rm-toolbar"><button class="btn small" type="button" data-order>${state.newestFirst ? 'Oldest first' : 'Newest first'}</button></div>
      <div class="rm-cols"><span>Lap</span><span class="hide-sm">Pos.</span><span>Driver</span><span>Time</span><span class="num">Δ best</span><span class="num">Δ prev</span><span class="hide-sm"></span></div>
      ${rows.map((l) => {
        const isBest = l.lap === l.c.best.lap;
        const dPrev = l.prev == null ? null : l.ms - l.prev;
        const kind = l.flag === 'pit' ? 'crit' : l.flag === 'slow' ? 'warn' : 'good';
        const handover = state.newestFirst ? l.lap === l.c.to && l.c !== kart.chunks[kart.chunks.length - 1] : l.firstOfStint && l.c !== kart.chunks[0];
        return `<div class="rm-row ${l.c.d.key === focus?.key ? 'focused' : ''} ${handover ? 'handover' : ''}" style="--stint-color:${l.c.d.color}" ${l.lap === l.c.from && l.c.d.key === focus?.key ? 'id="focus-start"' : ''}>
          <span class="rm-lap">${l.lap}</span>
          <span class="rm-pos hide-sm">${l.pos ?? ''}</span>
          <span class="rm-driver">${driverAvatar(l.c.d, 22)}<span class="dn-full">${esc(l.c.d.driver)}</span><span class="dn-short">${esc(shortName(l.c.d.driver))}</span></span>
          <span class="rm-time ${isBest ? 'best-time' : ''}"><span class="t-full">${fmtClock(l.ms)}</span><span class="t-short">${fmtTime(l.ms)}</span>
            <i class="rm-bar ${kind}" style="width:${Math.min(100, (l.ms / scaleMax) * 100).toFixed(1)}%"></i></span>
          <span class="num rm-delta">${isBest ? '<span class="pill best">Best</span>' : fmtDelta(l.ms - l.c.best.ms)}</span>
          <span class="num rm-delta ${dPrev == null ? '' : dPrev < 0 ? 'faster' : 'slower'}">${dPrev == null ? '' : `${dPrev < 0 ? '▼' : '▲'} ${(Math.abs(dPrev) / 1000).toFixed(3)}`}</span>
          <span class="rm-note hide-sm">${l.flag === 'pit' ? '<span class="pill">Pit / change</span>' : l.flag === 'slow' ? '<span class="pill">Slow</span>' : ''}</span>
        </div>`;
      }).join('')}
      <div class="rm-legend"><span><i class="rm-key good"></i>clean</span><span><i class="rm-key warn"></i>slow (over ${Math.round(((state.slowFactor || DEFAULT_SLOW_FACTOR) - 1) * 100)}% off median)</span><span><i class="rm-key crit"></i>pit / driver change</span><span>Δ best is against that driver's best · ▼ faster than previous lap · ▲ slower</span></div>
    </div>`;
}

// ---------- lap time chart (hand-rolled SVG) ----------
/** One line per kart in the team color (two-tone for drivers with their own color), with a labeled marker at each driver change. */
function lapChart(el, karts, focus) {
  if (!karts.length) { el.innerHTML = '<p class="muted">All karts hidden.</p>'; return; }
  const W = Math.max(320, el.clientWidth);
  const rowH = 16;
  const m = { l: 52, r: 12, t: 22, b: 30 + rowH * karts.length };
  const H = (W < 600 ? 250 : 320) + rowH * karts.length;
  const plotBottom = H - m.b;
  const all = karts.flatMap((r) => r.laps);
  const clean = all.filter((l) => !l.flag).map((l) => l.ms);
  const yMin = Math.floor((Math.min(...all.map((l) => l.ms)) - 300) / 500) * 500;
  const yMax = Math.ceil((quantile(clean, 0.995) + 300) / 500) * 500;
  const xMax = Math.max(...all.map((l) => l.lap));
  const x = (lap) => m.l + ((lap - 1) / Math.max(1, xMax - 1)) * (W - m.l - m.r);
  const y = (ms) => m.t + ((yMax - Math.min(ms, yMax)) / (yMax - yMin)) * (plotBottom - m.t);

  const span = yMax - yMin;
  const yStep = span > 8000 ? 2000 : span > 4000 ? 1000 : 500;
  const yTicks = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) yTicks.push(v);
  // Keep lap labels at least ~40px apart.
  const xStep = [5, 10, 20, 25, 50, 100].find((s) => (s / Math.max(1, xMax - 1)) * (W - m.l - m.r) >= 40) || 100;
  const xTicks = [1];
  for (let v = xStep; v <= xMax; v += xStep) xTicks.push(v);

  const series = karts.map((r) => {
    // Consecutive on-scale laps join into polylines of one style; a driver change continues the line in the new
    // driver's color. Laps off the top of the scale (pit stops) aren't drawn: a gray dashed bridge joins the
    // on-scale laps either side. A timing gap (missing laps) breaks the line.
    const runs = [];
    const bridges = [];
    const linked = new Set();
    let cur = null, prevValid = null, skipped = false, prevLap = null;
    for (const l of r.laps) {
      if (prevLap != null && l.lap !== prevLap + 1) { cur = null; prevValid = null; skipped = false; }
      prevLap = l.lap;
      if (l.ms > yMax) { skipped = true; cur = null; continue; }
      if (prevValid && skipped) {
        bridges.push([prevValid, l]);
        linked.add(prevValid).add(l);
        cur = null;
      } else if (prevValid) {
        // Legs touching a slow lap are drawn dotted.
        const off = !!prevValid.flag || !!l.flag;
        const style = `${l.d.key}|${off}`;
        if (cur && cur.style === style) cur.pts.push(l);
        else { cur = { style, d: l.d, color: l.d.color, off, pts: [prevValid, l] }; runs.push(cur); }
        linked.add(prevValid).add(l);
      }
      prevValid = l;
      skipped = false;
    }
    const pt = (l) => `${x(l.lap).toFixed(1)},${y(l.ms).toFixed(1)}`;
    const lines = runs.map((run) => {
      const pts = run.pts.map(pt).join(' ');
      return run.off
        ? `<polyline points="${pts}" fill="none" stroke="${run.color}" stroke-width="1.5" stroke-opacity="0.8" stroke-dasharray="1.5 3" stroke-linecap="round" stroke-linejoin="round"/>`
        : run.d.ownColor
          // Two-tone dash: long team-color dashes with short driver-color dashes in the gaps (16px pattern).
          ? `<polyline points="${pts}" fill="none" stroke="${run.d.teamColor}" stroke-width="2.25" stroke-dasharray="9 7" stroke-linejoin="round"/>
             <polyline points="${pts}" fill="none" stroke="${run.color}" stroke-width="2.25" stroke-dasharray="4 12" stroke-dashoffset="5.5" stroke-linejoin="round"/>`
          : `<polyline points="${pts}" fill="none" stroke="${run.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');
    const gaps = bridges.map(([p, q]) => `<polyline class="bridge" points="${pt(p)} ${pt(q)}" fill="none"/>`).join('');
    // On-scale laps with nothing drawn either side would otherwise be invisible.
    const lone = r.laps.filter((l) => l.ms <= yMax && !linked.has(l))
      .map((l) => `<circle cx="${x(l.lap).toFixed(1)}" cy="${y(l.ms).toFixed(1)}" r="2.5" fill="${l.d.color}"/>`).join('');
    const bests = r.chunks.map((c) => `<circle cx="${x(c.best.lap)}" cy="${y(c.best.ms)}" r="${c.d.key === focus?.key ? 5.5 : 4.5}" fill="${c.d.color}" stroke="var(--surface-1)" stroke-width="2"/>`).join('');
    return gaps + lines + lone + bests;
  }).join('');

  // Driver-change markers, one label row per kart under the plot.
  const markers = karts.map((r, row) => r.chunks.map((c, i) => {
    const cx = x(c.from);
    const ly = plotBottom + 14 + row * rowH;
    return `${i ? `<line class="change" x1="${cx}" x2="${cx}" y1="${m.t}" y2="${plotBottom}"/>` : ''}
      <circle cx="${cx + 3}" cy="${ly - 4}" r="3.5" fill="${c.d.color}" ${c.d.ownColor ? `stroke="${c.d.teamColor}" stroke-width="2"` : ''}/>
      <text class="change-label" x="${cx + 10}" y="${ly}">${esc(c.d.driver)}</text>`;
  }).join('')).join('');

  el.innerHTML = `
    <div class="legend"><span>● best lap</span><span>│ driver change</span>${karts.some((r) => r.chunks.some((c) => c.d.ownColor)) ? '<span>two-tone = driver + team color</span>' : ''}<span>dotted = slow lap</span><span>gray dashes = pit stops (off scale; tap for time)</span></div>
    <svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Lap time by lap number for each kart">
      ${yTicks.map((v) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
        <text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmtTime(v).replace(/\.000$|0+$/, '').replace(/\.$/, '')}</text>`).join('')}
      ${xTicks.map((v) => `<text x="${x(v)}" y="${H - 8}" text-anchor="middle">${v}</text>`).join('')}
      ${markers}
      <defs><clipPath id="plot-clip"><rect x="0" y="2" width="${W}" height="${plotBottom - 2}"/></clipPath></defs>
      <g clip-path="url(#plot-clip)">${series}</g>
      <line class="crosshair" id="xh" y1="${m.t}" y2="${plotBottom}" visibility="hidden"/>
      <rect id="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/>
    </svg>
    <div class="tooltip" id="tt" hidden></div>`;

  const svg = el.querySelector('svg');
  const xh = el.querySelector('#xh');
  const tt = el.querySelector('#tt');
  const hit = el.querySelector('#hit');
  const move = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const lap = Math.min(xMax, Math.max(1, Math.round(1 + ((px - m.l) / (W - m.l - m.r)) * (xMax - 1))));
    const rows = karts.map((k) => ({ k, l: k.laps.find((l) => l.lap === lap) })).filter((o) => o.l).sort((a, b) => a.l.ms - b.l.ms);
    xh.setAttribute('x1', x(lap)); xh.setAttribute('x2', x(lap)); xh.setAttribute('visibility', 'visible');
    tt.innerHTML = `<div class="tt-head">Lap ${lap}</div>${rows.length ? rows.map(({ k, l }) => `
      <div class="tt-row">${swatch(l.d)}${esc(l.d.driver)} <span class="muted">${esc(k.label)}</span>
      <span class="num">${fmtTime(l.ms)}${l.flag ? ` <span class="muted">${l.flag === 'pit' ? 'pit' : 'slow'}</span>` : ''}</span></div>`).join('') : '<div class="muted">No data</div>'}`;
    tt.hidden = false;
    const left = (x(lap) / W) * r.width;
    const flip = left > r.width * 0.55;
    tt.style.left = flip ? '' : `${left + 14}px`;
    tt.style.right = flip ? `${r.width - left + 14}px` : '';
    tt.style.top = '34px';
  };
  hit.addEventListener('pointermove', (e) => move(e.clientX));
  hit.addEventListener('pointerdown', (e) => move(e.clientX));
  hit.addEventListener('pointerleave', () => { tt.hidden = true; xh.setAttribute('visibility', 'hidden'); });
}

// ---------- editor ----------
async function showEditor(id) {
  if (!state.config.editable) {
    app.innerHTML = '<div class="card"><h2>Editing is disabled</h2><p class="muted">Set the <code>ADMIN_TOKEN</code> environment variable on the server to enable uploads.</p><a href="/">Back</a></div>';
    return;
  }
  state.edit = id ? await api(`races/${encodeURIComponent(id)}`) : {
    id: '', name: '', track: '', date: new Date().toISOString().slice(0, 10), slowFactor: DEFAULT_SLOW_FACTOR, karts: [],
  };
  state.isNew = !id;
  state.pending = [];
  await loadRegistry();
  // Personal colors edited here are saved to the shared driver list along with the race.
  state.colorDraft = new Map(state.registry.map((d) => [driverId(d.name), d.color || '']));
  state.teamColorDraft = new Map(state.teams.map((t) => [driverId(t.name), t.color || '']));
  document.title = `${id ? 'Edit' : 'New'} race · Karting Hub`;
  renderEditor();
}

function renderEditor(message) {
  const r = state.edit;
  app.innerHTML = `
    <div class="page-head">
      <div><div><a href="${state.isNew ? '/' : `/r/${encodeURIComponent(r.id)}`}">← Back</a></div>
        <h1 style="margin-top:6px">${state.isNew ? 'New race' : 'Edit race'}</h1></div>
      ${state.isNew ? '' : '<div class="actions"><button class="btn danger" id="delete" type="button">Delete race</button></div>'}
    </div>

    <section class="card section">
      <div class="form-grid">
        <label class="field">Race name<input type="text" data-field="name" value="${esc(r.name)}" placeholder="Saturday 2-Hour Enduro"></label>
        <label class="field">Track<input type="text" data-field="track" value="${esc(r.track)}" placeholder="Track name"></label>
        <label class="field">Date<input type="date" data-field="date" value="${esc(r.date)}"></label>
        <label class="field">Slow-lap threshold (% over driver median)
          <input type="number" min="1" max="50" step="1" data-field="slowPct" value="${Math.round(((r.slowFactor || DEFAULT_SLOW_FACTOR) - 1) * 100)}"></label>
      </div>
    </section>

    <section class="card section">
      <div class="section-head"><h2>Upload Race Monitor files</h2><p>Drop every .txt export — split sessions for the same kart get merged by lap number.</p></div>
      <label class="dropzone" id="drop">
        <input type="file" id="files" accept=".txt,text/plain" multiple hidden>
        <strong>Choose files</strong> or drag them here
      </label>
      ${state.pending.length ? `
        <div class="table-wrap" style="margin-top:12px"><table>
          <thead><tr><th>File</th><th>Header</th><th class="num">Laps</th><th class="hide-sm">Session</th><th style="width:110px">Kart #</th></tr></thead>
          <tbody>${state.pending.map((p, i) => `<tr>
            <td>${esc(p.filename)}</td>
            <td class="secondary">#${esc(p.headerNumber)} ${esc(p.headerName)}${p.headerNumber && p.headerNumber !== p.kart ? ' <span class="pill" title="Header kart number differs from the file name">differs</span>' : ''}</td>
            <td class="num">${p.laps.length ? `${p.laps.length} (${p.laps[0].lap}–${p.laps[p.laps.length - 1].lap})` : '0'}</td>
            <td class="hide-sm muted">${esc(p.session || '')}</td>
            <td><input type="text" data-pending="${i}" value="${esc(p.kart)}"></td></tr>`).join('')}</tbody></table></div>
        <div class="actions" style="margin-top:10px"><button class="btn primary" id="add-files" type="button">Add to race</button>
          <button class="btn" id="clear-files" type="button">Discard</button></div>` : ''}
      ${message ? `<div class="notice">${message}</div>` : ''}
    </section>

    ${r.karts.map((k, ki) => kartEditor(k, ki)).join('')}

    <div class="sticky-save">
      <span id="save-msg" class="muted"></span>
      <input type="password" id="token" placeholder="Admin token" value="${esc(token.get())}" style="max-width:180px">
      <button class="btn primary" id="save" type="button">Save race</button>
    </div>`;
  bindEditor();
}

function kartEditor(k, ki) {
  const miss = missingLaps(k.laps);
  const pits = pitCandidates(k.laps);
  const last = k.laps.length ? k.laps[k.laps.length - 1].lap : 0;
  const stints = k.stints.length ? k.stints : [{ driver: '', toLap: null }];
  let from = 1;
  return `<section class="card section kart-card">
    <div class="kart-head">
      <h3><span class="swatch" style="background:${esc(editorTeamColor(k, ki))};width:14px;height:14px;margin-right:8px"></span>${esc(k.team || 'Kart')} #${esc(k.number)}</h3>
      <div class="actions">
        <button class="btn small" type="button" data-act="clear-laps" data-k="${ki}">Clear laps</button>
        <button class="btn small danger" type="button" data-act="remove-kart" data-k="${ki}">Remove kart</button>
      </div>
    </div>
    <div class="form-grid" style="margin-bottom:8px">
      <label class="field">Team${teamSelect(k, ki)}</label>
      <label class="field">Team color<input type="color" data-k="${ki}" data-kfield="color" value="${esc(editorTeamColor(k, ki))}"
        title="${k.team ? 'Saved to the team, so it applies in every race' : 'Pick a team to reuse this color'}"></label>
      <div class="field">Team photo${photoPicker('teams', k.team, editorTeamColor(k, ki))}</div>
    </div>
    <div class="secondary" style="font-size:13px">${k.laps.length} laps recorded${k.laps.length ? ` (1–${last})` : ''}${miss.length ? ` · missing ${miss.join(', ')}` : ''}</div>
    ${pits.length ? `<div class="suggest">Likely pit / driver-change laps: ${pits.map((p) => `<button class="btn small" type="button" data-act="split" data-k="${ki}" data-lap="${p}" title="Add a driver change after lap ${p}">${p}</button>`).join('')}</div>` : ''}
    <h4 style="margin:12px 0 6px;font-size:14px">Drivers, in order</h4>
    ${rosterHint(k, ki)}
    ${stints.map((s, si) => {
      const to = s.toLap ?? last;
      const color = state.colorDraft.get(driverId(s.driver)) || '';
      const row = `<div class="stint-row">
        ${driverSelect(k, ki, s, si)}
        <span class="driver-color ${color ? '' : 'unset'}">
          <input type="color" title="${color ? 'Personal color (used in every race)' : 'Pick a personal color (optional)'}" aria-label="Personal color for ${esc(s.driver || 'driver')}" data-dcolor="${esc(s.driver)}" value="${color || '#8e8d86'}" ${s.driver.trim() ? '' : 'disabled'}>
          ${color ? `<button class="btn small clear-color" type="button" data-clear-color="${esc(s.driver)}" aria-label="Remove personal color" title="Remove personal color">✕</button>` : ''}
        </span>
        <input type="number" min="1" placeholder="to finish" title="Last lap this driver drove (blank = to the finish)" data-k="${ki}" data-s="${si}" data-sfield="toLap" value="${s.toLap ?? ''}">
        <span class="range">laps ${from}–${to || '?'}</span>
        <button class="btn small" type="button" data-act="remove-stint" data-k="${ki}" data-s="${si}" aria-label="Remove driver">✕</button>
      </div>`;
      from = (s.toLap ?? last) + 1;
      return row;
    }).join('')}
    <button class="btn small" type="button" data-act="add-stint" data-k="${ki}">+ Add driver</button>
  </section>`;
}

const NEW = '__new__';

/** Team dropdown: saved teams only, plus "+ New team…". A name from an older race that isn't saved stays selectable. */
function teamSelect(k, ki) {
  const legacy = k.team && !savedTeam(k.team);
  return `<select data-kteam="${ki}" aria-label="Team for kart ${esc(k.number)}">
    <option value="" ${k.team ? '' : 'selected'}>No team</option>
    ${state.teams.map((t) => `<option value="${esc(t.name)}" ${driverId(t.name) === driverId(k.team) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
    ${legacy ? `<option value="${esc(k.team)}" selected>${esc(k.team)} (not on Teams page)</option>` : ''}
    <option value="${NEW}">+ New team…</option>
  </select>`;
}

/** Driver dropdown: the kart's team roster first, then everyone else on the Drivers page, plus "+ New driver…". */
function driverSelect(k, ki, s, si) {
  const team = k.team ? savedTeam(k.team) : null;
  const roster = new Set((team?.members || []).map((m) => driverId(m.driver)));
  const opt = (name) => `<option value="${esc(name)}" ${driverId(name) === driverId(s.driver) ? 'selected' : ''}>${esc(name)}</option>`;
  const inRoster = state.registry.filter((d) => roster.has(driverId(d.name)));
  const others = state.registry.filter((d) => !roster.has(driverId(d.name)));
  const legacy = s.driver.trim() && !isSavedDriver(s.driver);
  return `<select data-sdriver="${ki}:${si}" aria-label="Driver ${si + 1} for kart ${esc(k.number)}">
    <option value="" ${s.driver.trim() ? '' : 'selected'}>Choose a driver…</option>
    ${inRoster.length ? `<optgroup label="${esc(team.name)} roster">${inRoster.map((d) => opt(d.name)).join('')}</optgroup>
      <optgroup label="Other drivers">${others.map((d) => opt(d.name)).join('')}</optgroup>` : others.map((d) => opt(d.name)).join('')}
    ${legacy ? `<option value="${esc(s.driver)}" selected>${esc(s.driver)} (not on Drivers page)</option>` : ''}
    <option value="${NEW}">+ New driver…</option>
  </select>`;
}

/** Adds a driver or team to its saved list straight from the race editor, so the half-edited race isn't lost. */
async function quickAdd(kind, name) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) return null;
  if (kind === 'drivers') {
    const found = state.registry.find((d) => driverId(d.name) === driverId(name));
    if (found) return found.name;
    state.registry = (await api('drivers', { method: 'PUT', auth: true, body: JSON.stringify({ drivers: [...state.registry, { name, color: '' }] }) })).drivers;
    state.colorDraft.set(driverId(name), '');
  } else {
    const found = savedTeam(name);
    if (found) return found.name;
    state.teams = normalizeTeams((await api('teams', { method: 'PUT', auth: true, body: JSON.stringify({ teams: [...state.teams, { name, color: '', members: [] }] }) })).teams);
  }
  return name;
}

/** Color shown in the editor: an unsaved edit for this team name wins over the saved one. */
function editorTeamColor(k, ki) {
  const draft = k.team && state.teamColorDraft.get(driverId(k.team));
  return isHex(draft) ? draft : teamColor(k, ki);
}

/** For a known team, offer its roster as one-click driver rows. */
function rosterHint(k, ki) {
  // A kart without a team name has no roster to offer (an empty name must not be treated as a team).
  const team = k.team ? savedTeam(k.team) : null;
  if (!team?.members?.length) return '';
  const have = new Set(k.stints.map((s) => driverId(s.driver)));
  const missing = team.members.filter((m) => !have.has(driverId(m.driver)));
  if (!missing.length) return '';
  return `<div class="suggest">${esc(team.name)} roster: ${missing.map((m) => `<button class="btn small" type="button" data-act="add-member" data-k="${ki}" data-driver="${esc(m.driver)}" title="${ROLES[m.role].label}">+ ${esc(m.driver)}</button>`).join('')}</div>`;
}

function sortStints(k) {
  k.stints.sort((a, b) => (a.toLap ?? Infinity) - (b.toLap ?? Infinity));
}

async function readFiles(fileList) {
  for (const f of fileList) state.pending.push(parseRaceMonitor(await f.text(), f.name));
  renderEditor();
}

function bindEditor() {
  const r = state.edit;
  app.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('input', () => {
    if (el.dataset.field === 'slowPct') r.slowFactor = 1 + Math.max(1, +el.value || 10) / 100;
    else r[el.dataset.field] = el.value;
  }));
  app.querySelectorAll('[data-pending]').forEach((el) => el.addEventListener('input', () => (state.pending[+el.dataset.pending].kart = el.value.trim())));
  app.querySelectorAll('[data-kfield]').forEach((el) => {
    el.addEventListener('input', () => {
      const k = r.karts[+el.dataset.k];
      // A named team's color goes to the shared team list; an unnamed kart keeps it on the kart.
      if (el.dataset.kfield === 'color' && k.team.trim()) state.teamColorDraft.set(driverId(k.team), el.value);
      else k[el.dataset.kfield] = el.value;
    });
  });
  const tokenField = () => document.getElementById('token');
  app.querySelectorAll('[data-kteam]').forEach((el) => el.addEventListener('change', async () => {
    const k = r.karts[+el.dataset.kteam];
    if (el.value !== NEW) { k.team = el.value; return renderEditor(); }
    const name = prompt('New team name');
    if (!name?.trim()) return renderEditor();
    token.set(tokenField().value.trim());
    try { k.team = await quickAdd('teams', name); renderEditor(`${esc(k.team)} added to the Teams page.`); }
    catch (e) { renderEditor(`Couldn't add the team: ${esc(e.message)} (enter your admin token at the bottom first).`); }
  }));
  app.querySelectorAll('[data-sdriver]').forEach((el) => el.addEventListener('change', async () => {
    const [ki, si] = el.dataset.sdriver.split(':').map(Number);
    const k = r.karts[ki];
    if (!k.stints.length) k.stints.push({ driver: '', toLap: null });
    const st = k.stints[si];
    if (el.value !== NEW) { st.driver = el.value; return renderEditor(); }
    const name = prompt('New driver name');
    if (!name?.trim()) return renderEditor();
    token.set(tokenField().value.trim());
    try { st.driver = await quickAdd('drivers', name); renderEditor(`${esc(st.driver)} added to the Drivers page.`); }
    catch (e) { renderEditor(`Couldn't add the driver: ${esc(e.message)} (enter your admin token at the bottom first).`); }
  }));
  bindPhotoPickers((msg) => renderEditor(msg));
  app.querySelectorAll('[data-sfield]').forEach((el) => {
    const update = () => {
      const k = r.karts[+el.dataset.k];
      if (!k.stints.length) k.stints.push({ driver: '', toLap: null });
      const s = k.stints[+el.dataset.s];
      s[el.dataset.sfield] = el.dataset.sfield === 'toLap' ? (el.value === '' ? null : +el.value) : el.value;
    };
    el.addEventListener('input', update);
    if (el.dataset.sfield === 'toLap') el.addEventListener('change', () => { sortStints(r.karts[+el.dataset.k]); renderEditor(); });
  });
  app.querySelectorAll('[data-dcolor]').forEach((el) => el.addEventListener('change', () => {
    state.colorDraft.set(driverId(el.dataset.dcolor), el.value);
    renderEditor();
  }));
  app.querySelectorAll('[data-clear-color]').forEach((el) => el.addEventListener('click', () => {
    state.colorDraft.set(driverId(el.dataset.clearColor), '');
    renderEditor();
  }));

  const input = document.getElementById('files');
  const drop = document.getElementById('drop');
  input.addEventListener('change', () => readFiles(input.files));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles(e.dataTransfer.files); });

  document.getElementById('add-files')?.addEventListener('click', () => {
    const notes = [];
    for (const p of state.pending) {
      if (!p.kart) { notes.push(`${esc(p.filename)}: no kart number, skipped`); continue; }
      let k = r.karts.find((k) => k.number === p.kart);
      if (!k) { k = { number: p.kart, team: '', laps: [], stints: [] }; r.karts.push(k); }
      const { laps, duplicates } = mergeLaps(k.laps, p.laps, p.session);
      k.laps = laps;
      notes.push(`${esc(p.filename)} → kart #${esc(p.kart)}: ${p.laps.length - duplicates.length} laps added${duplicates.length ? `, ${duplicates.length} duplicate lap numbers ignored` : ''}`);
    }
    r.karts.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    state.pending = [];
    renderEditor(notes.join('<br>'));
  });
  document.getElementById('clear-files')?.addEventListener('click', () => { state.pending = []; renderEditor(); });

  app.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', () => {
    const k = r.karts[+el.dataset.k];
    const act = el.dataset.act;
    if (act === 'remove-kart' && confirm(`Remove kart #${k.number} and its laps?`)) r.karts.splice(+el.dataset.k, 1);
    if (act === 'clear-laps' && confirm(`Clear all laps for kart #${k.number}?`)) k.laps = [];
    if (act === 'add-member') {
      // Fill the first empty driver row, or add a new row at the end.
      const empty = k.stints.find((s) => !s.driver.trim());
      if (empty) empty.driver = el.dataset.driver;
      else {
        const open = k.stints.find((s) => s.toLap == null);
        if (open) open.toLap = k.laps.length ? k.laps[k.laps.length - 1].lap : 1;
        k.stints.push({ driver: el.dataset.driver, toLap: null });
      }
    }
    if (act === 'add-stint') {
      if (!k.stints.length) k.stints.push({ driver: '', toLap: null });
      const open = k.stints.find((s) => s.toLap == null);
      if (open) open.toLap = k.laps.length ? k.laps[k.laps.length - 1].lap : 1;
      k.stints.push({ driver: '', toLap: null });
    }
    if (act === 'remove-stint') {
      k.stints.splice(+el.dataset.s, 1);
      if (k.stints.length && !k.stints.some((s) => s.toLap == null)) k.stints[k.stints.length - 1].toLap = null;
    }
    if (act === 'split') {
      const lap = +el.dataset.lap;
      if (!k.stints.length) k.stints.push({ driver: '', toLap: null });
      if (!k.stints.some((s) => s.toLap === lap)) {
        // The stint covering this lap now ends here; a new (unnamed) driver takes over after it.
        sortStints(k);
        const idx = k.stints.findIndex((s) => (s.toLap ?? Infinity) > lap);
        const cur = k.stints[idx];
        k.stints.splice(idx, 0, { driver: cur.driver, toLap: lap });
        cur.driver = '';
      }
    }
    sortStints(k);
    renderEditor();
  }));

  document.getElementById('token').addEventListener('change', (e) => token.set(e.target.value.trim()));
  document.getElementById('save').addEventListener('click', saveRace);
  document.getElementById('delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${r.name}" permanently?`)) return;
    token.set(document.getElementById('token').value.trim());
    try { await api(`races/${encodeURIComponent(r.id)}`, { method: 'DELETE', auth: true }); navigate('/'); }
    catch (e) { document.getElementById('save-msg').textContent = e.message; }
  });
}

async function saveRace() {
  const r = state.edit;
  const msg = document.getElementById('save-msg');
  token.set(document.getElementById('token').value.trim());
  if (!r.name.trim()) { msg.textContent = 'Give the race a name first.'; return; }
  if (state.isNew) r.id = slugify(`${r.date} ${r.name}`);
  for (const k of r.karts) k.stints = k.stints.filter((s, i, all) => s.driver.trim() || s.toLap != null || all.length === 1);
  msg.textContent = 'Saving…';
  try {
    if (state.isNew) {
      const exists = await api(`races/${encodeURIComponent(r.id)}`).then(() => true, () => false);
      if (exists && !confirm(`A race with id "${r.id}" already exists. Overwrite it?`)) { msg.textContent = ''; return; }
    }
    await api(`races/${encodeURIComponent(r.id)}`, { method: 'PUT', auth: true, body: JSON.stringify(r) });
    await saveRegistryFromRace(r);
    await uploadPreview(r).catch(() => {}); // a failed preview shouldn't block saving the race
    navigate(`/r/${encodeURIComponent(r.id)}`);
  } catch (e) {
    msg.textContent = e.message;
    msg.className = 'notice error';
  }
}

/** Adds any new driver names from the race to the shared list and applies color edits. */
async function saveRegistryFromRace(r) {
  const list = new Map(state.registry.map((d) => [driverId(d.name), { ...d }]));
  for (const k of r.karts) for (const s of k.stints) {
    const name = s.driver.trim();
    if (name && !list.has(driverId(name))) list.set(driverId(name), { name, color: '' });
  }
  for (const [id, color] of state.colorDraft) if (list.has(id)) list.get(id).color = color;
  const next = [...list.values()];
  refreshPreviews({ drivers: colorChanges(state.registry, next) });
  if (JSON.stringify(next) !== JSON.stringify(state.registry)) {
    state.registry = (await api('drivers', { method: 'PUT', auth: true, body: JSON.stringify({ drivers: next }) })).drivers;
  }
  // Teams: add new team names, apply color edits.
  const teams = new Map(state.teams.map((t) => [driverId(t.name), { ...t, members: [...t.members] }]));
  for (const k of r.karts) {
    const name = k.team.trim();
    if (name && !teams.has(driverId(name))) teams.set(driverId(name), { name, color: isHex(k.color) ? k.color : '', members: [] });
  }
  for (const [id, color] of state.teamColorDraft) if (teams.has(id) && color) teams.get(id).color = color;
  const nextTeams = [...teams.values()];
  refreshPreviews({ teams: colorChanges(state.teams, nextTeams) });
  if (JSON.stringify(nextTeams) !== JSON.stringify(state.teams)) {
    state.teams = normalizeTeams((await api('teams', { method: 'PUT', auth: true, body: JSON.stringify({ teams: nextTeams }) })).teams);
  }
}

// ---------- autosave (Drivers and Teams pages) ----------
/**
 * Saves a list to the server right after each change. Saves run one at a time; a change made while one is in
 * flight is picked up by the next, so the newest list always wins. `status()` reports progress for the page.
 */
function autosaver({ path, body, validate = () => [], onSaved, status }) {
  let inFlight = null, pending = false;
  const run = async () => {
    const problems = validate();
    if (problems.length) return status('error', 'Not saved yet — fix the problem above.');
    if (!token.get()) return status('error', 'Enter your admin token to save changes.');
    status('saving', 'Saving…');
    try {
      onSaved(await api(path, { method: 'PUT', auth: true, body: JSON.stringify(body()) }));
      status('saved', 'All changes saved');
    } catch (e) {
      status('error', `Not saved: ${e.message}`);
    }
  };
  return function save() {
    if (inFlight) { pending = true; return inFlight; }
    inFlight = run().finally(() => {
      inFlight = null;
      if (pending) { pending = false; save(); }
    });
    return inFlight;
  };
}

/** Bottom bar for autosaving pages: save status plus the admin token field. */
function saveBar(st) {
  return `<div class="sticky-save"><span id="save-msg" class="save-status ${st?.kind || ''}">${esc(st?.text || 'Changes save automatically')}</span>
    <input type="password" id="token" placeholder="Admin token" value="${esc(token.get())}" style="max-width:180px"></div>`;
}
function showSaveStatus(kind, text) {
  const el = document.getElementById('save-msg');
  if (el) { el.textContent = text; el.className = `save-status ${kind}`; }
}

// ---------- drivers ----------
/** "Team Apex OWNER" style badges for every roster the driver is on. */
function driverTeams(name) {
  const rows = state.teams.flatMap((t) => t.members.filter((m) => driverId(m.driver) === driverId(name)).map((m) => ({ t, m })))
    .sort((a, b) => Number(ROLES[b.m.role].bound) - Number(ROLES[a.m.role].bound));
  return rows.length
    ? `<div class="members">${rows.map(({ t, m }) => `<a class="member" href="/teams">${avatar('teams', t.name, 18, t.color || 'var(--border)', `<span class="swatch" style="background:${t.color || 'var(--border)'}"></span>`)}${esc(t.name)} ${roleBadge(m.role)}</a>`).join('')}</div>`
    : '<span class="muted">—</span>';
}

/** Editable version for the Drivers page: each team with a role picker and ✕, plus "Add to team…". */
function driverTeamEditor(name) {
  const rows = state.teams.filter((t) => t.members.some((m) => driverId(m.driver) === driverId(name)));
  const roleOf = (t) => t.members.find((m) => driverId(m.driver) === driverId(name)).role;
  const others = state.teams.filter((t) => !rows.includes(t));
  return `<div class="members">
    ${rows.map((t) => `<span class="member editable">
      ${avatar('teams', t.name, 18, t.color || 'var(--border)', `<span class="swatch" style="background:${t.color || 'var(--border)'}"></span>`)}${esc(t.name)}
      <select data-dt-role="${esc(t.name)}" data-driver="${esc(name)}" aria-label="${esc(name)}'s role on ${esc(t.name)}">
        ${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === roleOf(t) ? 'selected' : ''}>${r.label}</option>`).join('')}
      </select>
      <button class="btn small clear-color" type="button" data-dt-remove="${esc(t.name)}" data-driver="${esc(name)}" aria-label="Take ${esc(name)} off ${esc(t.name)}">✕</button>
    </span>`).join('')}
    ${others.length ? `<select class="add-team" data-dt-add="${esc(name)}" aria-label="Add ${esc(name)} to a team">
      <option value="">+ Add to team…</option>
      ${others.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}
    </select>` : state.teams.length ? '' : '<a class="muted" href="/teams" style="font-size:13px">Add teams first</a>'}
  </div>`;
}

/** Applies a roster change made on the Drivers page and saves the team list (same rules as the Teams page). */
async function updateRosters(change, done) {
  const next = state.teams.map((t) => ({ ...t, members: t.members.map((m) => ({ ...m })) }));
  change(next);
  const errors = teamListErrors(next);
  if (errors.length) return done(esc(errors[0]));
  try {
    state.teams = normalizeTeams((await api('teams', { method: 'PUT', auth: true, body: JSON.stringify({ teams: next }) })).teams);
    done();
  } catch (e) {
    done(`Couldn't update the team: ${esc(e.message)}`);
  }
}

async function showDrivers() {
  document.title = 'Drivers · Karting Hub';
  const [races] = await Promise.all([api('races'), loadRegistry()]);
  state.driverDraft = state.registry.map((d) => ({ ...d }));
  state.driverRaces = races;
  state.driverSave = null;
  state.saveDrivers = autosaver({
    path: 'drivers',
    body: () => ({ drivers: state.driverDraft }),
    onSaved: (res) => {
      // Photo buttons appear once a new driver is on the saved list.
      const before = state.registry.length;
      refreshPreviews({ drivers: colorChanges(state.registry, res.drivers) });
      state.registry = res.drivers;
      if (res.drivers.length !== before && location.pathname === '/drivers') renderDrivers();
    },
    status: (kind, text) => { state.driverSave = { kind, text }; showSaveStatus(kind, text); },
  });
  renderDrivers();
}

function renderDrivers(message) {
  const edit = state.config.editable;
  const racesFor = (name) => state.driverRaces.filter((r) => r.drivers.some((n) => driverId(n) === driverId(name)));
  app.innerHTML = `
    <div class="page-head">
      <div><div><a href="/">← All races</a></div><h1 style="margin-top:6px">Drivers</h1>
        <div class="meta">Personal colors apply in every race, whichever team the driver is on.</div></div>
    </div>
    <section class="card section">
      <div class="table-wrap"><table class="${edit ? 'stack-sm drivers-table' : ''}">
        <thead><tr><th>Driver</th><th style="width:70px">Color</th><th class="${edit ? '' : 'hide-sm'}">Team</th><th class="hide-sm">Races</th>${edit ? '<th></th>' : ''}</tr></thead>
        <tbody>${state.driverDraft.map((d, i) => {
          const rs = racesFor(d.name);
          const ring = d.color || 'var(--border)';
          // Photos can only be added once the driver is saved (the upload is keyed by their saved name).
          const saved = state.registry.some((o) => driverId(o.name) === driverId(d.name));
          return `<tr>
          <td><div class="driver-cell driver-name">
            ${personAvatar(d.name, 36, ring)}
            <b>${esc(d.name)}</b></div></td>
          <td>${edit
            ? `<span class="driver-color ${d.color ? '' : 'unset'}"><input type="color" data-reg="${i}" value="${d.color || '#8e8d86'}" aria-label="Color for ${esc(d.name)}">${d.color ? `<button class="btn small clear-color" type="button" data-reg-clear="${i}" aria-label="Remove color">✕</button>` : ''}</span>`
            : d.color ? `<span class="swatch" style="background:${d.color};width:16px;height:16px"></span>` : '<span class="muted">team</span>'}</td>
          <td class="${edit ? 'team-cell' : 'hide-sm'}">${edit && saved ? driverTeamEditor(d.name) : driverTeams(d.name)}</td>
          <td class="secondary hide-sm">${rs.length ? rs.map((r) => `<a href="/r/${encodeURIComponent(r.id)}">${esc(r.name)}</a>`).join(', ') : '<span class="muted">—</span>'}</td>
          ${edit ? `<td class="actions-cell"><div class="row-actions">${saved ? photoButtons('drivers', d.name) : '<span class="muted" style="font-size:12px">not saved yet</span>'}
            <button class="btn small danger" type="button" data-reg-remove="${i}">Remove</button></div></td>` : ''}
        </tr>`;
        }).join('') || `<tr><td colspan="4" class="muted">No drivers yet — they're added when you save a race.</td></tr>`}</tbody>
      </table></div>
      ${edit ? `<div class="add-driver"><input type="text" id="new-driver" placeholder="Add a driver" maxlength="60"><button class="btn" id="add-driver" type="button">Add</button></div>` : ''}
      ${message ? `<div class="notice">${message}</div>` : ''}
    </section>
    ${edit ? saveBar(state.driverSave) : ''}`;
  if (!edit) return;
  bindPhotoPickers((msg) => renderDrivers(msg));
  const changed = () => { renderDrivers(); state.saveDrivers(); };
  const rosterDone = (msg) => renderDrivers(msg);
  app.querySelectorAll('[data-dt-add]').forEach((el) => el.addEventListener('change', () => {
    if (!el.value) return;
    const name = el.dataset.dtAdd;
    // First team defaults to Core; once they're bound somewhere, further teams default to Rotating.
    const bound = state.teams.some((t) => t.members.some((m) => driverId(m.driver) === driverId(name) && ROLES[m.role].bound));
    updateRosters((teams) => teams.find((t) => t.name === el.value).members.push({ driver: name, role: bound ? 'rotating' : 'core' }), rosterDone);
  }));
  app.querySelectorAll('[data-dt-role]').forEach((el) => el.addEventListener('change', () => {
    updateRosters((teams) => {
      teams.find((t) => t.name === el.dataset.dtRole).members.find((m) => driverId(m.driver) === driverId(el.dataset.driver)).role = el.value;
    }, rosterDone);
  }));
  app.querySelectorAll('[data-dt-remove]').forEach((el) => el.addEventListener('click', () => {
    updateRosters((teams) => {
      const t = teams.find((o) => o.name === el.dataset.dtRemove);
      t.members = t.members.filter((m) => driverId(m.driver) !== driverId(el.dataset.driver));
    }, rosterDone);
  }));

  app.querySelectorAll('[data-reg]').forEach((el) => el.addEventListener('change', () => { state.driverDraft[+el.dataset.reg].color = el.value; changed(); }));
  app.querySelectorAll('[data-reg-clear]').forEach((el) => el.addEventListener('click', () => { state.driverDraft[+el.dataset.regClear].color = ''; changed(); }));
  app.querySelectorAll('[data-reg-remove]').forEach((el) => el.addEventListener('click', () => {
    const d = state.driverDraft[+el.dataset.regRemove];
    const rosters = state.teams.filter((t) => t.members.some((m) => driverId(m.driver) === driverId(d.name)));
    const notes = [
      racesFor(d.name).length && 'Their laps in saved races stay; they just lose their personal color and photo link.',
      rosters.length && `They'll also be taken off the ${rosters.map((t) => t.name).join(' and ')} roster${rosters.length > 1 ? 's' : ''}.`,
    ].filter(Boolean);
    if (notes.length && !confirm(`Remove ${d.name}? ${notes.join(' ')}`)) return;
    state.driverDraft.splice(+el.dataset.regRemove, 1);
    changed();
    if (rosters.length) {
      const teams = state.teams.map((t) => ({ ...t, members: t.members.filter((m) => driverId(m.driver) !== driverId(d.name)) }));
      api('teams', { method: 'PUT', auth: true, body: JSON.stringify({ teams }) })
        .then((res) => { state.teams = normalizeTeams(res.teams); renderDrivers(); })
        .catch((e) => renderDrivers(`Removed ${esc(d.name)}, but couldn't update rosters: ${esc(e.message)}`));
    }
  }));
  const add = () => {
    const name = document.getElementById('new-driver').value.trim();
    if (!name) return;
    if (state.driverDraft.some((d) => driverId(d.name) === driverId(name))) return renderDrivers(`${esc(name)} is already on the list.`);
    state.driverDraft.push({ name, color: '' });
    changed();
  };
  document.getElementById('add-driver').addEventListener('click', add);
  document.getElementById('new-driver').addEventListener('keydown', (e) => e.key === 'Enter' && add());
  // Entering the token retries a save that was waiting for it.
  document.getElementById('token').addEventListener('change', (e) => { token.set(e.target.value.trim()); if (state.driverSave?.kind === 'error') state.saveDrivers(); });
}

// ---------- teams ----------
async function showTeams() {
  document.title = 'Teams · Karting Hub';
  const [races] = await Promise.all([api('races'), loadRegistry()]);
  state.teamDraft = state.teams.map((t) => ({ ...t, members: t.members.map((m) => ({ ...m })) }));
  state.teamRaces = races;
  state.openTeam = null;
  state.teamSave = null;
  state.saveTeams = autosaver({
    path: 'teams',
    body: () => ({ teams: state.teamDraft }),
    validate: () => teamListErrors(state.teamDraft),
    onSaved: (res) => {
      // Photo buttons appear once a new team is on the saved list.
      const before = state.teams.length;
      refreshPreviews({ teams: colorChanges(state.teams, res.teams) });
      state.teams = normalizeTeams(res.teams);
      if (res.teams.length !== before && location.pathname === '/teams') renderTeams();
    },
    status: (kind, text) => { state.teamSave = { kind, text }; showSaveStatus(kind, text); },
  });
  renderTeams();
}

/** Drivers who raced for a team in saved races, most recent race first. */
function teamHistory(name) {
  const out = new Map();
  for (const r of state.teamRaces) {
    for (const l of r.lineups || []) {
      if (driverId(l.team) !== driverId(name)) continue;
      for (const d of l.drivers) if (!out.has(driverId(d))) out.set(driverId(d), d);
    }
  }
  return [...out.values()];
}

const roleBadge = (role) => `<span class="role role-${role}" title="${ROLES[role].bound ? 'Tied to this team' : 'Can also race for other teams'}">${ROLES[role].label}</span>`;
const driverRing = (name) => state.registry.find((d) => driverId(d.name) === driverId(name))?.color || 'var(--border)';
const memberChip = (m) => `<span class="member">${personAvatar(m.driver, 20, driverRing(m.driver))}${esc(m.driver)} ${roleBadge(m.role)}</span>`;

function renderTeams(message) {
  const edit = state.config.editable;
  const racesFor = (name) => state.teamRaces.filter((r) => (r.lineups || []).some((l) => driverId(l.team) === driverId(name)));
  const errors = teamListErrors(state.teamDraft);
  const order = { owner: 0, core: 1, rotating: 2 };
  app.innerHTML = `
    <div class="page-head">
      <div><div><a href="/">← All races</a></div><h1 style="margin-top:6px">Teams</h1>
        <div class="meta">Team colors and photos apply in every race. Owner and core drivers are tied to one team; rotating drivers can race for others.</div></div>
    </div>
    <section class="card section">
      <div class="table-wrap"><table class="stack-sm teams-table">
        <thead><tr><th>Team</th><th style="width:70px">Color</th><th>Roster</th><th class="hide-sm">Races</th>${edit ? '<th></th>' : ''}</tr></thead>
        <tbody>${state.teamDraft.map((t, i) => {
          const rs = racesFor(t.name);
          const ring = t.color || 'var(--border)';
          const saved = state.teams.some((o) => driverId(o.name) === driverId(t.name));
          const open = state.openTeam === i;
          const members = [...t.members].sort((a, b) => order[a.role] - order[b.role] || a.driver.localeCompare(b.driver));
          return `<tr>
            <td><div class="driver-cell driver-name">
              ${avatar('teams', t.name, 36, ring, `<span class="avatar placeholder" style="--ring:${ring};width:36px;height:36px;font-size:13px">${initials(t.name)}</span>`)}
              <b>${esc(t.name)}</b></div></td>
            <td>${edit
              ? `<span class="driver-color ${t.color ? '' : 'unset'}"><input type="color" data-team-color="${i}" value="${t.color || '#8e8d86'}" aria-label="Color for ${esc(t.name)}"></span>`
              : t.color ? `<span class="swatch" style="background:${t.color};width:16px;height:16px"></span>` : '<span class="muted">—</span>'}</td>
            <td class="roster-cell"><div class="members">${members.map(memberChip).join('') || '<span class="muted">No roster yet</span>'}</div></td>
            <td class="secondary hide-sm">${rs.length ? rs.map((r) => `<a href="/r/${encodeURIComponent(r.id)}">${esc(r.name)}</a>`).join(', ') : '<span class="muted">—</span>'}</td>
            ${edit ? `<td class="actions-cell"><div class="row-actions">
              <button class="btn small" type="button" data-team-open="${i}" aria-expanded="${open}">${open ? 'Done' : 'Edit roster'}</button>
              ${saved ? photoButtons('teams', t.name) : '<span class="muted" style="font-size:12px">not saved yet</span>'}
              <button class="btn small danger" type="button" data-team-remove="${i}">Remove</button></div></td>` : ''}
          </tr>
          ${edit && open ? `<tr class="roster-row"><td colspan="5">${rosterEditor(t, i)}</td></tr>` : ''}`;
        }).join('') || `<tr><td colspan="5" class="muted">No teams yet — they're added when you save a race.</td></tr>`}</tbody>
      </table></div>
      ${edit ? `<div class="add-driver"><input type="text" id="new-team" placeholder="Add a team" maxlength="60"><button class="btn" id="add-team" type="button">Add</button></div>` : ''}
      ${errors.length ? `<div class="notice error">${errors.map(esc).join('<br>')}</div>` : ''}
      ${message ? `<div class="notice">${message}</div>` : ''}
    </section>
    ${edit ? saveBar(state.teamSave) : ''}`;
  if (!edit) return;
  bindPhotoPickers((msg) => renderTeams(msg));
  bindTeams();
}

const isSavedDriver = (name) => state.registry.some((d) => driverId(d.name) === driverId(name));

function rosterEditor(t, i) {
  const onRoster = new Set(t.members.map((m) => driverId(m.driver)));
  // Rosters only take drivers from the Drivers page, so names can't drift apart.
  const available = state.registry.filter((d) => !onRoster.has(driverId(d.name)));
  const history = teamHistory(t.name).filter((d) => !onRoster.has(driverId(d)) && isSavedDriver(d));
  const roleSelect = (attrs, value) => `<select ${attrs}>${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${r.label}</option>`).join('')}</select>`;
  return `<div class="roster-editor">
    <p class="muted">Owner and core drivers are tied to ${esc(t.name)} and can't be owner/core of another team. Rotating drivers can be on other rosters too.</p>
    ${t.members.map((m, mi) => `<div class="roster-member">
      <span class="driver-cell">${personAvatar(m.driver, 24, driverRing(m.driver))}<b>${esc(m.driver)}</b>
        ${isSavedDriver(m.driver) ? '' : `<span class="pill warn" title="Rosters should only use drivers from the Drivers page">not on Drivers page</span>
        <button class="btn small" type="button" data-member-register="${esc(m.driver)}">Add to Drivers</button>`}</span>
      ${roleSelect(`data-member-role="${i}:${mi}" aria-label="Role for ${esc(m.driver)}"`, m.role)}
      <button class="btn small" type="button" data-member-remove="${i}:${mi}" aria-label="Remove ${esc(m.driver)} from roster">✕</button>
    </div>`).join('')}
    ${available.length ? `<div class="roster-add">
      <select id="member-name-${i}" aria-label="Driver to add">
        <option value="">Choose a driver…</option>
        ${available.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}
      </select>
      ${roleSelect(`id="member-role-${i}" aria-label="Role"`, 'core')}
      <button class="btn small" type="button" data-member-add="${i}">Add to roster</button>
    </div>` : `<p class="muted">${state.registry.length
      ? 'Everyone on the <a href="/drivers">Drivers page</a> is already on this roster.'
      : 'Add drivers on the <a href="/drivers">Drivers page</a> first, then pick them here.'}</p>`}
    ${history.length ? `<div class="suggest">Raced for ${esc(t.name)}: ${history.map((d) => `<button class="btn small" type="button" data-member-quick="${i}" data-driver="${esc(d)}">+ ${esc(d)}</button>`).join('')}</div>` : ''}
  </div>`;
}

function bindTeams() {
  const draft = state.teamDraft;
  const changed = (message) => { renderTeams(message); state.saveTeams(); };
  const ij = (v) => v.split(':').map(Number);
  const addMember = (i, name, role) => {
    name = name.trim();
    if (!name) return renderTeams('Choose a driver to add.');
    const t = draft[i];
    if (!isSavedDriver(name)) return renderTeams(`${esc(name)} isn't on the Drivers page yet.`);
    if (t.members.some((m) => driverId(m.driver) === driverId(name))) return renderTeams(`${esc(name)} is already on ${esc(t.name)}.`);
    const known = state.registry.find((d) => driverId(d.name) === driverId(name));
    t.members.push({ driver: known ? known.name : name, role });
    changed();
  };
  app.querySelectorAll('[data-team-color]').forEach((el) => el.addEventListener('change', () => { draft[+el.dataset.teamColor].color = el.value; changed(); }));
  app.querySelectorAll('[data-team-open]').forEach((el) => el.addEventListener('click', () => {
    state.openTeam = state.openTeam === +el.dataset.teamOpen ? null : +el.dataset.teamOpen;
    renderTeams();
  }));
  app.querySelectorAll('[data-team-remove]').forEach((el) => el.addEventListener('click', () => {
    const t = draft[+el.dataset.teamRemove];
    if (!confirm(`Remove ${t.name} from the team list? Races keep their laps; the team just loses its saved color, photo link and roster.`)) return;
    draft.splice(+el.dataset.teamRemove, 1);
    state.openTeam = null;
    changed();
  }));
  app.querySelectorAll('[data-member-role]').forEach((el) => el.addEventListener('change', () => {
    const [i, mi] = ij(el.dataset.memberRole);
    draft[i].members[mi].role = el.value;
    changed();
  }));
  app.querySelectorAll('[data-member-remove]').forEach((el) => el.addEventListener('click', () => {
    const [i, mi] = ij(el.dataset.memberRemove);
    draft[i].members.splice(mi, 1);
    changed();
  }));
  app.querySelectorAll('[data-member-add]').forEach((el) => {
    const i = +el.dataset.memberAdd;
    const add = () => addMember(i, document.getElementById(`member-name-${i}`).value, document.getElementById(`member-role-${i}`).value);
    el.addEventListener('click', add);
  });
  // Fix up roster names that aren't on the Drivers page (e.g. typed in before rosters used a dropdown).
  app.querySelectorAll('[data-member-register]').forEach((el) => el.addEventListener('click', async () => {
    const name = el.dataset.memberRegister;
    try {
      state.registry = (await api('drivers', { method: 'PUT', auth: true, body: JSON.stringify({ drivers: [...state.registry, { name, color: '' }] }) })).drivers;
      renderTeams(`${esc(name)} added to the Drivers page.`);
    } catch (e) {
      renderTeams(`Couldn't add ${esc(name)}: ${esc(e.message)}`);
    }
  }));
  app.querySelectorAll('[data-member-quick]').forEach((el) => el.addEventListener('click', () => addMember(+el.dataset.memberQuick, el.dataset.driver, 'rotating')));
  const addTeam = () => {
    const name = document.getElementById('new-team').value.trim();
    if (!name) return;
    if (draft.some((t) => driverId(t.name) === driverId(name))) return renderTeams(`${esc(name)} is already on the list.`);
    draft.push({ name, color: '', members: [] });
    state.openTeam = draft.length - 1;
    changed();
  };
  document.getElementById('add-team').addEventListener('click', addTeam);
  document.getElementById('new-team').addEventListener('keydown', (e) => e.key === 'Enter' && addTeam());
  // Entering the token retries a save that was waiting for it.
  document.getElementById('token').addEventListener('change', (e) => { token.set(e.target.value.trim()); if (state.teamSave?.kind === 'error') state.saveTeams(); });
}

// ---------- link preview card (iMessage etc.) ----------
// Drawn here on a canvas because the server has no image library; uploaded as /images/previews/<race id>.
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
  // Round photo with a colored ring, or a colored disc with initials.
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

  // Background and checkered strip.
  ctx.fillStyle = '#111110'; ctx.fillRect(0, 0, W, H);
  const sq = 30;
  for (let y = 0; y < H; y += sq) for (let c = 0; c < 2; c++) {
    if ((y / sq + c) % 2 === 0) { ctx.fillStyle = '#f0efec'; ctx.fillRect(W - STRIP + c * sq, y, sq, sq); }
  }
  const maxW = W - STRIP - PAD * 2;

  // Brand line.
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) { ctx.fillStyle = '#f0efec'; ctx.fillRect(PAD + i * 7, 48 + j * 7, 7, 7); }
  ctx.fillStyle = '#8e8d86'; ctx.font = font(700, 22); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillText('KARTING HUB', PAD + 42, 70);

  // Race name (up to two lines) and date · track.
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

  // Teams.
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

  // Race stats under the teams.
  const lapCount = Math.max(0, ...karts.map((k) => (k.laps.length ? k.laps[k.laps.length - 1].lap : 0)));
  const longest = Math.max(0, ...karts.map((k) => k.laps.reduce((a, l) => a + l.ms, 0)));
  const hrs = longest / 3600000;
  // 1:59:01 of laps reads as "2 h"; 1:30 as "1.5 h"; short races in minutes.
  const hours = hrs < 1 ? `${Math.round(longest / 60000)} min` : Math.abs(hrs - Math.round(hrs)) < 0.1 ? `${Math.round(hrs)} h` : `${hrs.toFixed(1)} h`;
  ctx.fillStyle = '#8e8d86'; ctx.font = font(500, 24); ctx.textAlign = 'left';
  ctx.fillText(`${karts.length} kart${karts.length === 1 ? '' : 's'}  ·  ${sum.drivers.length} driver${sum.drivers.length === 1 ? '' : 's'}  ·  ${lapCount} laps  ·  ${hours}`, PAD, ty + 62);

  // Fastest lap panel.
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

/** Draws and uploads the race's preview card. Needs the admin token; quietly does nothing without one. */
async function uploadPreview(race) {
  if (!token.get() || !race?.id) return false;
  const blob = await drawPreviewCard(race);
  const res = await fetch(`/api/images/previews/${encodeURIComponent(race.id)}`, {
    method: 'PUT', body: blob, headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token.get()}` },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  state.images.previews = { ...(state.images.previews || {}), [race.id]: (await res.json()).version };
  return true;
}

/**
 * Redraws the preview cards of every race a change touches (a driver's or team's photo or color), a moment after
 * the change, so cards already shared stay current. Batches quick successive changes into one pass.
 */
const previewQueue = { drivers: new Set(), teams: new Set(), races: new Set() };
let previewTimer;
function refreshPreviews({ drivers = [], teams = [], races = [] } = {}) {
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
/** Names whose color differs between two saved lists (including names that were added or removed). */
const colorChanges = (before, after) => {
  const was = new Map(before.map((x) => [driverId(x.name), x.color || '']));
  const now = new Map(after.map((x) => [driverId(x.name), x.color || '']));
  return [...new Set([...was.keys(), ...now.keys()])].filter((id) => was.get(id) !== now.get(id));
};

// ---------- boot ----------
api('config').then((c) => (state.config = c)).catch(() => {}).finally(route);
