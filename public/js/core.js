export const app = document.getElementById('app');
export const state = { config: { editable: false }, hidden: new Set(), edit: null, pending: [], registry: [], teams: [], images: { drivers: {}, teams: {} } };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const token = {
  get: () => { try { return localStorage.getItem('kh_token') || ''; } catch { return ''; } },
  set: (v) => { try { localStorage.setItem('kh_token', v); } catch {} },
};
export async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.auth ? { Authorization: `Bearer ${token.get()}` } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
export const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(`${d}T12:00:00`);
  return Number.isNaN(+dt) ? d : dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};
/** Race Monitor's clock format: 49250 -> "00:49.250" */
export const fmtClock = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
/** "Cooper Hull" -> "Cooper H." for narrow screens; single names stay as they are. */
export const shortName = (name) => {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};
