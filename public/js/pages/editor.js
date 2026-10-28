import { parseRaceMonitor, mergeLaps, missingLaps, pitCandidates, slugify, driverId, ROLES, normalizeTeams, DEFAULT_SLOW_FACTOR } from '../../lib/race.js';
import { isHex } from '../../lib/color.js';
import { api, app, esc, state, token } from '../core.js';
import { bindPhotoPickers, photoPicker } from '../photos.js';
import { colorChanges, refreshPreviews, uploadPreview } from '../preview.js';
import { isSavedDriver, loadLists, savedTeam, swatch, teamColor } from '../registry.js';
import { navigate } from '../router.js';

export async function showEditor(id) {
  if (!state.config.editable) {
    app.innerHTML = '<div class="card"><h2>Editing is disabled</h2><p class="muted">Set the <code>ADMIN_TOKEN</code> environment variable on the server to enable uploads.</p><a href="/">Back</a></div>';
    return;
  }
  state.edit = id ? await api(`races/${encodeURIComponent(id)}`) : {
    id: '', name: '', track: '', date: new Date().toISOString().slice(0, 10), slowFactor: DEFAULT_SLOW_FACTOR, karts: [],
  };
  state.isNew = !id;
  state.pending = [];
  await loadLists();
  state.colorDraft = new Map(state.drivers.map((d) => [driverId(d.name), d.color || '']));
  state.teamColorDraft = new Map(state.teams.map((t) => [driverId(t.name), t.color || '']));
  document.title = `${id ? 'Edit' : 'New'} race · Karting Hub`;
  renderEditor();
}

function renderEditor(message) {
  const r = state.edit;
  app.innerHTML = `
    <div class="page-head">
      <div><div><a href="${state.isNew ? '/' : `/r/${encodeURIComponent(r.id)}`}">← Back</a></div>
        <h1 style="margin-top:6px">${state.isNew ? 'New race' : 'Edit race'}</h1></div>
      ${state.isNew ? '' : '<div class="actions"><button class="btn danger" id="delete" type="button">Delete race</button></div>'}
    </div>

    <section class="card section">
      <div class="form-grid">
        <label class="field">Race name<input type="text" data-field="name" value="${esc(r.name)}" placeholder="Saturday 2-Hour Enduro"></label>
        <label class="field">Track<input type="text" data-field="track" value="${esc(r.track)}" placeholder="Track name"></label>
        <label class="field">Date<input type="date" data-field="date" value="${esc(r.date)}"></label>
        <label class="field">Slow-lap threshold (% over driver median)
          <input type="number" min="1" max="50" step="1" data-field="slowPct" value="${Math.round(((r.slowFactor || DEFAULT_SLOW_FACTOR) - 1) * 100)}"></label>
      </div>
    </section>

    <section class="card section">
      <div class="section-head"><h2>Upload Race Monitor files</h2><p>Drop every .txt export — split sessions for the same kart get merged by lap number.</p></div>
      <label class="dropzone" id="drop">
        <input type="file" id="files" accept=".txt,text/plain" multiple hidden>
        <strong>Choose files</strong> or drag them here
      </label>
      ${state.pending.length ? `
        <div class="table-wrap" style="margin-top:12px"><table>
          <thead><tr><th>File</th><th>Header</th><th class="num">Laps</th><th class="hide-sm">Session</th><th style="width:110px">Kart #</th></tr></thead>
          <tbody>${state.pending.map((p, i) => `<tr>
            <td>${esc(p.filename)}</td>
            <td class="secondary">#${esc(p.headerNumber)} ${esc(p.headerName)}${p.headerNumber && p.headerNumber !== p.kart ? ' <span class="pill" title="Header kart number differs from the file name">differs</span>' : ''}</td>
            <td class="num">${p.laps.length ? `${p.laps.length} (${p.laps[0].lap}–${p.laps[p.laps.length - 1].lap})` : '0'}</td>
            <td class="hide-sm muted">${esc(p.session || '')}</td>
            <td><input type="text" data-pending="${i}" value="${esc(p.kart)}"></td></tr>`).join('')}</tbody></table></div>
        <div class="actions" style="margin-top:10px"><button class="btn primary" id="add-files" type="button">Add to race</button>
          <button class="btn" id="clear-files" type="button">Discard</button></div>` : ''}
      ${message ? `<div class="notice">${message}</div>` : ''}
    </section>

    ${r.karts.map((k, ki) => kartEditor(k, ki)).join('')}

    <div class="sticky-save">
      <span id="save-msg" class="muted"></span>
      <input type="password" id="token" placeholder="Admin token" value="${esc(token.get())}" style="max-width:180px">
      <button class="btn primary" id="save" type="button">Save race</button>
    </div>`;
  bindEditor();
}

function kartEditor(k, ki) {
  const miss = missingLaps(k.laps);
  const pits = pitCandidates(k.laps);
  const last = k.laps.length ? k.laps[k.laps.length - 1].lap : 0;
  const stints = k.stints.length ? k.stints : [{ driver: '', toLap: null }];
  let from = 1;
  return `<section class="card section kart-card">
    <div class="kart-head">
      <h3><span class="swatch" style="background:${esc(editorTeamColor(k, ki))};width:14px;height:14px;margin-right:8px"></span>${esc(k.team || 'Kart')} #${esc(k.number)}</h3>
      <div class="actions">
        <button class="btn small" type="button" data-act="clear-laps" data-k="${ki}">Clear laps</button>
        <button class="btn small danger" type="button" data-act="remove-kart" data-k="${ki}">Remove kart</button>
      </div>
    </div>
    <div class="form-grid" style="margin-bottom:8px">
      <label class="field">Team${teamSelect(k, ki)}</label>
      <label class="field">Team color<input type="color" data-k="${ki}" data-kfield="color" value="${esc(editorTeamColor(k, ki))}"
        title="${k.team ? 'Saved to the team, so it applies in every race' : 'Pick a team to reuse this color'}"></label>
      <div class="field">Team photo${photoPicker('teams', k.team, editorTeamColor(k, ki))}</div>
    </div>
    <div class="secondary" style="font-size:13px">${k.laps.length} laps recorded${k.laps.length ? ` (1–${last})` : ''}${miss.length ? ` · missing ${miss.join(', ')}` : ''}</div>
    ${pits.length ? `<div class="suggest">Likely pit / driver-change laps: ${pits.map((p) => `<button class="btn small" type="button" data-act="split" data-k="${ki}" data-lap="${p}" title="Add a driver change after lap ${p}">${p}</button>`).join('')}</div>` : ''}
    <h4 style="margin:12px 0 6px;font-size:14px">Drivers, in order</h4>
    ${rosterHint(k, ki)}
    ${stints.map((s, si) => {
      const to = s.toLap ?? last;
      const color = state.colorDraft.get(driverId(s.driver)) || '';
      const row = `<div class="stint-row">
        ${driverSelect(k, ki, s, si)}
        <span class="driver-color ${color ? '' : 'unset'}">
          <input type="color" title="${color ? 'Personal color (used in every race)' : 'Pick a personal color (optional)'}" aria-label="Personal color for ${esc(s.driver || 'driver')}" data-dcolor="${esc(s.driver)}" value="${color || '#8e8d86'}" ${s.driver.trim() ? '' : 'disabled'}>
          ${color ? `<button class="btn small clear-color" type="button" data-clear-color="${esc(s.driver)}" aria-label="Remove personal color" title="Remove personal color">✕</button>` : ''}
        </span>
        <input type="number" min="1" placeholder="to finish" title="Last lap this driver drove (blank = to the finish)" data-k="${ki}" data-s="${si}" data-sfield="toLap" value="${s.toLap ?? ''}">
        <span class="range">laps ${from}–${to || '?'}</span>
        <button class="btn small" type="button" data-act="remove-stint" data-k="${ki}" data-s="${si}" aria-label="Remove driver">✕</button>
      </div>`;
      from = (s.toLap ?? last) + 1;
      return row;
    }).join('')}
    <button class="btn small" type="button" data-act="add-stint" data-k="${ki}">+ Add driver</button>
  </section>`;
}

const NEW = '__new__';

// Saved teams only. A name from an older race that isn't saved stays selectable.
function teamSelect(k, ki) {
  const legacy = k.team && !savedTeam(k.team);
  return `<select data-kteam="${ki}" aria-label="Team for kart ${esc(k.number)}">
    <option value="" ${k.team ? '' : 'selected'}>No team</option>
    ${state.teams.map((t) => `<option value="${esc(t.name)}" ${driverId(t.name) === driverId(k.team) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
    ${legacy ? `<option value="${esc(k.team)}" selected>${esc(k.team)} (not on Teams page)</option>` : ''}
    <option value="${NEW}">+ New team…</option>
  </select>`;
}

function driverSelect(k, ki, s, si) {
  const team = k.team ? savedTeam(k.team) : null;
  const roster = new Set((team?.members || []).map((m) => driverId(m.driver)));
  const opt = (name) => `<option value="${esc(name)}" ${driverId(name) === driverId(s.driver) ? 'selected' : ''}>${esc(name)}</option>`;
  const inRoster = state.drivers.filter((d) => roster.has(driverId(d.name)));
  const others = state.drivers.filter((d) => !roster.has(driverId(d.name)));
  const legacy = s.driver.trim() && !isSavedDriver(s.driver);
  return `<select data-sdriver="${ki}:${si}" aria-label="Driver ${si + 1} for kart ${esc(k.number)}">
    <option value="" ${s.driver.trim() ? '' : 'selected'}>Choose a driver…</option>
    ${inRoster.length ? `<optgroup label="${esc(team.name)} roster">${inRoster.map((d) => opt(d.name)).join('')}</optgroup>
      <optgroup label="Other drivers">${others.map((d) => opt(d.name)).join('')}</optgroup>` : others.map((d) => opt(d.name)).join('')}
    ${legacy ? `<option value="${esc(s.driver)}" selected>${esc(s.driver)} (not on Drivers page)</option>` : ''}
    <option value="${NEW}">+ New driver…</option>
  </select>`;
}

// Create a driver or team without leaving the half-edited race.
async function quickAdd(kind, name) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) return null;
  if (kind === 'drivers') {
    const found = state.drivers.find((d) => driverId(d.name) === driverId(name));
    if (found) return found.name;
    state.drivers = (await api('drivers', { method: 'PUT', auth: true, body: JSON.stringify({ drivers: [...state.drivers, { name, color: '' }] }) })).drivers;
    state.colorDraft.set(driverId(name), '');
  } else {
    const found = savedTeam(name);
    if (found) return found.name;
    state.teams = normalizeTeams((await api('teams', { method: 'PUT', auth: true, body: JSON.stringify({ teams: [...state.teams, { name, color: '', members: [] }] }) })).teams);
  }
  return name;
}

function editorTeamColor(k, ki) {
  const draft = k.team && state.teamColorDraft.get(driverId(k.team));
  return isHex(draft) ? draft : teamColor(k, ki);
}

function rosterHint(k, ki) {
  // '' is not a team
  const team = k.team ? savedTeam(k.team) : null;
  if (!team?.members?.length) return '';
  const have = new Set(k.stints.map((s) => driverId(s.driver)));
  const missing = team.members.filter((m) => !have.has(driverId(m.driver)));
  if (!missing.length) return '';
  return `<div class="suggest">${esc(team.name)} roster: ${missing.map((m) => `<button class="btn small" type="button" data-act="add-member" data-k="${ki}" data-driver="${esc(m.driver)}" title="${ROLES[m.role].label}">+ ${esc(m.driver)}</button>`).join('')}</div>`;
}

function sortStints(k) {
  k.stints.sort((a, b) => (a.toLap ?? Infinity) - (b.toLap ?? Infinity));
}

async function readFiles(fileList) {
  for (const f of fileList) state.pending.push(parseRaceMonitor(await f.text(), f.name));
  renderEditor();
}

function bindEditor() {
  const r = state.edit;
  app.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('input', () => {
    if (el.dataset.field === 'slowPct') r.slowFactor = 1 + Math.max(1, +el.value || 10) / 100;
    else r[el.dataset.field] = el.value;
  }));
  app.querySelectorAll('[data-pending]').forEach((el) => el.addEventListener('input', () => (state.pending[+el.dataset.pending].kart = el.value.trim())));
  app.querySelectorAll('[data-kfield]').forEach((el) => {
    el.addEventListener('input', () => {
      const k = r.karts[+el.dataset.k];
      // named team: color is saved on the team; unnamed kart: on the kart
      if (el.dataset.kfield === 'color' && k.team.trim()) state.teamColorDraft.set(driverId(k.team), el.value);
      else k[el.dataset.kfield] = el.value;
    });
  });
  const tokenField = () => document.getElementById('token');
  app.querySelectorAll('[data-kteam]').forEach((el) => el.addEventListener('change', async () => {
    const k = r.karts[+el.dataset.kteam];
    if (el.value !== NEW) { k.team = el.value; return renderEditor(); }
    const name = prompt('New team name');
    if (!name?.trim()) return renderEditor();
    token.set(tokenField().value.trim());
    try { k.team = await quickAdd('teams', name); renderEditor(`${esc(k.team)} added to the Teams page.`); }
    catch (e) { renderEditor(`Couldn't add the team: ${esc(e.message)} (enter your admin token at the bottom first).`); }
  }));
  app.querySelectorAll('[data-sdriver]').forEach((el) => el.addEventListener('change', async () => {
    const [ki, si] = el.dataset.sdriver.split(':').map(Number);
    const k = r.karts[ki];
    if (!k.stints.length) k.stints.push({ driver: '', toLap: null });
    const st = k.stints[si];
    if (el.value !== NEW) { st.driver = el.value; return renderEditor(); }
    const name = prompt('New driver name');
    if (!name?.trim()) return renderEditor();
    token.set(tokenField().value.trim());
    try { st.driver = await quickAdd('drivers', name); renderEditor(`${esc(st.driver)} added to the Drivers page.`); }
    catch (e) { renderEditor(`Couldn't add the driver: ${esc(e.message)} (enter your admin token at the bottom first).`); }
  }));
  bindPhotoPickers((msg) => renderEditor(msg));
  app.querySelectorAll('[data-sfield]').forEach((el) => {
    const update = () => {
      const k = r.karts[+el.dataset.k];
      if (!k.stints.length) k.stints.push({ driver: '', toLap: null });
      const s = k.stints[+el.dataset.s];
      s[el.dataset.sfield] = el.dataset.sfield === 'toLap' ? (el.value === '' ? null : +el.value) : el.value;
    };
    el.addEventListener('input', update);
    if (el.dataset.sfield === 'toLap') el.addEventListener('change', () => { sortStints(r.karts[+el.dataset.k]); renderEditor(); });
  });
  app.querySelectorAll('[data-dcolor]').forEach((el) => el.addEventListener('change', () => {
    state.colorDraft.set(driverId(el.dataset.dcolor), el.value);
    renderEditor();
  }));
  app.querySelectorAll('[data-clear-color]').forEach((el) => el.addEventListener('click', () => {
    state.colorDraft.set(driverId(el.dataset.clearColor), '');
    renderEditor();
  }));

  const input = document.getElementById('files');
  const drop = document.getElementById('drop');
  input.addEventListener('change', () => readFiles(input.files));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles(e.dataTransfer.files); });

  document.getElementById('add-files')?.addEventListener('click', () => {
    const notes = [];
    for (const p of state.pending) {
      if (!p.kart) { notes.push(`${esc(p.filename)}: no kart number, skipped`); continue; }
      let k = r.karts.find((k) => k.number === p.kart);
      if (!k) { k = { number: p.kart, team: '', laps: [], stints: [] }; r.karts.push(k); }
      const { laps, duplicates } = mergeLaps(k.laps, p.laps, p.session);
      k.laps = laps;
      notes.push(`${esc(p.filename)} → kart #${esc(p.kart)}: ${p.laps.length - duplicates.length} laps added${duplicates.length ? `, ${duplicates.length} duplicate lap numbers ignored` : ''}`);
    }
    r.karts.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    state.pending = [];
    renderEditor(notes.join('<br>'));
  });
  document.getElementById('clear-files')?.addEventListener('click', () => { state.pending = []; renderEditor(); });

  app.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', () => {
    const k = r.karts[+el.dataset.k];
    const act = el.dataset.act;
    if (act === 'remove-kart' && confirm(`Remove kart #${k.number} and its laps?`)) r.karts.splice(+el.dataset.k, 1);
    if (act === 'clear-laps' && confirm(`Clear all laps for kart #${k.number}?`)) k.laps = [];
    if (act === 'add-member') {
      const empty = k.stints.find((s) => !s.driver.trim());
      if (empty) empty.driver = el.dataset.driver;
      else {
        const open = k.stints.find((s) => s.toLap == null);
        if (open) open.toLap = k.laps.length ? k.laps[k.laps.length - 1].lap : 1;
        k.stints.push({ driver: el.dataset.driver, toLap: null });
      }
    }
    if (act === 'add-stint') {
      if (!k.stints.length) k.stints.push({ driver: '', toLap: null });
      const open = k.stints.find((s) => s.toLap == null);
      if (open) open.toLap = k.laps.length ? k.laps[k.laps.length - 1].lap : 1;
      k.stints.push({ driver: '', toLap: null });
    }
    if (act === 'remove-stint') {
      k.stints.splice(+el.dataset.s, 1);
      if (k.stints.length && !k.stints.some((s) => s.toLap == null)) k.stints[k.stints.length - 1].toLap = null;
    }
    if (act === 'split') {
      const lap = +el.dataset.lap;
      if (!k.stints.length) k.stints.push({ driver: '', toLap: null });
      if (!k.stints.some((s) => s.toLap === lap)) {
        // the current stint ends at this lap; a new, unnamed driver takes over
        sortStints(k);
        const idx = k.stints.findIndex((s) => (s.toLap ?? Infinity) > lap);
        const cur = k.stints[idx];
        k.stints.splice(idx, 0, { driver: cur.driver, toLap: lap });
        cur.driver = '';
      }
    }
    sortStints(k);
    renderEditor();
  }));

  document.getElementById('token').addEventListener('change', (e) => token.set(e.target.value.trim()));
  document.getElementById('save').addEventListener('click', saveRace);
  document.getElementById('delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${r.name}" permanently?`)) return;
    token.set(document.getElementById('token').value.trim());
    try { await api(`races/${encodeURIComponent(r.id)}`, { method: 'DELETE', auth: true }); navigate('/'); }
    catch (e) { document.getElementById('save-msg').textContent = e.message; }
  });
}

async function saveRace() {
  const r = state.edit;
  const msg = document.getElementById('save-msg');
  token.set(document.getElementById('token').value.trim());
  if (!r.name.trim()) { msg.textContent = 'Give the race a name first.'; return; }
  if (state.isNew) r.id = slugify(`${r.date} ${r.name}`);
  for (const k of r.karts) k.stints = k.stints.filter((s, i, all) => s.driver.trim() || s.toLap != null || all.length === 1);
  msg.textContent = 'Saving…';
  try {
    if (state.isNew) {
      const exists = await api(`races/${encodeURIComponent(r.id)}`).then(() => true, () => false);
      if (exists && !confirm(`A race with id "${r.id}" already exists. Overwrite it?`)) { msg.textContent = ''; return; }
    }
    await api(`races/${encodeURIComponent(r.id)}`, { method: 'PUT', auth: true, body: JSON.stringify(r) });
    await saveRegistryFromRace(r);
    await uploadPreview(r).catch(() => {}); // a failed preview shouldn't block saving the race
    navigate(`/r/${encodeURIComponent(r.id)}`);
  } catch (e) {
    msg.textContent = e.message;
    msg.className = 'notice error';
  }
}

async function saveRegistryFromRace(r) {
  const list = new Map(state.drivers.map((d) => [driverId(d.name), { ...d }]));
  for (const k of r.karts) for (const s of k.stints) {
    const name = s.driver.trim();
    if (name && !list.has(driverId(name))) list.set(driverId(name), { name, color: '' });
  }
  for (const [id, color] of state.colorDraft) if (list.has(id)) list.get(id).color = color;
  const next = [...list.values()];
  refreshPreviews({ drivers: colorChanges(state.drivers, next) });
  if (JSON.stringify(next) !== JSON.stringify(state.drivers)) {
    state.drivers = (await api('drivers', { method: 'PUT', auth: true, body: JSON.stringify({ drivers: next }) })).drivers;
  }
  const teams = new Map(state.teams.map((t) => [driverId(t.name), { ...t, members: [...t.members] }]));
  for (const k of r.karts) {
    const name = k.team.trim();
    if (name && !teams.has(driverId(name))) teams.set(driverId(name), { name, color: isHex(k.color) ? k.color : '', members: [] });
  }
  for (const [id, color] of state.teamColorDraft) if (teams.has(id) && color) teams.get(id).color = color;
  const nextTeams = [...teams.values()];
  refreshPreviews({ teams: colorChanges(state.teams, nextTeams) });
  if (JSON.stringify(nextTeams) !== JSON.stringify(state.teams)) {
    state.teams = normalizeTeams((await api('teams', { method: 'PUT', auth: true, body: JSON.stringify({ teams: nextTeams }) })).teams);
  }
}
