import { ships } from './ships/ship.js';
import { B, MAXB } from './bullets.js';
import { MAPS } from './level/terrain.js';
import { RULES } from './maps/index.js';

/* ------------------------------------------------------------------ *
 * The online protocol: JSON messages between the server and its browsers. A browser opens
 * ws(s)://server/?room=new&map=cave to start a room, or ?room=abc123 to join one (&token=… to take
 * back its seat after a dropped connection).
 *
 *   server → browser
 *     { t: 'welcome', id, P, carves, room, token, seats }
 *                                       your ship id (0 or 1), the match tuning, every crater so far, the
 *                                       room's name, a token for reconnecting, and who is in each seat
 *     { t: 'seats', seats }             who is in each seat changed: 'here', 'away' (reconnecting) or null
 *     { t: 'full' }                     both ships are taken
 *     { t: 'replaced' }                 your seat was taken back by a newer connection with your token
 *     { t: 'noroom' }                   no room by that name (it ended, or the link is wrong)
 *     { t: 'error', text }              the server can't start a room
 *     { t: 'snap', ships, bullets, boxes, map, winner, events, acks }   about 30 times a second; acks[id] is
 *                                       the last input the server has applied to ship id; boxes: supply
 *                                       boxes; map: the map rules' state (their encode()); winner: the
 *                                       ship that won the match, or -1 (game.winner)
 *   browser → server
 *     { t: 'input', seq, list }        one input per simulation step, [turn, thrust, fire, cycle], numbered
 *                                      from seq. The server applies them in order, one per step; cycle (1)
 *                                      switches weapon at that step, so the browser can predict the switch.
 *     { t: 'map', action }              a map control (Starship: choose a level, restart): the server
 *                                       passes it to the map rules' action(ship, action)
 *     { t: 'rematch' }                  the match is won: start the next one (scores to 0, ships to their pads)
 *
 * events is everything that happened since the last snap, in order: [type, ...args] for simulation
 * events (ships travel as { ship: id }), and ['carve', x, y, r] for craters.
 * ------------------------------------------------------------------ */
export const SNAP_EVERY = 4;   // simulation steps per snapshot (120 Hz / 4 = 30 a second)

// Maps the server can run: plain rock, and themes whose rules live in shared (maps/index.js).
export const ONLINE_MAPS = Object.keys(MAPS).filter((k) => !MAPS[k].theme || RULES[MAPS[k].theme]);

const SHIP_FIELDS = ['x', 'y', 'vx', 'vy', 'a', 'av', 'thrust', 'hp', 'ammo', 'landed', 'onPad', 'alive', 'active',
  'respawnT', 'invulnT', 'score', 'deathX', 'deathY', 'lastImpact', 'weapon', 'frozenT', 'minigunT',
  'bigLaser', 'missiles', 'eaten', 'lava', 'fireCd'];
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

// Live bullets as flat rows: slot, x, y, vx, vy, kind, owner, seq (see B.seq).
export const BULLET_ROW = 8;
export function encodeBullets() {
  const out = [];
  for (let i = 0; i < MAXB; i++) if (B.on[i]) out.push(i, B.x[i], B.y[i], B.vx[i], B.vy[i], B.kind[i], B.owner[i], B.seq[i]);
  return out;
}

// Simulation event arguments: ships become { ship: id } on the wire and turn back into ships on arrival.
export const encodeArgs = (args) => args.map((a) => (ships.includes(a) ? { ship: a.id } : a));
export const decodeArgs = (args) => args.map((a) => (a && typeof a === 'object' && 'ship' in a ? ships[a.ship] : a));
