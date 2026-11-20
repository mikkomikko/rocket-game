import { P } from '../config.js';
import { solidAt } from '../level/mask.js';

/* ------------------------------------------------------------------ *
 * Ships: plain state only. The client keeps each ship's meshes and camera in its own view.
 * ------------------------------------------------------------------ */
// Hull sample points in ship-local units (nose points along +y). Collision samples these.
export const HULL = [[0, 12], [8, -8], [-8, -8], [4.5, 2], [-4.5, 2], [0, -4.5]];
export const SHIP_RADIUS = 10;

function makeShip(id) {
  return {
    id,
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, a: 0, pa: 0, av: 0, thrust: 0,
    hp: 100, ammo: P.ammoMax, landed: false, onPad: false, alive: true,
    respawnT: 0, invulnT: 0, fireCd: 0, score: 0, deathX: 0, deathY: 0, active: true, lastImpact: 0,
    weapon: 0, frozenT: 0, crossT: 0, ballT: 0,
    input: { turn: 0, thrust: 0, fire: false },
  };
}
export const ships = [makeShip(0), makeShip(1)];

const HW = HULL.map(() => [0, 0]);
export function hullWorld(s, dx = 0, dy = 0) {
  const c = Math.cos(s.a), sn = Math.sin(s.a), k = P.shipSize;
  for (let i = 0; i < HULL.length; i++) {
    const lx = HULL[i][0] * k, ly = HULL[i][1] * k;
    HW[i][0] = s.x + dx + lx * c - ly * sn;
    HW[i][1] = s.y + dy + lx * sn + ly * c;
  }
  return HW;
}
export function hullSolid(s, dx = 0, dy = 0) {
  const pts = hullWorld(s, dx, dy);
  for (const p of pts) if (solidAt(p[0], p[1])) return true;
  return false;
}
export function localToWorld(s, lx, ly) {
  const c = Math.cos(s.a), sn = Math.sin(s.a), k = P.shipSize;
  return { x: s.x + (lx * c - ly * sn) * k, y: s.y + (lx * sn + ly * c) * k };
}
