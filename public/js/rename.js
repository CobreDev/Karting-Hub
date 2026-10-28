import { app, esc } from './core.js';

// A name that turns into a text field when clicked. Enter or leaving the field saves, Escape cancels.
export const nameButton = (name, i) => `<button class="name-edit" type="button" data-rename="${i}" title="Click to rename">${esc(name)}</button>`;

// onRename(index, newName) gets null for newName when nothing changed; it should re-render either way.
export function bindNameEdits(onRename) {
  app.querySelectorAll('[data-rename]').forEach((btn) => btn.addEventListener('click', () => {
    const from = btn.textContent;
    const input = Object.assign(document.createElement('input'), { type: 'text', value: from, maxLength: 60, className: 'name-input' });
    input.setAttribute('aria-label', `New name for ${from}`);
    btn.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      input.disabled = true;
      const to = input.value.trim();
      onRename(+btn.dataset.rename, save && to && to !== from ? to : null);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }));
}
