import { app, esc } from './core.js';
import { showDrivers } from './pages/drivers.js';
import { showEditor } from './pages/editor.js';
import { showHome } from './pages/home.js';
import { showRace } from './pages/race.js';
import { showTeams } from './pages/teams.js';

// Real paths (/r/<race>) rather than #/ links, so the server sees the race and can serve link previews.
export function navigate(path, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  route();
}

export async function route() {
  // Old #/ links still work: move them to the matching path.
  if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1) || '/');
  const parts = location.pathname.replace(/^\/+/, '').split('/').filter(Boolean).map(decodeURIComponent);
  window.onresize = null;
  app.onclick = null;
  try {
    if (parts[0] === 'r' && parts[1]) return await showRace(parts[1], parts[2], parts[3]);
    if (parts[0] === 'edit' && parts[1]) return await showEditor(parts[1]);
    if (parts[0] === 'new') return await showEditor(null);
    if (parts[0] === 'drivers') return await showDrivers();
    if (parts[0] === 'teams') return await showTeams();
    return await showHome();
  } catch (e) {
    app.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p><a href="/">Back to races</a></div>`;
  }
}
window.addEventListener('popstate', route);
// In-app links navigate without a full page load.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || a.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
  window.scrollTo(0, 0);
});
