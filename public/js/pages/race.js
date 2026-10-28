import { missingLaps, computeDrivers, fmtTime, fmtDelta, quantile, DEFAULT_SLOW_FACTOR, fmtRaceDate } from '../../lib/race.js';
import { lapChart } from '../chart.js';
import { api, app, esc, fmtClock, shortName, state, token } from '../core.js';
import { avatar, driverAvatar } from '../photos.js';
import { CARD_DESIGN, uploadPreview } from '../preview.js';
import { applyTeamColors, loadLists, swatch, teamLabel } from '../registry.js';
import { navigate } from '../router.js';

const helpButton = (id) => `<button class="help" type="button" popovertarget="${id}" aria-label="What does this mean?">?</button>`;
const popup = (id, title, body) => `<div id="${id}" class="popover" popover>
  <h3>${title}</h3>${body}
  <button class="btn small" type="button" popovertarget="${id}" popovertargetaction="hide">Close</button>
</div>`;
const HELP = popup('stdev-help', 'Consistency (std dev)', `
  <p>The standard deviation of a driver's clean laps, with pit stops and slow laps left out. It's the typical
  distance between one of their laps and their own average.</p>
  <p>For example, ±0.450 means most clean laps were within about half a second of the driver's average. Smaller is more
  consistent. It says nothing about speed: a slow, steady driver can score better than a fast, erratic one.</p>`)
  + popup('spread-help', 'Pace spread', `
  <svg class="spread-example" width="240" height="36" viewBox="0 0 240 36" aria-hidden="true">
    <line x1="80" x2="210" y1="12" y2="12" stroke="var(--text-secondary)" stroke-width="6" stroke-linecap="round" opacity="0.45"/>
    <line x1="135" x2="135" y1="5" y2="19" stroke="var(--text-secondary)" stroke-width="2"/>
    <circle cx="22" cy="12" r="4.5" fill="var(--text-secondary)" stroke="var(--surface-1)" stroke-width="2"/>
    <text x="22" y="33" text-anchor="middle">best</text><text x="80" y="33" text-anchor="middle">10th</text>
    <text x="135" y="33" text-anchor="middle">median</text><text x="210" y="33" text-anchor="middle">90th</text>
  </svg>
  <p>The dot is the driver's best lap. The bar covers the middle 80% of their clean laps (10th to 90th
  percentile) and the tick marks the median.</p>
  <p>Every driver is drawn on the same scale, so further left is faster and a shorter bar is more consistent.</p>`);

// Size the lap list's driver column to the longest name on the team.
let measureCtx;
function driverColumnWidths(kart) {
  measureCtx ||= document.createElement('canvas').getContext('2d');
  const widest = (names, px, weight) => {
    measureCtx.font = `${weight} ${px}px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    return Math.max(0, ...names.map((n) => measureCtx.measureText(n).width));
  };
  const names = [...new Set(kart.chunks.map((c) => c.d.driver))];
  const full = Math.ceil(widest(names, 14, 600) + 22 + 8 + 6);
  const short = Math.ceil(widest(names.map(shortName), 12, 600) + 4); // no avatar on phones
  return `--dw:${Math.min(220, Math.max(90, full))}px;--dw-sm:${Math.min(96, Math.max(44, short))}px`;
}

const stintText =(e) => e.stints.map((s) => `${s.from}–${s.to}`).join(', ');

// /r/:id, /r/:id/:driverKey (highlight a driver), /r/:id/team/:kart
export async function showRace(id, focusKey, teamArg) {
  const [race] = await Promise.all([api(`races/${encodeURIComponent(id)}`), loadLists()]);
  document.title = `${race.name} · Karting Hub`;
  const drivers = computeDrivers(race);
  applyTeamColors(race, drivers);
  const ranked = [...drivers].sort((a, b) => a.best - b.best);
  const teamView = focusKey === 'team';
  const focus = teamView ? null : drivers.find((d) => d.key === focusKey) || null;
  const karts = kartRuns(race, drivers);
  // karts race at the same time: race length is the most laps, not the sum
  const lapsOf = (k) => (k.laps.length ? k.laps[k.laps.length - 1].lap : 0);
  // the winning kart: most laps, then the least time for them
  const lapTotal = (k) => k.laps.reduce((a, l) => a + l.ms, 0);
  const winner = [...karts].sort((a, b) => lapsOf(b.k) - lapsOf(a.k) || lapTotal(a.k) - lapTotal(b.k))[0];
  const lapKart = (teamView && karts.find((r) => r.k.number === teamArg)) || (focus && karts.find((r) => r.k.number === focus.kart)) || winner;
  if (state.raceId !== id) { state.hidden = new Set(); state.raceId = id; }
  state.slowFactor = race.slowFactor;

  const fastest = ranked[0];
  const consistent = [...drivers].filter((d) => d.cleanCount >= 10).sort((a, b) => a.stdev - b.stdev)[0];
  const raceLaps = Math.max(0, ...race.karts.map(lapsOf));
  const gaps = race.karts.map((k) => ({ k, miss: missingLaps(k.laps) })).filter((g) => g.miss.length);

  app.innerHTML = `
    <div class="page-head">
      <div>
        <a class="crumb" href="/">Races</a>
        <h1>${esc(race.name)}</h1>
        <div class="meta">${esc(fmtRaceDate(race.date))}${race.track ? ` · ${esc(race.track)}` : ''}</div>
      </div>
      <div class="actions">
        <button class="btn" id="copy-link" type="button">Copy link</button>
        ${state.config.editable ? `<a class="btn" href="/edit/${encodeURIComponent(race.id)}">Edit</a>` : ''}
      </div>
    </div>

    <div class="race-head">
      <ol class="entries">${race.karts.map((k, ki) => `
        <li class="entry" style="--team:var(--t-${ki})">
          ${avatar('teams', k.team, 40, `var(--t-${ki})`, `<span class="entry-num">${esc(k.number)}</span>`)}
          <div><div class="entry-name">${esc(teamLabel(k))}${k.team ? ` <span class="muted">#${esc(k.number)}</span>` : ''}</div>
          <div class="entry-drivers">${esc(drivers.filter((d) => d.kart === k.number).map((d) => d.driver).join(', '))}</div></div>
        </li>`).join('')}</ol>

      <dl class="figures">
        ${fastest ? `<div><dt>Fastest lap</dt><dd class="figure">${fmtTime(fastest.best)}</dd>
          <dd>${esc(fastest.driver)}, lap ${fastest.bestLapNo}</dd></div>` : ''}
        ${consistent ? `<div><dt>Most consistent</dt><dd class="figure">±${(consistent.stdev / 1000).toFixed(3)} ${helpButton('stdev-help')}</dd>
          <dd>${esc(consistent.driver)}</dd></div>` : ''}
        <div><dt>Laps</dt><dd class="figure">${raceLaps}</dd>
          <dd>${race.karts.length > 1 && race.karts.length <= 4
            ? race.karts.map((k) => `#${esc(k.number)} ${lapsOf(k)}`).join(', ')
            : `${race.karts.length} kart${race.karts.length === 1 ? '' : 's'}`}</dd></div>
      </dl>
    </div>

    <section class="section">
      <div class="section-head">
        <h2>Drivers</h2>
        <p>Averages leave out pit laps and laps more than ${Math.round(((race.slowFactor || DEFAULT_SLOW_FACTOR) - 1) * 100)}% off the driver's median.</p>
      </div>
      <div class="table-wrap">${leaderboard(ranked, focus)}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Lap times</h2></div>
      <div class="chips" id="chips">${karts.map((r) => `
        <button class="chip" type="button" data-key="${esc(r.k.number)}" aria-pressed="${!state.hidden.has(r.k.number)}">
          <span class="swatch" style="background:${r.color}"></span>${esc(r.label)} <span class="muted">#${esc(r.k.number)}</span></button>`).join('')}</div>
      <div class="chart" id="lap-chart"></div>
    </section>

    <section class="section" id="focus">${lapSection(focus, karts, lapKart)}</section>

    ${HELP}
    ${gaps.length ? `<p class="footnote">No timing data for ${gaps.map((g) => `#${esc(g.k.number)} lap${g.miss.length > 1 ? 's' : ''} ${g.miss.join(', ')}`).join('; ')}.</p>` : ''}
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
    // browsers without the popover API (iOS before 17) get the text in an alert instead
    const help = ev.target.closest('[popovertarget]');
    if (help && !HTMLElement.prototype.togglePopover) alert(document.getElementById(help.getAttribute('popovertarget')).innerText);
    const pick = ev.target.closest('[data-focus]');
    if (pick) navigate(`/r/${encodeURIComponent(race.id)}/${encodeURIComponent(pick.dataset.focus)}`);
    const rerender = () => (document.getElementById('focus').innerHTML = lapSection(focus, karts, lapKart));
    const team = ev.target.closest('[data-team]');
    if (team) navigate(`/r/${encodeURIComponent(race.id)}/team/${encodeURIComponent(team.dataset.team)}`);
    if (ev.target.closest('[data-order]')) { state.newestFirst = !state.newestFirst; rerender(); }

  };
  // races saved before link previews existed
  if (state.config.editable && token.get() && !(state.images.previews?.[race.id] >= CARD_DESIGN)) uploadPreview(race).catch(() => {});
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
      <th class="num">Avg</th><th class="num hide-sm">Median</th><th class="num hide-sm">Std dev ${helpButton('stdev-help')}</th>
      <th class="hide-sm">Pace spread ${helpButton('spread-help')}</th>
    </tr></thead>
    <tbody>${ranked.map((d, i) => `
      <tr class="clickable ${d.key === focus?.key ? 'focused' : ''}" data-focus="${esc(d.key)}">
        <td class="num muted">${i + 1}</td>
        <td><div class="driver-cell">${driverAvatar(d)}<span>${esc(d.driver)}<span class="show-sm team-sub">${esc(d.team || `Kart #${d.kart}`)}</span></span></div></td>
        <td class="secondary hide-sm nowrap">${esc(d.team || `Kart #${d.kart}`)} <span class="muted">#${esc(d.kart)}</span></td>
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

// Per kart: every lap tagged with its driver, grouped into stints.
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
  // cap the bar scale so one long pit stop doesn't flatten every other bar
  const scaleMax = Math.min(Math.max(...kart.laps.map((l) => l.ms)), med * 3.2);
  // Δ prev restarts at each driver change
  const rows = kart.chunks.flatMap((c) => c.laps.map((l, i) => {
    const p = c.laps[i - 1];
    return { ...l, c, firstOfStint: i === 0, prev: p && p.lap === l.lap - 1 ? p.ms : null };
  }));
  if (state.newestFirst) rows.reverse();

  return `
    <div class="section-head"><h2>Lap by lap</h2></div>
    <div class="tabs" role="tablist" aria-label="Team">${karts.map((r) => `
      <button class="tab" type="button" role="tab" data-team="${esc(r.k.number)}" aria-pressed="${r === kart}" aria-selected="${r === kart}">
        ${avatar('teams', r.k.team, 18, r.color, `<span class="swatch" style="background:${r.color}"></span>`)}${esc(r.label)} <span class="muted">#${esc(r.k.number)}</span></button>`).join('')}</div>

    <div class="rm" style="${driverColumnWidths(kart)}">
      <div class="rm-head">
        <dl class="figures">
          <div><dt>Laps</dt><dd class="figure">${kart.laps.length}</dd></div>
          <div><dt>Lap time total</dt><dd class="figure">${fmtTime(kartTotal).replace(/\.\d+$/, '')}</dd></div>
          <div><dt>Best lap</dt><dd class="figure">${fmtTime(kartBest.ms)}</dd><dd>lap ${kartBest.lap}</dd></div>
          <div><dt>Gap to fastest</dt><dd class="figure">${kartBest.ms === fastest ? '—' : fmtDelta(kartBest.ms - fastest)}</dd></div>
        </dl>
        <table class="stints">
          <thead><tr><th>Driver</th><th class="num">Laps</th><th class="num">Best</th><th class="num">Avg</th></tr></thead>
          <tbody>${kart.chunks.map((c) => `
            <tr class="${c.d.key === focus?.key ? 'focused' : ''}" style="--stint-color:${c.d.color}">
              <td><span class="driver-cell">${driverAvatar(c.d, 20)}${esc(c.d.driver)}</span></td>
              <td class="num">${c.from}–${c.to}</td><td class="num">${fmtTime(c.best.ms)}</td><td class="num">${fmtTime(c.avg)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="rm-toolbar"><button class="btn small" type="button" data-order>${state.newestFirst ? 'Oldest first' : 'Newest first'}</button></div>
      <div class="rm-cols"><span>Lap</span><span>Pos</span><span>Driver</span><span>Time</span><span class="num">Δ best</span><span class="num">Δ prev</span><span class="hide-sm"></span></div>
      ${rows.map((l) => {
        const isBest = l.lap === l.c.best.lap;
        const dPrev = l.prev == null ? null : l.ms - l.prev;
        const kind = l.flag === 'pit' ? 'crit' : l.flag === 'slow' ? 'warn' : 'good';
        const handover = state.newestFirst ? l.lap === l.c.to && l.c !== kart.chunks[kart.chunks.length - 1] : l.firstOfStint && l.c !== kart.chunks[0];
        return `<div class="rm-row ${l.c.d.key === focus?.key ? 'focused' : ''} ${handover ? 'handover' : ''}" style="--stint-color:${l.c.d.color}" ${l.lap === l.c.from && l.c.d.key === focus?.key ? 'id="focus-start"' : ''}>
          <span class="rm-lap">${l.lap}</span>
          <span class="rm-pos">${l.pos ?? ''}</span>
          <span class="rm-driver">${driverAvatar(l.c.d, 22)}<span class="dn-full">${esc(l.c.d.driver)}</span><span class="dn-short">${esc(shortName(l.c.d.driver))}</span></span>
          <span class="rm-time ${isBest ? 'best-time' : ''}"><span class="t-full">${fmtClock(l.ms)}</span><span class="t-short">${fmtTime(l.ms)}</span>
            <i class="rm-bar ${kind}" style="width:${Math.min(100, (l.ms / scaleMax) * 100).toFixed(1)}%"></i></span>
          <span class="num rm-delta">${isBest ? '<span class="tag best">Best</span>' : fmtDelta(l.ms - l.c.best.ms)}</span>
          <span class="num rm-delta ${dPrev == null ? '' : dPrev < 0 ? 'faster' : 'slower'}">${dPrev == null ? '' : `${dPrev < 0 ? '▼' : '▲'} ${(Math.abs(dPrev) / 1000).toFixed(3)}`}</span>
          <span class="rm-note hide-sm">${l.flag === 'pit' ? '<span class="tag">Pit</span>' : l.flag === 'slow' ? '<span class="tag">Slow</span>' : ''}</span>
        </div>`;
      }).join('')}
      <div class="rm-legend"><span><i class="rm-key good"></i>Clean</span><span><i class="rm-key warn"></i>Slow</span><span><i class="rm-key crit"></i>Pit</span><span>Δ best is against that driver's own best.</span></div>
    </div>`;
}
