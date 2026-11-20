import { WebSocketServer } from 'ws';
import { DEFAULTS, P } from '@rocket-duel/shared/config.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { game } from '@rocket-duel/shared/state.js';
import { onLevel } from '@rocket-duel/shared/level/mask.js';
import { generateMap } from '@rocket-duel/shared/level/generate.js';
import { MAPS } from '@rocket-duel/shared/level/terrain.js';
import { onAnySim } from '@rocket-duel/shared/events.js';
import { seedRandom } from '@rocket-duel/shared/random.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { respawn } from '@rocket-duel/shared/ships/physics.js';
import { cycleWeapon } from '@rocket-duel/shared/ships/weapons.js';
import { B, clearBullets } from '@rocket-duel/shared/bullets.js';
import { stepSim } from '@rocket-duel/shared/sim.js';
import { encodeArgs, encodeBullets, encodeShips, SNAP_EVERY } from '@rocket-duel/shared/net.js';

const MAX_QUEUE = 240;  // inputs a player may be ahead of the server (2 s); older ones are dropped
const CATCH_UP = 4;     // with more than this many waiting, a ship plays two inputs a step until it catches up

// Maps without a theme of their own (no creatures or enemies): the ones the server can run so far.
export const ONLINE_MAPS = Object.keys(MAPS).filter((k) => !MAPS[k].theme);

/* One duel for up to two players. The server owns the match: it runs the simulation from the players'
 * inputs and sends every browser what happened. The process holds one match, since the shared
 * simulation keeps its state in modules. */
// lag (ms) delays every message each way, to try the game as if over a slow connection.
export function startServer({ port = 8787, map = 'cave', seed = 7, lag = 0 } = {}) {
  const later = (fn) => (lag > 0 ? setTimeout(fn, lag / 2) : fn());
  if (!ONLINE_MAPS.includes(map)) throw new Error(`Online play supports these maps: ${ONLINE_MAPS.join(', ')}`);
  Object.assign(P, structuredClone(DEFAULTS), { map, seed });
  game.mode = 'duel'; game.time = 0; game.matchClock = 0;
  generateMap();
  clearBullets();
  seedRandom(seed);
  for (const s of ships) { s.active = false; s.alive = false; s.score = 0; s.bigLaser = 1; s.beam = null; }

  const carves = [];   // every crater so far, so a player who joins late sees the same cave
  let events = [];
  onLevel('carved', (x, y, r) => { carves.push([x, y, r]); events.push(['carve', x, y, r]); });
  onAnySim((type, args) => {
    // A bullet's last position travels with its end, so the browser can finish the trail where it stopped.
    if (type === 'bulletEnd') events.push(['bulletEnd', args[0], B.x[args[0]], B.y[args[0]]]);
    else events.push([type, ...encodeArgs(args)]);
  });

  const seats = [null, null];   // { ws, queue, ack } per ship: inputs waiting to be applied, last one applied
  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws) => {
    const id = seats.indexOf(null);
    if (id < 0) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }
    const seat = { ws, queue: [], ack: 0 };
    seats[id] = seat;
    const s = ships[id];
    s.input = { turn: 0, thrust: 0, fire: false };
    s.score = 0;
    respawn(s);
    const welcome = JSON.stringify({ t: 'welcome', id, P, carves });
    later(() => ws.send(welcome));
    ws.on('message', (data) => later(() => {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'input' && Array.isArray(m.list)) {
        m.list.forEach(([turn, thrust, fire], k) => seat.queue.push([m.seq + k, { turn: clamp(+turn || 0, -1, 1), thrust: clamp(+thrust || 0, 0, 1), fire: !!fire }]));
        // A player far ahead (a stalled server, a fast clock) skips the oldest inputs instead of falling behind.
        if (seat.queue.length > MAX_QUEUE) seat.ack = seat.queue.splice(0, seat.queue.length - MAX_QUEUE).at(-1)[0];
      }
      else if (m.t === 'cycle') cycleWeapon(s);
    }));
    ws.on('close', () => {
      seats[id] = null;
      s.active = false; s.alive = false; s.beam = null;
      s.input = { turn: 0, thrust: 0, fire: false };
    });
  });

  // A ship moves one step per input its player sent, so the server's ship takes the same steps as the
  // player's own prediction. No input yet: it waits. A backlog: two a step until it is caught up.
  function inputsFor(s) {
    const seat = seats[s.id];
    if (!seat) return [];
    const list = seat.queue.splice(0, seat.queue.length > CATCH_UP ? 2 : 1);
    if (list.length) seat.ack = list.at(-1)[0];
    return list;
  }

  const h = 1 / P.physicsHz;
  let last = performance.now(), acc = 0, steps = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= h) {
      stepSim(h, inputsFor);
      acc -= h;
      if (++steps % SNAP_EVERY === 0) {
        const msg = JSON.stringify({ t: 'snap', ships: encodeShips(), bullets: encodeBullets(), events, acks: seats.map((st) => st?.ack ?? 0) });
        events = [];
        for (const seat of seats) if (seat) later(() => { if (seat.ws.readyState === seat.ws.OPEN) seat.ws.send(msg); });
      }
    }
  }, 2);

  return {
    port: () => wss.address().port,
    close: () => new Promise((resolve) => { clearInterval(timer); for (const seat of seats) seat?.ws.terminate(); wss.close(() => resolve()); }),
  };
}
