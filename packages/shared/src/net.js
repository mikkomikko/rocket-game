import { ships } from './ships/ship.js';
import { B, MAXB } from './bullets.js';

/* ------------------------------------------------------------------ *
 * The online protocol: JSON messages between the server and its browsers.
 *
 *   server → browser
 *     { t: 'welcome', id, P, carves }   your ship id (0 or 1), the match tuning, every crater so far
 *     { t: 'full' }                     both ships are taken
 *     { t: 'snap', ships, bullets, events }   about 30 times a second
 *   browser → server
 *     { t: 'input', turn, thrust, fire }
 *     { t: 'cycle' }                    switch weapon
 *
 * events is everything that happened since the last snap, in order: [type, ...args] for simulation
 * events (ships travel as { ship: id }), and ['carve', x, y, r] for craters.
 * ------------------------------------------------------------------ */
export const SNAP_EVERY = 4;   // simulation steps per snapshot (120 Hz / 4 = 30 a second)

const SHIP_FIELDS = ['x', 'y', 'vx', 'vy', 'a', 'av', 'thrust', 'hp', 'ammo', 'landed', 'onPad', 'alive', 'active',
  'respawnT', 'invulnT', 'score', 'deathX', 'deathY', 'lastImpact', 'weapon', 'frozenT', 'crossT', 'ballT', 'minigunT',
  'bigLaser', 'eaten', 'lava'];
const BEAM_FIELDS = ['phase', 't', 'len', 'ox', 'oy', 'ang'];
const pick = (o, fields) => fields.map((f) => o[f] ?? null);
const put = (o, fields, vals) => fields.forEach((f, i) => { o[f] = vals[i]; });

export function encodeShips() {
  return ships.map((s) => [pick(s, SHIP_FIELDS), s.beam ? pick(s.beam, BEAM_FIELDS) : null]);
}
export function applyShips(list) {
  list.forEach(([vals, beam], i) => {
    const s = ships[i];
    put(s, SHIP_FIELDS, vals);
    if (!beam) s.beam = null;
    else { if (!s.beam) s.beam = { hit: new Set() }; put(s.beam, BEAM_FIELDS, beam); }
  });
}

// Live bullets as flat rows: slot, x, y, vx, vy, kind, owner.
export function encodeBullets() {
  const out = [];
  for (let i = 0; i < MAXB; i++) if (B.on[i]) out.push(i, B.x[i], B.y[i], B.vx[i], B.vy[i], B.kind[i], B.owner[i]);
  return out;
}
// Copies the server's bullets in. A slot that was already flying keeps its trail; a new one starts one at time t.
export function applyBullets(rows, t) {
  const seen = new Uint8Array(MAXB);
  for (let k = 0; k < rows.length; k += 7) {
    const i = rows[k];
    seen[i] = 1;
    if (!B.on[i] || B.kind[i] !== rows[k + 5]) { B.tx[i] = rows[k + 1]; B.ty[i] = rows[k + 2]; B.tt[i] = t; }
    B.on[i] = 1; B.x[i] = rows[k + 1]; B.y[i] = rows[k + 2]; B.vx[i] = rows[k + 3]; B.vy[i] = rows[k + 4];
    B.kind[i] = rows[k + 5]; B.owner[i] = rows[k + 6]; B.life[i] = 1;
  }
  for (let i = 0; i < MAXB; i++) if (!seen[i]) B.on[i] = 0;
}

// Simulation event arguments: ships become { ship: id } on the wire and turn back into ships on arrival.
export const encodeArgs = (args) => args.map((a) => (ships.includes(a) ? { ship: a.id } : a));
export const decodeArgs = (args) => args.map((a) => (a && typeof a === 'object' && 'ship' in a ? ships[a.ship] : a));
