import { api, esc, token } from './core.js';

// Saves after every change, one request at a time; edits made mid-save go out in the next request.
export function autosaver({ path, body, validate = () => [], onSaved, status }) {
  let inFlight = null, pending = false;
  const run = async () => {
    const problems = validate();
    if (problems.length) return status('error', 'Not saved: fix the problem above.');
    if (!token.get()) return status('error', 'Enter your admin token to save changes.');
    status('saving', 'Saving…');
    try {
      onSaved(await api(path, { method: 'PUT', auth: true, body: JSON.stringify(body()) }));
      status('saved', 'All changes saved');
    } catch (e) {
      status('error', `Not saved: ${e.message}`);
    }
  };
  return function save() {
    if (inFlight) { pending = true; return inFlight; }
    inFlight = run().finally(() => {
      inFlight = null;
      if (pending) { pending = false; save(); }
    });
    return inFlight;
  };
}

export function saveBar(st) {
  return `<div class="sticky-save"><span id="save-msg" class="save-status ${st?.kind || ''}">${esc(st?.text || 'Changes save automatically')}</span>
    <input type="password" id="token" class="token" placeholder="Admin token" value="${esc(token.get())}"></div>`;
}
export function showSaveStatus(kind, text) {
  const el = document.getElementById('save-msg');
  if (el) { el.textContent = text; el.className = `save-status ${kind}`; }
}
