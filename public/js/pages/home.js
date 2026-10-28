import { fmtRaceDate } from '../../lib/race.js';
import { api, app, esc, state } from '../core.js';

export async function showHome() {
  document.title = 'Karting Hub';
  const races = await api('races');
  app.innerHTML = `
    <div class="page-head">
      <div><h1>Races</h1></div>
      <div class="actions">
        <a class="btn" href="/teams">Teams</a>
        <a class="btn" href="/drivers">Drivers</a>
        ${state.config.editable ? '<a class="btn primary" href="/new">New race</a>' : ''}
      </div>
    </div>
    ${races.length ? `<ol class="race-list">${races.map((r) => `
      <li><a class="race-row" href="/r/${encodeURIComponent(r.id)}">
        <span class="race-date">${esc(fmtRaceDate(r.date))}</span>
        <span class="race-name">${esc(r.name)}${r.track ? `<span class="muted">${esc(r.track)}</span>` : ''}</span>
        <span class="race-teams">${esc(r.teams?.length ? r.teams.join(', ') : `${r.karts} karts`)}</span>
      </a></li>`).join('')}</ol>`
    : `<p class="empty">No races yet.${state.config.editable ? ' <a href="/new">Add the first one</a>.' : ''}</p>`}`;
}
