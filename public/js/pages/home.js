import { fmtRaceDate } from '../../lib/race.js';
import { api, app, esc, state } from '../core.js';

export async function showHome() {
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
        <div class="secondary">${esc(fmtRaceDate(r.date))}${r.track ? ` · ${esc(r.track)}` : ''}</div>
        <div class="drivers">${r.teams?.length ? esc(r.teams.join(' vs ')) : `${r.karts} kart${r.karts === 1 ? '' : 's'}`}${r.drivers.length ? ` · ${esc(r.drivers.join(', '))}` : ''}</div>
      </a>`).join('')}</div>`
    : `<div class="card muted">No races yet.${state.config.editable ? ' <a href="/new">Add one</a>.' : ''}</div>`}`;
}
