// Karting Hub — zero-dependency Node server: static dashboard + JSON race storage.
import http from 'node:http';
import { readFile, writeFile, readdir, rename, unlink, mkdir, access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { IMAGE_KINDS, MAX_IMAGE_BYTES, imageType } from './public/lib/images.js';
import { teamListErrors, normalizeTeams, raceSummary, fmtTime } from './public/lib/race.js';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = +(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const RACES = path.join(DATA_DIR, 'races');
const DRIVERS = path.join(DATA_DIR, 'drivers.json');
const TEAMS = path.join(DATA_DIR, 'teams.json');
const IMAGES = path.join(DATA_DIR, 'images');
const TOKEN = process.env.ADMIN_TOKEN || '';
// Public address used in link previews (e.g. https://karting.example.ts.net). Guessed from the request if unset.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const MAX_BODY = 5 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function init() {
  try {
    await mkdir(RACES, { recursive: true });
    for (const kind of IMAGE_KINDS) await mkdir(path.join(IMAGES, kind), { recursive: true });
    await access(RACES, constants.W_OK);
  } catch (e) {
    const uid = process.getuid?.() ?? '?';
    const gid = process.getgid?.() ?? '?';
    console.error(`Cannot write to ${RACES} (${e.code}). Races would not be saved.\n` +
      `Make the mounted data folder writable by uid ${uid}:${gid} (the container fixes this itself unless it was started with --user).`);
    process.exit(1);
  }
  // The driver and team lists (names, colors, rosters) are shared by every race; start them empty.
  for (const [file, empty] of [[DRIVERS, { drivers: [] }], [TEAMS, { teams: [] }]]) {
    await access(file).catch(() => writeJson(file, empty));
  }
  if (!TOKEN) console.warn('ADMIN_TOKEN is not set: the dashboard is read-only (no uploads or edits).');
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? MIME['.json'] : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function authorized(req) {
  if (!TOKEN) return false;
  const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}

function readRaw(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const readBody = async (req) => (await readRaw(req)).toString('utf8');

const raceFile = (id) => path.join(RACES, `${id}.json`);

async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

function validateDrivers(body) {
  if (!body || !Array.isArray(body.drivers)) return 'drivers must be an array';
  const seen = new Set();
  for (const d of body.drivers) {
    if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 60) return 'every driver needs a name (max 60 chars)';
    if (d.color && !/^#[0-9a-f]{6}$/i.test(d.color)) return `bad color for ${d.name}`;
    const key = d.name.trim().toLowerCase();
    if (seen.has(key)) return `duplicate driver ${d.name}`;
    seen.add(key);
  }
  return null;
}

async function listRaces() {
  const out = [];
  for (const f of (await readdir(RACES)).filter((f) => f.endsWith('.json'))) {
    try {
      const r = JSON.parse(await readFile(path.join(RACES, f), 'utf8'));
      const drivers = new Set();
      for (const k of r.karts || []) for (const s of k.stints || []) if (s.driver) drivers.add(s.driver);
      // Who drove for which team, so the Teams page can show history without loading every race.
      const lineups = (r.karts || []).map((k) => ({
        team: k.team || '',
        kart: k.number,
        drivers: [...new Set((k.stints || []).map((st) => st.driver).filter(Boolean))],
      }));
      out.push({ id: r.id, name: r.name, track: r.track, date: r.date, karts: (r.karts || []).length, teams: (r.karts || []).map((k) => k.team || `#${k.number}`), drivers: [...drivers], lineups });
    } catch (e) {
      console.error(`skipping ${f}: ${e.message}`);
    }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function validateRace(r, id) {
  if (!r || typeof r !== 'object') return 'race must be an object';
  if (r.id !== id) return 'race id does not match URL';
  if (typeof r.name !== 'string' || !r.name.trim()) return 'name is required';
  if (!Array.isArray(r.karts)) return 'karts must be an array';
  for (const k of r.karts) {
    if (!Array.isArray(k.laps) || !Array.isArray(k.stints || [])) return `kart ${k.number}: bad laps/stints`;
    if (k.laps.some((l) => !Number.isFinite(l.lap) || !Number.isFinite(l.ms))) return `kart ${k.number}: bad lap row`;
  }
  return null;
}

async function api(req, res, parts) {
  const [, , id] = parts; // /api/races/:id -> ['', 'races', id]
  if (parts[1] === 'health') return send(res, 200, { ok: true });
  if (parts[1] === 'config') return send(res, 200, { editable: !!TOKEN });
  if (parts[1] === 'auth') return authorized(req) ? send(res, 200, { ok: true }) : send(res, 401, { error: 'bad token' });
  if (parts[1] === 'images') return images(req, res, parts[2], parts[3]);
  if (parts[1] === 'teams') {
    if (req.method === 'GET') {
      const stored = JSON.parse(await readFile(TEAMS, 'utf8').catch(() => '{"teams":[]}'));
      return send(res, 200, { teams: normalizeTeams(stored.teams) });
    }
    if (req.method !== 'PUT') return send(res, 405, { error: 'method not allowed' });
    if (!authorized(req)) return send(res, 401, { error: TOKEN ? 'bad or missing admin token' : 'editing disabled: set ADMIN_TOKEN' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return send(res, e.status || 400, { error: e.status ? e.message : 'invalid JSON' });
    }
    const errors = teamListErrors(body?.teams);
    if (errors.length) return send(res, 400, { error: errors[0], errors });
    const teams = body.teams
      .map((t) => ({
        name: t.name.trim(),
        color: t.color ? t.color.toLowerCase() : '',
        members: (t.members || []).map((m) => ({ driver: m.driver.trim(), role: m.role })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    await writeJson(TEAMS, { teams });
    return send(res, 200, { ok: true, teams });
  }
  if (parts[1] === 'drivers') {
    if (req.method === 'GET') return send(res, 200, JSON.parse(await readFile(DRIVERS, 'utf8').catch(() => '{"drivers":[]}')));
    if (req.method !== 'PUT') return send(res, 405, { error: 'method not allowed' });
    if (!authorized(req)) return send(res, 401, { error: TOKEN ? 'bad or missing admin token' : 'editing disabled: set ADMIN_TOKEN' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return send(res, e.status || 400, { error: e.status ? e.message : 'invalid JSON' });
    }
    const err = validateDrivers(body);
    if (err) return send(res, 400, { error: err });
    const drivers = body.drivers
      .map((d) => ({ name: d.name.trim(), color: d.color ? d.color.toLowerCase() : '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    await writeJson(DRIVERS, { drivers });
    return send(res, 200, { ok: true, drivers });
  }
  if (parts[1] !== 'races') return send(res, 404, { error: 'not found' });

  if (!id) {
    if (req.method === 'GET') return send(res, 200, await listRaces());
    return send(res, 405, { error: 'method not allowed' });
  }
  if (!ID_RE.test(id)) return send(res, 400, { error: 'bad race id' });

  if (req.method === 'GET') {
    try {
      return send(res, 200, JSON.parse(await readFile(raceFile(id), 'utf8')));
    } catch {
      return send(res, 404, { error: 'race not found' });
    }
  }
  if (!authorized(req)) return send(res, 401, { error: TOKEN ? 'bad or missing admin token' : 'editing disabled: set ADMIN_TOKEN' });

  if (req.method === 'PUT') {
    let race;
    try {
      race = JSON.parse(await readBody(req));
    } catch (e) {
      return send(res, e.status || 400, { error: e.status ? e.message : 'invalid JSON' });
    }
    const err = validateRace(race, id);
    if (err) return send(res, 400, { error: err });
    await writeJson(raceFile(id), race);
    return send(res, 200, { ok: true, id });
  }
  if (req.method === 'DELETE') {
    await unlink(raceFile(id)).catch(() => {});
    await unlink(imageFile('previews', id)).catch(() => {});
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'method not allowed' });
}

// ---------- profile pictures: DATA_DIR/images/<drivers|teams>/<id>.img ----------
const imageFile = (kind, id) => path.join(IMAGES, kind, `${id}.img`);

/** GET /api/images -> { drivers: { id: version }, teams: {...} }; PUT/DELETE /api/images/:kind/:id (admin). */
async function images(req, res, kind, id) {
  if (!kind) {
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    const out = {};
    for (const k of IMAGE_KINDS) {
      out[k] = {};
      for (const f of (await readdir(path.join(IMAGES, k)).catch(() => [])).filter((f) => f.endsWith('.img'))) {
        // The modification time doubles as a cache-busting version.
        out[k][f.slice(0, -4)] = Math.round((await stat(path.join(IMAGES, k, f))).mtimeMs);
      }
    }
    return send(res, 200, out);
  }
  if (!IMAGE_KINDS.includes(kind) || !ID_RE.test(id || '')) return send(res, 400, { error: 'bad image path' });
  if (!authorized(req)) return send(res, 401, { error: TOKEN ? 'bad or missing admin token' : 'editing disabled: set ADMIN_TOKEN' });
  if (req.method === 'DELETE') {
    await unlink(imageFile(kind, id)).catch(() => {});
    return send(res, 200, { ok: true });
  }
  if (req.method !== 'PUT') return send(res, 405, { error: 'method not allowed' });
  const tooBig = { error: 'image too large (max 1 MB) — it should be resized before upload' };
  if (+req.headers['content-length'] > MAX_IMAGE_BYTES) return send(res, 413, tooBig, { Connection: 'close' });
  let data;
  try {
    data = await readRaw(req, MAX_IMAGE_BYTES);
  } catch (e) {
    return send(res, e.status || 400, e.status === 413 ? tooBig : { error: 'upload failed' });
  }
  if (!imageType(data)) return send(res, 415, { error: 'not a WebP, JPEG or PNG image' });
  const tmp = `${imageFile(kind, id)}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, imageFile(kind, id));
  return send(res, 200, { ok: true, version: Math.round((await stat(imageFile(kind, id))).mtimeMs) });
}

async function serveImage(req, res, kind, id, query) {
  if (!IMAGE_KINDS.includes(kind) || !ID_RE.test(id || '')) return send(res, 404, 'not found');
  let data;
  try {
    data = await readFile(imageFile(kind, id));
  } catch {
    return send(res, 404, 'not found');
  }
  res.writeHead(200, {
    'Content-Type': imageType(data) || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    // URLs carry ?v=<mtime>, so a versioned URL never changes content.
    'Cache-Control': query.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

// ---------- link previews (iMessage, Slack, Discord…) ----------
const escAttr = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || (/\.ts\.net$|\.(com|net|org|dev|app|io)$/.test(host.split(':')[0]) ? 'https' : 'http');
  return `${proto}://${host}`;
}

async function imageVersion(kind, id) {
  try {
    return Math.round((await stat(imageFile(kind, id))).mtimeMs);
  } catch {
    return null;
  }
}

/** Open Graph tags for a page. Race pages describe the race; driver links describe that driver's stint. */
async function previewMeta(req, pathname) {
  const base = baseUrl(req);
  const meta = {
    title: 'Karting Hub',
    description: 'Lap times, stints and teams from our endurance kart races.',
    image: `${base}/og-default.png`,
    url: `${base}${pathname}`,
    large: false,
  };
  const [, kind, id, focus] = pathname.split('/').map((p) => decodeURIComponent(p || ''));
  if (kind !== 'r' || !ID_RE.test(id || '')) return meta;
  let race;
  try {
    race = JSON.parse(await readFile(raceFile(id), 'utf8'));
  } catch {
    return meta;
  }
  const sum = raceSummary(race);
  const where = [sum.date, sum.track].filter(Boolean).join(' · ');
  const teams = sum.teams.map((t) => t.name).join(' vs ');
  const fast = sum.fastest ? `Fastest lap ${fmtTime(sum.fastest.ms)} by ${sum.fastest.driver}${sum.fastest.team ? ` (${sum.fastest.team})` : ''}` : '';
  meta.title = sum.name;
  meta.description = [where, teams, fast].filter(Boolean).join('\n');
  const d = focus && focus !== 'team' && sum.drivers.find((x) => x.key === focus);
  if (d) {
    meta.title = `${d.driver} · ${sum.name}`;
    meta.description = [`Best ${fmtTime(d.best)} · avg ${fmtTime(d.avg)} · ${d.count} laps${d.team ? ` for ${d.team}` : ''}`, where].join('\n');
  }
  const v = await imageVersion('previews', id);
  if (v) Object.assign(meta, { image: `${base}/images/previews/${id}?v=${v}`, large: true });
  return meta;
}

async function serveIndex(req, res, pathname) {
  const html = await readFile(path.join(PUBLIC, 'index.html'), 'utf8');
  const m = await previewMeta(req, pathname);
  const tags = [
    ['og:site_name', 'Karting Hub'], ['og:type', 'website'], ['og:title', m.title], ['og:description', m.description],
    ['og:url', m.url], ['og:image', m.image],
    ...(m.large ? [['og:image:width', '1200'], ['og:image:height', '630'], ['og:image:type', 'image/png']] : []),
  ].map(([k, v]) => `<meta property="${k}" content="${escAttr(v)}">`);
  tags.push(`<meta name="twitter:card" content="${m.large ? 'summary_large_image' : 'summary'}">`, `<meta name="description" content="${escAttr(m.description)}">`);
  const out = html
    .replace('<title>Karting Hub</title>', `<title>${escAttr(m.title)}</title>\n  ${tags.join('\n  ')}`);
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : out);
}

async function serveStatic(req, res, pathname) {
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden');
  try {
    if (pathname === '/index.html') return await serveIndex(req, res, '/');
    let data;
    try {
      data = await readFile(file);
    } catch {
      return await serveIndex(req, res, pathname); // SPA fallback: any app route gets the page plus preview tags
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 404, 'not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname, searchParams } = new URL(req.url, 'http://x');
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'api') return await api(req, res, ['', ...parts.slice(1)]);
    if (parts[0] === 'images' && parts.length === 3) return await serveImage(req, res, parts[1], parts[2], searchParams);
    return await serveStatic(req, res, pathname === '/' ? '/index.html' : pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'server error' });
  }
});

await init();
server.listen(PORT, () => console.log(`Karting Hub on http://0.0.0.0:${PORT} (data: ${DATA_DIR})`));
