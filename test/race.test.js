import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLapTime, parseRaceMonitor, mergeLaps, missingLaps, computeDrivers, fmtTime, fmtDelta, driverId, teamListErrors,
} from '../public/lib/race.js';
import { teamShades } from '../public/lib/color.js';
import { imageType, imageId } from '../public/lib/images.js';

const SAMPLE = `12 - #7 7
Laps: 3
Total time: 02:00:15.000
Best time: 00:49.250 in lap 19

Lap, Position, Time
31, 3, 00:49.512
30, 4, 02:10.500
29, 4, 00:49.904

http://www.race-monitor.com/Results/Session/1000002
`;

test('parseLapTime handles m:ss and h:mm:ss', () => {
  assert.equal(parseLapTime('00:49.250'), 49250);
  assert.equal(parseLapTime('02:10.500'), 130500);
  assert.equal(parseLapTime('1:02:03.456'), 3723456);
});

test('parseRaceMonitor reads header, laps (sorted) and session', () => {
  const p = parseRaceMonitor(SAMPLE, '7 1.txt');
  assert.equal(p.kart, '7');
  assert.equal(p.headerNumber, '7');
  assert.equal(p.finishPos, 12);
  assert.equal(p.session, '1000002');
  assert.deepEqual(p.laps.map((l) => l.lap), [29, 30, 31]);
  assert.deepEqual(p.laps[0], { lap: 29, pos: 4, ms: 49904 });
});

test('kart number comes from the filename, not the header transponder', () => {
  const p = parseRaceMonitor(SAMPLE.replace('#7 7', '#99 99'), '12 2.txt');
  assert.equal(p.kart, '12');
  assert.equal(p.headerNumber, '99');
});

test('mergeLaps keeps existing laps on duplicates and reports them', () => {
  const { laps, duplicates } = mergeLaps([{ lap: 1, ms: 50000 }], [{ lap: 1, ms: 1 }, { lap: 2, ms: 51000 }], 's');
  assert.deepEqual(laps.map((l) => l.ms), [50000, 51000]);
  assert.deepEqual(duplicates, [1]);
});

test('missingLaps finds timing gaps', () => {
  assert.deepEqual(missingLaps([{ lap: 8 }, { lap: 9 }, { lap: 14 }]), [10, 11, 12, 13]);
});

test('computeDrivers splits stints, flags pit laps and excludes them from averages', () => {
  const laps = [];
  for (let n = 1; n <= 20; n++) laps.push({ lap: n, ms: n === 10 ? 140000 : 50000 + n });
  const race = { karts: [{ number: '7', team: 'Team Apex', laps, stints: [{ driver: 'Alex', toLap: 10 }, { driver: 'Jordan', toLap: null }] }] };
  const [alex, jordan] = computeDrivers(race);
  assert.equal(alex.driver, 'Alex');
  assert.deepEqual(alex.stints, [{ from: 1, to: 10 }]);
  assert.equal(alex.laps.find((l) => l.lap === 10).flag, 'pit');
  assert.equal(alex.cleanCount, 9);
  assert.equal(alex.best, 50001);
  assert.ok(alex.avg < 51000, 'pit lap must not drag the average');
  assert.deepEqual(jordan.stints, [{ from: 11, to: 20 }]);
  assert.equal(jordan.team, 'Team Apex');
});

test('a kart with no stints becomes one "Kart N" driver', () => {
  const [d] = computeDrivers({ karts: [{ number: '7', laps: [{ lap: 1, ms: 50000 }], stints: [] }] });
  assert.equal(d.driver, 'Kart 7');
});

test('formatters', () => {
  assert.equal(fmtTime(49250), '49.250');
  assert.equal(fmtTime(61234), '1:01.234');
  assert.equal(fmtTime(7215000), '2:00:15.000');
  assert.equal(fmtDelta(412), '+0.412');
  assert.equal(fmtDelta(-1205), '−1.205');
});

test('teamShades returns n valid colors, team color first in light mode', () => {
  const shades = teamShades('#6250d6', 3, 'light');
  assert.equal(shades.length, 3);
  assert.equal(shades[0], '#6250d6');
  for (const s of [...shades, ...teamShades('#2a78d6', 4, 'dark')]) assert.match(s, /^#[0-9a-f]{6}$/);
});

test('drivers match across races by name, ignoring case and spaces', () => {
  assert.equal(driverId(' Alex '), driverId('alex'));
  assert.notEqual(driverId('Alex'), driverId('Alexa'));
});

test('imageType recognises WebP, JPEG and PNG by their bytes, and nothing else', () => {
  const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
  assert.equal(imageType(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')), 'image/webp');
  assert.equal(imageType(bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF')), 'image/jpeg');
  assert.equal(imageType(bytes([0x89], 'PNG', [13, 10, 26, 10, 0])), 'image/png');
  assert.equal(imageType(bytes('<svg onload=alert(1)>')), null);
  assert.equal(imageType(bytes('GIF89a.......')), null);
});

test('imageId turns names into safe file names', () => {
  assert.equal(imageId('Team Apex'), 'team-apex');
  assert.equal(imageId(' Alex '), 'alex');
  assert.match(imageId('../../etc/passwd'), /^[a-z0-9-]+$/);
});

test('team rosters: owner/core drivers are bound to one team, rotating drivers can be on several', () => {
  const ok = [
    { name: 'Team Apex', color: '#eb6834', members: [{ driver: 'Alex', role: 'owner' }, { driver: 'Sam', role: 'rotating' }] },
    { name: 'Team Blue', color: '', members: [{ driver: 'Jordan', role: 'core' }, { driver: 'Sam', role: 'rotating' }] },
  ];
  assert.deepEqual(teamListErrors(ok), []);
  const twoOwners = [ok[0], { name: 'Team Blue', members: [{ driver: 'alex', role: 'core' }] }];
  assert.match(teamListErrors(twoOwners)[0], /only be owner\/core of one team/);
  assert.match(teamListErrors([{ name: 'A', members: [{ driver: 'X', role: 'boss' }] }])[0], /unknown role/);
  assert.match(teamListErrors([{ name: 'A' }, { name: 'a' }])[0], /duplicate team/);
  assert.match(teamListErrors([{ name: 'A', members: [{ driver: 'X', role: 'core' }, { driver: 'x', role: 'rotating' }] }])[0], /twice/);
});
