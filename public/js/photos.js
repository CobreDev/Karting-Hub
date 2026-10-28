import { imageId, IMAGE_SIZE } from '../lib/images.js';
import { api, app, esc, state, token } from './core.js';
import { refreshPreviews } from './preview.js';
import { teamColor } from './registry.js';

export const photoUrl = (kind, name) => {
  const id = imageId(name);
  const v = id && state.images[kind]?.[id];
  return v ? `/images/${kind}/${id}?v=${v}` : null;
};
export const avatar = (kind, name, size, ring, fallback = '') => {
  const url = photoUrl(kind, name);
  return url ? `<img class="avatar" src="${url}" alt="" width="${size}" height="${size}" loading="lazy" style="--ring:${ring}">` : fallback;
};
const driverRingOf = (d) => (d.ownColor ? `linear-gradient(135deg, ${d.teamColor} 50%, ${d.color} 50%)` : d.color);
const initialsBadge = (name, size, ring) => `<span class="avatar placeholder" style="--ring:${ring};width:${size}px;height:${size}px;font-size:${Math.max(8, Math.round(size * 0.38))}px">${initials(name)}</span>`;
export const personAvatar = (name, size, ring) => avatar('drivers', name, size, ring, initialsBadge(name, size, ring));
export const driverAvatar = (d, size = 22) => personAvatar(d.driver, size, driverRingOf(d));
export const initials = (name) => esc(String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());

// Square crop, scaled down in halves (sharper than one big step). WebP where supported, else JPEG.
async function resizeImage(file) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That file isn't an image this browser can read."));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const side = Math.min(w, h);
  let canvas = document.createElement('canvas');
  let cur = Math.max(IMAGE_SIZE, side);
  canvas.width = canvas.height = cur;
  let ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, cur, cur);
  while (cur / 2 >= IMAGE_SIZE) {
    const next = document.createElement('canvas');
    cur = Math.max(IMAGE_SIZE, Math.floor(cur / 2));
    next.width = next.height = cur;
    ctx = next.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, cur, cur);
    canvas = next;
  }
  if (cur !== IMAGE_SIZE) {
    const out = document.createElement('canvas');
    out.width = out.height = IMAGE_SIZE;
    ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
    canvas = out;
  }
  const encode = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode('image/webp');
  return webp && webp.type === 'image/webp' ? webp : encode('image/jpeg');
}

export function photoPicker(kind, name, ring) {
  return `<div class="photo-picker">
    ${avatar(kind, name, 48, ring, `<span class="avatar placeholder" style="--ring:${ring}">${initials(name)}</span>`)}
    ${photoButtons(kind, name)}
  </div>`;
}

export function photoButtons(kind, name) {
  const has = !!photoUrl(kind, name);
  const disabled = !String(name || '').trim();
  return `<label class="btn small ${disabled ? 'disabled' : ''}" title="${disabled ? 'Enter a name first' : 'Square crop, resized to 256 px'}">
      ${has ? 'Change photo' : 'Add photo'}
      <input type="file" accept="image/*" hidden data-photo-kind="${kind}" data-photo-name="${esc(name)}" ${disabled ? 'disabled' : ''}>
    </label>
    ${has ? `<button class="btn small" type="button" data-photo-remove="${kind}" data-photo-name="${esc(name)}">Remove photo</button>` : ''}`;
}

export function bindPhotoPickers(done) {
  const tokenField = document.getElementById('token');
  const auth = () => { if (tokenField) token.set(tokenField.value.trim()); };
  const call = async (kind, name, opts) => {
    const res = await fetch(`/api/images/${kind}/${encodeURIComponent(imageId(name))}`, {
      ...opts, headers: { Authorization: `Bearer ${token.get()}`, ...(opts.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  };
  app.querySelectorAll('[data-photo-kind]').forEach((el) => el.addEventListener('change', async () => {
    const file = el.files[0];
    if (!file) return;
    const { photoKind: kind, photoName: name } = el.dataset;
    auth();
    try {
      const blob = await resizeImage(file);
      const { version } = await call(kind, name, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } });
      state.images[kind][imageId(name)] = version;
      refreshPreviews({ [kind]: [name] });
      done(`Photo saved for ${esc(name)} (${Math.round(blob.size / 1024)} KB).`);
    } catch (e) {
      done(`Couldn't save the photo: ${esc(e.message)}`);
    }
  }));
  app.querySelectorAll('[data-photo-remove]').forEach((el) => el.addEventListener('click', async () => {
    const kind = el.dataset.photoRemove, name = el.dataset.photoName;
    auth();
    try {
      await call(kind, name, { method: 'DELETE' });
      delete state.images[kind][imageId(name)];
      refreshPreviews({ [kind]: [name] });
      done(`Photo removed for ${esc(name)}.`);
    } catch (e) {
      done(`Couldn't remove the photo: ${esc(e.message)}`);
    }
  }));
}
