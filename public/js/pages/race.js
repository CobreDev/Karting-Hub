import { missingLaps, computeDrivers, fmtTime, fmtDelta, quantile, DEFAULT_SLOW_FACTOR } from '../../lib/race.js';
import { lapChart } from '../chart.js';
import { api, app, esc, fmtClock, fmtDate, shortName, state, token } from '../core.js';
import { avatar, driverAvatar } from '../photos.js';
import { uploadPreview } from '../preview.js';
import { applyTeamColors, loadRegistry, swatch, teamLabel } from '../registry.js';
import { navigate } from '../router.js';

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

const stintText =(e) => e.stints.map((s) => `${s.from}–${s.to}`).join(', ');

/** `/r/:id` race; `/r/:id/:driverKey` highlights a driver; `/r/:id/team/:kart` opens a team's laps. */
export async function showRace(id, focusKey, teamArg) {
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
