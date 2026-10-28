import { driverId, normalizeTeams } from '../lib/race.js';
import { teamShades, isHex, DEFAULT_TEAM_COLORS } from '../lib/color.js';
import { api, state } from './core.js';

/** Driver swatch: split team/driver color when the driver has their own color, otherwise the team color. */
export const swatch = (d, style = '') => `<span class="swatch" style="background:${d.ownColor ? `linear-gradient(135deg, ${d.teamColor} 50%, ${d.color} 50%)` : d.color};${style}"></span>`;
/** Team color: the saved team's color, then the kart's own (older races), then a palette slot. */
export const teamColor = (kart, i) => {
  const saved = kart.team && savedTeam(kart.team)?.color;
  if (isHex(saved)) return saved;
  return isHex(kart.color) ? kart.color : DEFAULT_TEAM_COLORS[i % DEFAULT_TEAM_COLORS.length];
};
export const teamLabel = (k) => k.team || `Kart #${k.number}`;

export const ownColors = () => new Map(state.registry.filter((d) => isHex(d.color)).map((d) => [driverId(d.name), d.color]));
export async function loadRegistry() {
  const [drivers, teams, images] = await Promise.all([
    api('drivers').catch(() => ({ drivers: [] })),
    api('teams').catch(() => ({ teams: [] })),
    api('images').catch(() => null),
  ]);
  state.registry = drivers.drivers;
  state.teams = normalizeTeams(teams.teams);
  if (images) state.images = images;
}
export const savedTeam = (name) => state.teams.find((t) => driverId(t.name) === driverId(name));


/**
 * Drivers with a personal color (from the saved driver list) use it, nudged into each theme's readable band;
 * everyone else uses exactly their team's color, so teammates match. Written as CSS variables so the theme toggle just works.
 */
export function applyTeamColors(race, drivers) {
  const vars = { light: [], dark: [] };
  const own = ownColors();
  race.karts.forEach((k, ki) => {
    const mine = drivers.filter((d) => d.kart === k.number);
    for (const mode of ['light', 'dark']) {
      const team = teamShades(teamColor(k, ki), 1, mode)[0];
      vars[mode].push(`--t-${ki}:${team}`);
      mine.forEach((d) => {
        const mineColor = own.get(driverId(d.driver));
        vars[mode].push(`--d-${drivers.indexOf(d)}:${mineColor ? teamShades(mineColor, 1, mode)[0] : team}`);
      });
    }
    mine.forEach((d) => {
      d.teamColor = `var(--t-${ki})`;
      d.ownColor = own.has(driverId(d.driver));
    });
  });
  drivers.forEach((d, i) => (d.color = `var(--d-${i})`));
  let el = document.getElementById('team-colors');
  if (!el) { el = document.createElement('style'); el.id = 'team-colors'; document.head.append(el); }
  const dark = vars.dark.join(';');
  el.textContent = `:root{${vars.light.join(';')}}
    @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}
    :root[data-theme="dark"]{${dark}}`;
}

export const driverRing = (name) => state.registry.find((d) => driverId(d.name) === driverId(name))?.color || 'var(--border)';

export const isSavedDriver = (name) => state.registry.some((d) => driverId(d.name) === driverId(name));
