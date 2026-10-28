import { api, state } from './js/core.js';
import { route } from './js/router.js';

(() => {
  const btn = document.getElementById('theme-toggle');
  let saved = null;
  try { saved = localStorage.getItem('kh_theme'); } catch {}
  if (saved) document.documentElement.dataset.theme = saved;
  btn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('kh_theme', next); } catch {}
  });
})();

api('config').then((c) => (state.config = c)).catch(() => {}).finally(route);
