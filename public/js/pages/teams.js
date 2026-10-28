import { driverId, ROLES, teamListErrors, normalizeTeams } from '../../lib/race.js';
import { autosaver, saveBar, showSaveStatus } from '../autosave.js';
import { api, app, esc, state, token } from '../core.js';
import { avatar, bindPhotoPickers, initials, personAvatar, photoButtons } from '../photos.js';
import { colorChanges, refreshPreviews } from '../preview.js';
import { driverRing, isSavedDriver, loadRegistry, swatch, teamColor } from '../registry.js';

export async function showTeams() {
  document.title = 'Teams · Karting Hub';
  const [races] = await Promise.all([api('races'), loadRegistry()]);
  state.teamDraft = state.teams.map((t) => ({ ...t, members: t.members.map((m) => ({ ...m })) }));
  state.teamRaces = races;
  state.openTeam = null;
  state.teamSave = null;
  state.saveTeams = autosaver({
    path: 'teams',
    body: () => ({ teams: state.teamDraft }),
    validate: () => teamListErrors(state.teamDraft),
    onSaved: (res) => {
      // Photo buttons appear once a new team is on the saved list.
      const before = state.teams.length;
      refreshPreviews({ teams: colorChanges(state.teams, res.teams) });
      state.teams = normalizeTeams(res.teams);
      if (res.teams.length !== before && location.pathname === '/teams') renderTeams();
    },
    status: (kind, text) => { state.teamSave = { kind, text }; showSaveStatus(kind, text); },
  });
  renderTeams();
}

/** Drivers who raced for a team in saved races, most recent race first. */
function teamHistory(name) {
  const out = new Map();
  for (const r of state.teamRaces) {
    for (const l of r.lineups || []) {
      if (driverId(l.team) !== driverId(name)) continue;
      for (const d of l.drivers) if (!out.has(driverId(d))) out.set(driverId(d), d);
    }
  }
  return [...out.values()];
}

export const roleBadge = (role) => `<span class="role role-${role}" title="${ROLES[role].bound ? 'Tied to this team' : 'Can also race for other teams'}">${ROLES[role].label}</span>`;
const memberChip = (m) => `<span class="member">${personAvatar(m.driver, 20, driverRing(m.driver))}${esc(m.driver)} ${roleBadge(m.role)}</span>`;

function renderTeams(message) {
  const edit = state.config.editable;
  const racesFor = (name) => state.teamRaces.filter((r) => (r.lineups || []).some((l) => driverId(l.team) === driverId(name)));
  const errors = teamListErrors(state.teamDraft);
  const order = { owner: 0, core: 1, rotating: 2 };
  app.innerHTML = `
    <div class="page-head">
      <div><div><a href="/">← All races</a></div><h1 style="margin-top:6px">Teams</h1>
        <div class="meta">Team colors and photos apply in every race. Owner and core drivers are tied to one team; rotating drivers can race for others.</div></div>
    </div>
    <section class="card section">
      <div class="table-wrap"><table class="stack-sm teams-table">
        <thead><tr><th>Team</th><th style="width:70px">Color</th><th>Roster</th><th class="hide-sm">Races</th>${edit ? '<th></th>' : ''}</tr></thead>
        <tbody>${state.teamDraft.map((t, i) => {
          const rs = racesFor(t.name);
          const ring = t.color || 'var(--border)';
          const saved = state.teams.some((o) => driverId(o.name) === driverId(t.name));
          const open = state.openTeam === i;
          const members = [...t.members].sort((a, b) => order[a.role] - order[b.role] || a.driver.localeCompare(b.driver));
          return `<tr>
            <td><div class="driver-cell driver-name">
              ${avatar('teams', t.name, 36, ring, `<span class="avatar placeholder" style="--ring:${ring};width:36px;height:36px;font-size:13px">${initials(t.name)}</span>`)}
              <b>${esc(t.name)}</b></div></td>
            <td>${edit
              ? `<span class="driver-color ${t.color ? '' : 'unset'}"><input type="color" data-team-color="${i}" value="${t.color || '#8e8d86'}" aria-label="Color for ${esc(t.name)}"></span>`
              : t.color ? `<span class="swatch" style="background:${t.color};width:16px;height:16px"></span>` : '<span class="muted">—</span>'}</td>
            <td class="roster-cell"><div class="members">${members.map(memberChip).join('') || '<span class="muted">No roster yet</span>'}</div></td>
            <td class="secondary hide-sm">${rs.length ? rs.map((r) => `<a href="/r/${encodeURIComponent(r.id)}">${esc(r.name)}</a>`).join(', ') : '<span class="muted">—</span>'}</td>
            ${edit ? `<td class="actions-cell"><div class="row-actions">
              <button class="btn small" type="button" data-team-open="${i}" aria-expanded="${open}">${open ? 'Done' : 'Edit roster'}</button>
              ${saved ? photoButtons('teams', t.name) : '<span class="muted" style="font-size:12px">not saved yet</span>'}
              <button class="btn small danger" type="button" data-team-remove="${i}">Remove</button></div></td>` : ''}
          </tr>
          ${edit && open ? `<tr class="roster-row"><td colspan="5">${rosterEditor(t, i)}</td></tr>` : ''}`;
        }).join('') || `<tr><td colspan="5" class="muted">No teams yet — they're added when you save a race.</td></tr>`}</tbody>
      </table></div>
      ${edit ? `<div class="add-driver"><input type="text" id="new-team" placeholder="Add a team" maxlength="60"><button class="btn" id="add-team" type="button">Add</button></div>` : ''}
      ${errors.length ? `<div class="notice error">${errors.map(esc).join('<br>')}</div>` : ''}
      ${message ? `<div class="notice">${message}</div>` : ''}
    </section>
    ${edit ? saveBar(state.teamSave) : ''}`;
  if (!edit) return;
  bindPhotoPickers((msg) => renderTeams(msg));
  bindTeams();
}

function rosterEditor(t, i) {
  const onRoster = new Set(t.members.map((m) => driverId(m.driver)));
  // Rosters only take drivers from the Drivers page, so names can't drift apart.
  const available = state.registry.filter((d) => !onRoster.has(driverId(d.name)));
  const history = teamHistory(t.name).filter((d) => !onRoster.has(driverId(d)) && isSavedDriver(d));
  const roleSelect = (attrs, value) => `<select ${attrs}>${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${r.label}</option>`).join('')}</select>`;
  return `<div class="roster-editor">
    <p class="muted">Owner and core drivers are tied to ${esc(t.name)} and can't be owner/core of another team. Rotating drivers can be on other rosters too.</p>
    ${t.members.map((m, mi) => `<div class="roster-member">
      <span class="driver-cell">${personAvatar(m.driver, 24, driverRing(m.driver))}<b>${esc(m.driver)}</b>
        ${isSavedDriver(m.driver) ? '' : `<span class="pill warn" title="Rosters should only use drivers from the Drivers page">not on Drivers page</span>
        <button class="btn small" type="button" data-member-register="${esc(m.driver)}">Add to Drivers</button>`}</span>
      ${roleSelect(`data-member-role="${i}:${mi}" aria-label="Role for ${esc(m.driver)}"`, m.role)}
      <button class="btn small" type="button" data-member-remove="${i}:${mi}" aria-label="Remove ${esc(m.driver)} from roster">✕</button>
    </div>`).join('')}
    ${available.length ? `<div class="roster-add">
      <select id="member-name-${i}" aria-label="Driver to add">
        <option value="">Choose a driver…</option>
        ${available.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}
      </select>
      ${roleSelect(`id="member-role-${i}" aria-label="Role"`, 'core')}
      <button class="btn small" type="button" data-member-add="${i}">Add to roster</button>
    </div>` : `<p class="muted">${state.registry.length
      ? 'Everyone on the <a href="/drivers">Drivers page</a> is already on this roster.'
      : 'Add drivers on the <a href="/drivers">Drivers page</a> first, then pick them here.'}</p>`}
    ${history.length ? `<div class="suggest">Raced for ${esc(t.name)}: ${history.map((d) => `<button class="btn small" type="button" data-member-quick="${i}" data-driver="${esc(d)}">+ ${esc(d)}</button>`).join('')}</div>` : ''}
  </div>`;
}

function bindTeams() {
  const draft = state.teamDraft;
  const changed = (message) => { renderTeams(message); state.saveTeams(); };
  const ij = (v) => v.split(':').map(Number);
  const addMember = (i, name, role) => {
    name = name.trim();
    if (!name) return renderTeams('Choose a driver to add.');
    const t = draft[i];
    if (!isSavedDriver(name)) return renderTeams(`${esc(name)} isn't on the Drivers page yet.`);
    if (t.members.some((m) => driverId(m.driver) === driverId(name))) return renderTeams(`${esc(name)} is already on ${esc(t.name)}.`);
    const known = state.registry.find((d) => driverId(d.name) === driverId(name));
    t.members.push({ driver: known ? known.name : name, role });
    changed();
  };
  app.querySelectorAll('[data-team-color]').forEach((el) => el.addEventListener('change', () => { draft[+el.dataset.teamColor].color = el.value; changed(); }));
  app.querySelectorAll('[data-team-open]').forEach((el) => el.addEventListener('click', () => {
    state.openTeam = state.openTeam === +el.dataset.teamOpen ? null : +el.dataset.teamOpen;
    renderTeams();
  }));
  app.querySelectorAll('[data-team-remove]').forEach((el) => el.addEventListener('click', () => {
    const t = draft[+el.dataset.teamRemove];
    if (!confirm(`Remove ${t.name} from the team list? Races keep their laps; the team just loses its saved color, photo link and roster.`)) return;
    draft.splice(+el.dataset.teamRemove, 1);
    state.openTeam = null;
    changed();
  }));
  app.querySelectorAll('[data-member-role]').forEach((el) => el.addEventListener('change', () => {
    const [i, mi] = ij(el.dataset.memberRole);
    draft[i].members[mi].role = el.value;
    changed();
  }));
  app.querySelectorAll('[data-member-remove]').forEach((el) => el.addEventListener('click', () => {
    const [i, mi] = ij(el.dataset.memberRemove);
    draft[i].members.splice(mi, 1);
    changed();
  }));
  app.querySelectorAll('[data-member-add]').forEach((el) => {
    const i = +el.dataset.memberAdd;
    const add = () => addMember(i, document.getElementById(`member-name-${i}`).value, document.getElementById(`member-role-${i}`).value);
    el.addEventListener('click', add);
  });
  // Fix up roster names that aren't on the Drivers page (e.g. typed in before rosters used a dropdown).
  app.querySelectorAll('[data-member-register]').forEach((el) => el.addEventListener('click', async () => {
    const name = el.dataset.memberRegister;
    try {
      state.registry = (await api('drivers', { method: 'PUT', auth: true, body: JSON.stringify({ drivers: [...state.registry, { name, color: '' }] }) })).drivers;
      renderTeams(`${esc(name)} added to the Drivers page.`);
    } catch (e) {
      renderTeams(`Couldn't add ${esc(name)}: ${esc(e.message)}`);
    }
  }));
  app.querySelectorAll('[data-member-quick]').forEach((el) => el.addEventListener('click', () => addMember(+el.dataset.memberQuick, el.dataset.driver, 'rotating')));
  const addTeam = () => {
    const name = document.getElementById('new-team').value.trim();
    if (!name) return;
    if (draft.some((t) => driverId(t.name) === driverId(name))) return renderTeams(`${esc(name)} is already on the list.`);
    draft.push({ name, color: '', members: [] });
    state.openTeam = draft.length - 1;
    changed();
  };
  document.getElementById('add-team').addEventListener('click', addTeam);
  document.getElementById('new-team').addEventListener('keydown', (e) => e.key === 'Enter' && addTeam());
  // Entering the token retries a save that was waiting for it.
  document.getElementById('token').addEventListener('change', (e) => { token.set(e.target.value.trim()); if (state.teamSave?.kind === 'error') state.saveTeams(); });
}
