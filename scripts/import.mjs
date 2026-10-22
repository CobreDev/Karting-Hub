#!/usr/bin/env node
// Build a race JSON from Race Monitor text exports, e.g.
//   node scripts/import.mjs --name "Saturday Enduro" --track "My Track" --date 2026-03-14 \
//     --stints "7=Alex:52,Jordan:90,Sam" --team "7=Team Apex:#eb6834" --out race.json exports/*.txt
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseRaceMonitor, mergeLaps, slugify } from '../public/lib/race.js';

const args = process.argv.slice(2);
const opts = { stints: [], team: [] };
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--stints') opts.stints.push(args[++i]);
  else if (a === '--team') opts.team.push(args[++i]);
  else if (a.startsWith('--')) opts[a.slice(2)] = args[++i];
  else files.push(a);
}
if (!files.length) {
  console.error('usage: import.mjs [--name N] [--track T] [--date YYYY-MM-DD] [--stints "85=A:52,B:90,C"] [--team "85=Name:#hex"] [--out file] files...');
  process.exit(1);
}

const karts = new Map();
for (const f of files) {
  const parsed = parseRaceMonitor(await readFile(f, 'utf8'), path.basename(f));
  const kart = karts.get(parsed.kart) || { number: parsed.kart, team: '', laps: [], stints: [] };
  const { laps, duplicates } = mergeLaps(kart.laps, parsed.laps, parsed.session);
  if (duplicates.length) console.warn(`${f}: kept existing laps for duplicates ${duplicates.join(', ')}`);
  kart.laps = laps;
  karts.set(parsed.kart, kart);
}

for (const spec of opts.stints) {
  const [num, list] = spec.split('=');
  const kart = karts.get(num);
  if (!kart) throw new Error(`--stints: no kart ${num}`);
  kart.stints = list.split(',').map((s) => {
    const [driver, toLap] = s.split(':');
    return { driver: driver.trim(), toLap: toLap ? +toLap : null };
  });
}

for (const spec of opts.team) {
  const [num, rest] = spec.split('=');
  const kart = karts.get(num);
  if (!kart) throw new Error(`--team: no kart ${num}`);
  const [team, color] = rest.split(':');
  kart.team = team.trim();
  if (color) kart.color = color.trim();
}

const name = opts.name || 'Race';
const race = {
  id: opts.id || slugify(`${opts.date || ''} ${name}`),
  name,
  track: opts.track || '',
  date: opts.date || new Date().toISOString().slice(0, 10),
  slowFactor: 1.1,
  karts: [...karts.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
};
const json = JSON.stringify(race, null, 2);
if (opts.out) await writeFile(opts.out, json + '\n');
else console.log(json);
