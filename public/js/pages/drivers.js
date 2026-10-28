import { driverId, ROLES, teamListErrors, normalizeTeams } from '../../lib/race.js';
import { autosaver, saveBar, showSaveStatus } from '../autosave.js';
import { api, app, esc, state, token } from '../core.js';
import { roleBadge } from './teams.js';
import { avatar, bindPhotoPickers, personAvatar, photoButtons } from '../photos.js';
import { colorChanges, refreshPreviews } from '../preview.js';
import { loadLists, swatch } from '../registry.js';

function driverTeams(name) {
  const rows = state.teams.flatMap((t) => t.members.filter((m) => driverId(m.driver) === driverId(name)).map((m) => ({ t, m })))
    .sort((a, b) => Number(ROLES[b.m.role].bound) - Number(ROLES[a.m.role].bound));
  return rows.length
    ? `<div class="members">${rows.map(({ t, m }) => `<a class="member" href="/teams">${avatar('teams', t.name, 18, t.color || 'var(--border)', `<span class="swatch" style="background:${t.color || 'var(--border)'}"></span>`)}${esc(t.name)} ${roleBadge(m.role)}</a>`).join('')}</div>`
    : '<span class="muted">—</span>';
}

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
      <option value="">Add to team…</option>
      ${others.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}
    </select>` : state.teams.length ? '' : '<a class="hint" href="/teams">Add teams first</a>'}
  </div>`;
}

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

export async function showDrivers() {
  document.title = 'Drivers · Karting Hub';
  const [races] = await Promise.all([api('races'), loadLists()]);
  state.driverDraft = state.drivers.map((d) => ({ ...d }));
  state.driverRaces = races;
  state.driverSave = null;
  state.saveDrivers = autosaver({
    path: 'drivers',
    body: () => ({ drivers: state.driverDraft }),
    onSaved: (res) => {
      // photo uploads need the driver to exist on the server
      const before = state.drivers.length;
      refreshPreviews({ drivers: colorChanges(state.drivers, res.drivers) });
      state.drivers = res.drivers;
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
      <div><a class="crumb" href="/">Races</a><h1>Drivers</h1>
        <div class="meta">Photos and colors follow a driver into every race.</div></div>
    </div>
    <section class="section">
      <div class="table-wrap"><table class="${edit ? 'stack-sm drivers-table' : ''}">
        <thead><tr><th>Driver</th><th class="col-color">Color</th><th class="${edit ? '' : 'hide-sm'}">Team</th><th class="hide-sm">Races</th>${edit ? '<th></th>' : ''}</tr></thead>
        <tbody>${state.driverDraft.map((d, i) => {
          const rs = racesFor(d.name);
          const ring = d.color || 'var(--border)';
          const saved = state.drivers.some((o) => driverId(o.name) === driverId(d.name));
          return `<tr>
          <td><div class="driver-cell driver-name">
            ${personAvatar(d.name, 36, ring)}
            <b>${esc(d.name)}</b></div></td>
          <td>${edit
            ? `<span class="driver-color ${d.color ? '' : 'unset'}"><input type="color" data-reg="${i}" value="${d.color || '#8e8d86'}" aria-label="Color for ${esc(d.name)}">${d.color ? `<button class="btn small clear-color" type="button" data-reg-clear="${i}" aria-label="Remove color">✕</button>` : ''}</span>`
            : d.color ? `<span class="swatch large" style="background:${d.color}"></span>` : '<span class="muted">team</span>'}</td>
          <td class="${edit ? 'team-cell' : 'hide-sm'}">${edit && saved ? driverTeamEditor(d.name) : driverTeams(d.name)}</td>
          <td class="secondary hide-sm">${rs.length ? rs.map((r) => `<a href="/r/${encodeURIComponent(r.id)}">${esc(r.name)}</a>`).join(', ') : '<span class="muted">—</span>'}</td>
          ${edit ? `<td class="actions-cell"><div class="row-actions">${saved ? `${photoButtons('drivers', d.name)}
            <button class="btn small" type="button" data-reg-rename="${esc(d.name)}">Rename</button>` : '<span class="hint">Not saved yet</span>'}
            <button class="btn small danger" type="button" data-reg-remove="${i}">Remove</button></div></td>` : ''}
        </tr>`;
        }).join('') || `<tr><td colspan="4" class="muted">No drivers yet. Add one below or save a race.</td></tr>`}</tbody>
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
    // core on the first team, rotating after that (owner/core is one team only)
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
  app.querySelectorAll('[data-reg-rename]').forEach((el) => el.addEventListener('click', async () => {
    const from = el.dataset.regRename;
    const to = prompt(`Rename ${from} to:`, from)?.trim();
    if (!to || to === from) return;
    token.set(document.getElementById('token').value.trim());
    try {
      const { races } = await api('drivers/rename', { method: 'POST', auth: true, body: JSON.stringify({ from, to }) });
      const [summaries] = await Promise.all([api('races'), loadLists()]);
      state.driverRaces = summaries;
      state.driverDraft = state.drivers.map((x) => ({ ...x }));
      refreshPreviews({ drivers: [to] });
      renderDrivers(`Renamed ${esc(from)} to ${esc(to)}${races ? ` in ${races} race${races === 1 ? '' : 's'}` : ''}.`);
    } catch (e) {
      renderDrivers(`Couldn't rename ${esc(from)}: ${esc(e.message)}`);
    }
  }));
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
  document.getElementById('token').addEventListener('change', (e) => { token.set(e.target.value.trim()); if (state.driverSave?.kind === 'error') state.saveDrivers(); });
}
