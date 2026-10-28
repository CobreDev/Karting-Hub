import { fmtTime, quantile } from '../lib/race.js';
import { esc } from './core.js';
import { swatch, teamColor } from './registry.js';

// Legend entries drawn with the same strokes the chart uses.
function legend(twoTone) {
  const line = (attrs) => `<svg width="26" height="10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" ${attrs}/></svg>`;
  const ink = 'stroke="var(--text-secondary)" stroke-width="2"';
  return [
    [line(ink), 'Lap'],
    [line(`${ink} stroke-dasharray="1.5 3" stroke-linecap="round"`), 'Slow lap'],
    [line('class="bridge"'), 'Off the chart, usually a pit stop'],
    ['<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="var(--text-secondary)"/></svg>', 'Best lap'],
    ['<svg width="6" height="12" aria-hidden="true"><line x1="3" y1="0" x2="3" y2="12" class="change"/></svg>', 'Driver change'],
    ...(twoTone ? [[line('stroke="var(--text-muted)" stroke-width="2.25" stroke-dasharray="9 7"') .replace('</svg>', '<line x1="1" y1="5" x2="25" y2="5" stroke="var(--text-primary)" stroke-width="2.25" stroke-dasharray="4 12" stroke-dashoffset="5.5"/></svg>'), 'Driver with their own color']] : []),
  ].map(([icon, label]) => `<span>${icon}${label}</span>`).join('');
}

export function lapChart(el, karts, focus) {
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
  const xStep = [5, 10, 20, 25, 50, 100].find((s) => (s / Math.max(1, xMax - 1)) * (W - m.l - m.r) >= 40) || 100;
  const xTicks = [1];
  for (let v = xStep; v <= xMax; v += xStep) xTicks.push(v);

  const series = karts.map((r) => {
    // Off-scale laps (pit stops, long yellows) aren't drawn; a dashed bridge joins the laps either side. Missing laps break the line.
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
          // long team-color dashes, short driver-color dashes in the gaps
          ? `<polyline points="${pts}" fill="none" stroke="${run.d.teamColor}" stroke-width="2.25" stroke-dasharray="9 7" stroke-linejoin="round"/>
             <polyline points="${pts}" fill="none" stroke="${run.color}" stroke-width="2.25" stroke-dasharray="4 12" stroke-dashoffset="5.5" stroke-linejoin="round"/>`
          : `<polyline points="${pts}" fill="none" stroke="${run.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');
    const gaps = bridges.map(([p, q]) => `<polyline class="bridge" points="${pt(p)} ${pt(q)}" fill="none"/>`).join('');
    // an isolated lap has no line to sit on
    const lone = r.laps.filter((l) => l.ms <= yMax && !linked.has(l))
      .map((l) => `<circle cx="${x(l.lap).toFixed(1)}" cy="${y(l.ms).toFixed(1)}" r="2.5" fill="${l.d.color}"/>`).join('');
    const bests = r.chunks.map((c) => `<circle cx="${x(c.best.lap)}" cy="${y(c.best.ms)}" r="${c.d.key === focus?.key ? 5.5 : 4.5}" fill="${c.d.color}" stroke="var(--surface-1)" stroke-width="2"/>`).join('');
    return gaps + lines + lone + bests;
  }).join('');

  const markers = karts.map((r, row) => r.chunks.map((c, i) => {
    const cx = x(c.from);
    const ly = plotBottom + 14 + row * rowH;
    return `${i ? `<line class="change" x1="${cx}" x2="${cx}" y1="${m.t}" y2="${plotBottom}"/>` : ''}
      <circle cx="${cx + 3}" cy="${ly - 4}" r="3.5" fill="${c.d.color}" ${c.d.ownColor ? `stroke="${c.d.teamColor}" stroke-width="2"` : ''}/>
      <text class="change-label" x="${cx + 10}" y="${ly}">${esc(c.d.driver)}</text>`;
  }).join('')).join('');

  el.innerHTML = `
    <div class="legend">${legend(karts.some((r) => r.chunks.some((c) => c.d.ownColor)))}</div>
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
