// Race Monitor parsing and lap statistics. Used by the browser, the server and the tests.

/** "00:49.250" | "1:01.234" | "1:02:03.456" -> milliseconds */
export function parseLapTime(s) {
  let sec = 0;
  for (const part of String(s).trim().split(':')) sec = sec * 60 + parseFloat(part);
  return Math.round(sec * 1000);
}

/**
 * Parse one Race Monitor "lap times" text export.
 * The kart number defaults to the leading number of the filename ("7 2.txt" -> 7),
 * because split sessions sometimes carry a different transponder number in the header.
 */
export function parseRaceMonitor(text, filename = '') {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const header = (lines[0] || '').match(/^\s*(\d+)\s*-\s*#(\S+)\s*(.*)$/);
  const laps = [];
  let session = null;
  for (const line of lines) {
    const lap = line.match(/^\s*(\d+)\s*,\s*(?:(\d+)\s*,\s*)?(\d[\d:.]*)\s*$/);
    if (lap) laps.push({ lap: +lap[1], pos: lap[2] ? +lap[2] : null, ms: parseLapTime(lap[3]) });
    const s = line.match(/race-monitor\.com\/Results\/Session\/(\d+)/i);
    if (s) session = s[1];
  }
  laps.sort((a, b) => a.lap - b.lap);
  const fileNum = filename.match(/^\s*#?(\d+)/);
  return {
    filename,
    finishPos: header ? +header[1] : null,
    headerNumber: header ? header[2] : null,
    headerName: header ? header[3].trim() : '',
    kart: fileNum ? fileNum[1] : header ? header[2] : '',
    session,
    laps,
  };
}

/** Merge parsed laps into a kart's existing laps. Existing laps win on duplicate lap numbers. */
export function mergeLaps(existing, incoming, session) {
  const byLap = new Map(existing.map((l) => [l.lap, l]));
  const duplicates = [];
  for (const l of incoming) {
    if (byLap.has(l.lap)) duplicates.push(l.lap);
    else byLap.set(l.lap, { ...l, session: session ?? null });
  }
  return { laps: [...byLap.values()].sort((a, b) => a.lap - b.lap), duplicates };
}

/** Lap numbers missing between the first and last recorded lap. */
export function missingLaps(laps) {
  const have = new Set(laps.map((l) => l.lap));
  const out = [];
  if (!laps.length) return out;
  for (let n = laps[0].lap; n <= laps[laps.length - 1].lap; n++) if (!have.has(n)) out.push(n);
  return out;
}

export function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(xs, q) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
}

/** Laps far over the kart's median: pit stops and driver changes. */
export function pitCandidates(laps) {
  const med = median(laps.map((l) => l.ms));
  return laps.filter((l) => l.ms > med * 1.8).map((l) => l.lap);
}

export const PIT_FACTOR = 1.8;
export const DEFAULT_SLOW_FACTOR = 1.1;

/**
 * One entry per driver per kart, from the kart's stints. Laps are flagged 'pit' (over 1.8x the stint median)
 * or 'slow' (over slowFactor x the median). Averages use unflagged laps; the best lap uses all of them.
 */
export function computeDrivers(race) {
  const slowFactor = race.slowFactor || DEFAULT_SLOW_FACTOR;
  const entries = new Map();
  for (const kart of race.karts || []) {
    const stints = normalizeStints(kart.stints);
    let from = 1;
    stints.forEach((stint) => {
      const to = stint.toLap ?? Infinity;
      const laps = kart.laps.filter((l) => l.lap >= from && l.lap <= to);
      const med = median(laps.map((l) => l.ms));
      const flagged = laps.map((l) => ({
        ...l,
        flag: l.ms > med * PIT_FACTOR ? 'pit' : l.ms > med * slowFactor ? 'slow' : null,
      }));
      const driver = stint.driver?.trim() || `Kart ${kart.number}`;
      const key = `${driver}|${kart.number}`;
      if (!entries.has(key)) entries.set(key, { key, driver, kart: kart.number, team: kart.team || '', stints: [], laps: [] });
      const e = entries.get(key);
      if (laps.length) e.stints.push({ from: laps[0].lap, to: laps[laps.length - 1].lap });
      e.laps.push(...flagged);
      from = to + 1;
    });
  }
  return [...entries.values()].filter((e) => e.laps.length).map(withStats);
}

function normalizeStints(stints) {
  const list = (stints && stints.length ? stints : [{ driver: '', toLap: null }]).map((s) => ({
    driver: s.driver || '',
    toLap: s.toLap === '' || s.toLap == null ? null : +s.toLap,
  }));
  // Ordered by end lap; an open-ended stint always runs to the flag.
  return list.sort((a, b) => (a.toLap ?? Infinity) - (b.toLap ?? Infinity));
}

function withStats(e) {
  const all = e.laps.map((l) => l.ms);
  const clean = e.laps.filter((l) => !l.flag).map((l) => l.ms);
  const bestLap = e.laps.reduce((b, l) => (l.ms < b.ms ? l : b), e.laps[0]);
  const avg = clean.reduce((a, b) => a + b, 0) / clean.length;
  const sd = Math.sqrt(clean.reduce((a, b) => a + (b - avg) ** 2, 0) / clean.length);
  const sorted = [...all].sort((a, b) => a - b);
  const top = sorted.slice(0, Math.min(5, sorted.length));
  return {
    ...e,
    count: all.length,
    cleanCount: clean.length,
    best: bestLap.ms,
    bestLapNo: bestLap.lap,
    avg,
    median: median(clean),
    p10: quantile(clean, 0.1),
    p90: quantile(clean, 0.9),
    stdev: sd,
    top5: top.reduce((a, b) => a + b, 0) / top.length,
    total: all.reduce((a, b) => a + b, 0),
  };
}

/** "2026-10-17" -> "Sat, Oct 17, 2026" (same in every timezone). */
export function fmtRaceDate(date) {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(+d)) return String(date || '');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Date, track, teams and fastest lap, for link previews and the preview card. */
export function raceSummary(race) {
  const drivers = computeDrivers(race);
  const fastest = drivers.reduce((b, d) => (!b || d.best < b.best ? d : b), null);
  return {
    name: race.name || 'Race',
    date: fmtRaceDate(race.date),
    track: race.track || '',
    teams: (race.karts || []).map((k) => ({ name: k.team || `Kart #${k.number}`, kart: k.number, team: k.team || '' })),
    fastest: fastest && { driver: fastest.driver, team: fastest.team, kart: fastest.kart, ms: fastest.best, lap: fastest.bestLapNo },
    drivers,
  };
}

/** 49250 -> "49.250", 61234 -> "1:01.234" */
export function fmtTime(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  const neg = ms < 0;
  ms = Math.abs(Math.round(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3);
  const out = h ? `${h}:${String(m).padStart(2, '0')}:${s.padStart(6, '0')}` : m ? `${m}:${s.padStart(6, '0')}` : s;
  return (neg ? '-' : '') + out;
}

export function fmtDelta(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  return (ms >= 0 ? '+' : '−') + (Math.abs(ms) / 1000).toFixed(3);
}

/** Drivers are matched across races and teams by name, ignoring case and surrounding spaces. */
export function driverId(name) {
  return String(name ?? '').trim().toLowerCase();
}

/**
 * Team roster roles. Owner and core drivers are bound to one team; rotating drivers can be on several rosters.
 */
export const ROLES = {
  owner: { label: 'Owner', bound: true },
  core: { label: 'Core', bound: true },
  rotating: { label: 'Rotating', bound: false },
};

/** Fills in missing fields so an older or hand-edited teams.json can't break a page. */
export function normalizeTeams(teams) {
  return (Array.isArray(teams) ? teams : [])
    .filter((t) => typeof t?.name === 'string' && t.name.trim())
    .map((t) => ({
      ...t,
      color: typeof t.color === 'string' ? t.color : '',
      members: (Array.isArray(t.members) ? t.members : []).filter((m) => typeof m?.driver === 'string' && m.driver.trim()),
    }));
}

/** Problems with a team list (empty array when it's valid). Shared by the editor and the server. */
export function teamListErrors(teams) {
  if (!Array.isArray(teams)) return ['teams must be an array'];
  const errors = [];
  const names = new Set();
  const boundTo = new Map();
  for (const t of teams) {
    const name = typeof t?.name === 'string' ? t.name.trim() : '';
    if (!name || name.length > 60) { errors.push('every team needs a name (max 60 chars)'); continue; }
    if (names.has(driverId(name))) errors.push(`duplicate team ${name}`);
    names.add(driverId(name));
    if (t.color && !/^#[0-9a-f]{6}$/i.test(t.color)) errors.push(`bad color for ${name}`);
    if (!Array.isArray(t.members || [])) { errors.push(`${name}: members must be an array`); continue; }
    const seen = new Set();
    for (const m of t.members || []) {
      const who = typeof m?.driver === 'string' ? m.driver.trim() : '';
      if (!who || who.length > 60) { errors.push(`${name}: every member needs a driver name`); continue; }
      if (!ROLES[m.role]) errors.push(`${name}: ${who} has an unknown role`);
      if (seen.has(driverId(who))) errors.push(`${who} is on ${name} twice`);
      seen.add(driverId(who));
      if (ROLES[m.role]?.bound) {
        const other = boundTo.get(driverId(who));
        if (other && other !== name) errors.push(`${who} can only be owner/core of one team (${other} and ${name})`);
        boundTo.set(driverId(who), name);
      }
    }
  }
  return errors;
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'race';
}
