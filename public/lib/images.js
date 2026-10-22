// Profile pictures for drivers and teams. Shared by the browser (resizing, URLs) and the server (validation).
import { slugify } from './race.js';

export const IMAGE_KINDS = ['drivers', 'teams'];
/** Output size of the square crop. 256px covers 2x displays at the largest size we show (~96px). */
export const IMAGE_SIZE = 256;
/** Upload ceiling. A 256x256 WebP/JPEG is ~10-40 KB, so this only stops raw photos that skipped resizing. */
export const MAX_IMAGE_BYTES = 1024 * 1024;

/** Image file name for a driver or team name: "Team Apex" -> "team-apex". */
export function imageId(name) {
  return slugify(String(name ?? '').trim());
}

/** Content type from the file's magic bytes, or null if it isn't a WebP, JPEG or PNG. */
export function imageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ascii = (from, to) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  return null;
}
