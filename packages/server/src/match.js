import { randomUUID } from 'node:crypto';
import { DEFAULTS, P } from '@rocket-duel/shared/config.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { game } from '@rocket-duel/shared/state.js';
import { level, onLevel } from '@rocket-duel/shared/level/mask.js';
import { mapRules, setMapRules } from '@rocket-duel/shared/maps.js';
import { rulesFor } from '@rocket-duel/shared/maps/index.js';
import { generateMap } from '@rocket-duel/shared/level/generate.js';
import { onAnySim } from '@rocket-duel/shared/events.js';
import { seedRandom } from '@rocket-duel/shared/random.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { respawn } from '@rocket-duel/shared/ships/physics.js';
import { B, clearBullets } from '@rocket-duel/shared/bullets.js';
import { stepSim } from '@rocket-duel/shared/sim.js';
import { encodeBoxes, resetBoxes } from '@rocket-duel/shared/boxes.js';
import { encodeArgs, encodeBullets, encodeShips, ONLINE_MAPS, SNAP_EVERY } from '@rocket-duel/shared/net.js';

const MAX_QUEUE = 240;  // inputs a player may be ahead of the server (2 s); older ones are dropped
const CATCH_UP = 4;     // with more than this many waiting, a ship plays two inputs a step until it catches up
export const HOLD_SEAT = 30;   // seconds a dropped player's ship waits for them to reconnect

/* One duel for up to two players. The match owns the game: it runs the simulation from the players'
 * inputs and sends every browser what happened. The shared simulation keeps its state in modules, so a
 * process (or worker thread) holds one match; the server gives each room a worker of its own.
 *
 * It talks to the server through `port` (a worker's parentPort, or anything with postMessage and on):
 *   in   { k: 'join', cid, token }   a browser connected (token: it was here before and is reconnecting)
 *        { k: 'msg', cid, data }     a message from that browser (a JSON string)
 *        { k: 'leave', cid }         it disconnected
 *        { k: 'stop' }
 *   out  { k: 'send', to: [cid], data }        data (a JSON string) for those browsers
 *        { k: 'close', cid }                   send nothing more, and close that connection
 *        { k: 'idle', idle }                   true while no one is here and no seat is held */
export function runMatch({ map = 'cave', seed = 7, room = '' } = {}, port) {
  if (!ONLINE_MAPS.includes(map)) throw new Error(`Online play supports these maps: ${ONLINE_MAPS.join(', ')}`);
  Object.assign(P, structuredClone(DEFAULTS), { map, seed });
  game.mode = 'duel'; game.time = 0; game.matchClock = 0;
  setMapRules(() => rulesFor(level.theme));   // the map's creatures and pickups (shared/maps)
  generateMap();
  mapRules().start?.();
  clearBullets();
  seedRandom(seed);
  resetBoxes();
  for (const s of ships) { s.active = false; s.alive = false; s.score = 0; s.bigLaser = 1; s.beam = null; }

  const out = (to, m) => port.postMessage({ k: 'send', to, data: JSON.stringify(m) });
  const carves = [];   // every crater so far, so a player who joins late sees the same cave
  let events = [];
  onLevel('carved', (x, y, r) => { carves.push([x, y, r]); events.push(['carve', x, y, r]); });
  onAnySim((type, args) => {
    // A bullet's last position travels with its end, so the browser can finish the trail where it stopped.
    if (type === 'bulletEnd') events.push(['bulletEnd', args[0], B.x[args[0]], B.y[args[0]]]);
    else events.push([type, ...encodeArgs(args)]);
  });

  // One seat per ship. cid: the browser in it (null while it is away). token: lets that browser reclaim
  // the seat after a dropped connection, until awayUntil. queue: inputs waiting to be applied; ack: the last one applied.
  const seats = [null, null];
  const seatOf = (cid) => seats.findIndex((st) => st && st.cid === cid);
  const here = () => seats.filter((st) => st?.cid != null).map((st) => st.cid);
  // Who is in each seat, for the waiting and dropped-out messages: 'here', 'away' (reconnecting) or null.
  const seatStates = () => seats.map((st) => (!st ? null : st.cid != null ? 'here' : 'away'));
  const tellSeats = () => out(here(), { t: 'seats', seats: seatStates() });
  let wasIdle = null;
  const checkIdle = () => {
    const idle = seats.every((st) => !st);
    if (idle !== wasIdle) port.postMessage({ k: 'idle', idle });
    wasIdle = idle;
  };

  function join(cid, token) {
    let id = token ? seats.findIndex((st) => st && st.token === token) : -1;
    const back = id >= 0;
    // Back before we noticed the old connection drop (a network switch): the new one takes over.
    if (back && seats[id].cid != null) { out([seats[id].cid], { t: 'replaced' }); port.postMessage({ k: 'close', cid: seats[id].cid }); }
    if (!back) id = seats.indexOf(null);
    if (id < 0) { out([cid], { t: 'full' }); port.postMessage({ k: 'close', cid }); return; }
    const s = ships[id];
    if (back) {
      Object.assign(seats[id], { cid, queue: [], ack: 0 });
    } else {
      seats[id] = { cid, token: randomUUID(), queue: [], ack: 0 };
      s.score = 0;
      s.weapon = 0;
    }
    s.input = { turn: 0, thrust: 0, fire: false };
    respawn(s);
    out([cid], { t: 'welcome', id, P, carves, room, token: seats[id].token, seats: seatStates() });
    tellSeats();
    checkIdle();
  }
  function message(cid, data) {
    const id = seatOf(cid);
    if (id < 0) return;
    const seat = seats[id], s = ships[id];
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'input' && Array.isArray(m.list) && Number.isInteger(m.seq)) {
      m.list.forEach(([turn, thrust, fire, cycle], k) => seat.queue.push([m.seq + k, { turn: clamp(+turn || 0, -1, 1), thrust: clamp(+thrust || 0, 0, 1), fire: !!fire, cycle: !!cycle }]));
      // A player far ahead (a stalled server, a fast clock) skips the oldest inputs instead of falling behind.
      if (seat.queue.length > MAX_QUEUE) seat.ack = seat.queue.splice(0, seat.queue.length - MAX_QUEUE).at(-1)[0];
    }
    else if (m.t === 'map') mapRules().action?.(s, m.action);
  }
  // A dropped player's ship leaves the cave; the seat stays theirs for HOLD_SEAT seconds.
  function leave(cid) {
    const id = seatOf(cid);
    if (id < 0) return;
    const s = ships[id];
    Object.assign(seats[id], { cid: null, queue: [], awayUntil: game.time + HOLD_SEAT });
    s.active = false; s.alive = false; s.beam = null;
    s.input = { turn: 0, thrust: 0, fire: false };
    tellSeats();
  }
  port.on('message', (m) => {
    if (m.k === 'join') join(m.cid, m.token);
    else if (m.k === 'msg') message(m.cid, m.data);
    else if (m.k === 'leave') leave(m.cid);
    else if (m.k === 'stop') stop();
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
        out(here(), { t: 'snap', ships: encodeShips(), bullets: encodeBullets(), boxes: encodeBoxes(), map: mapRules().encode?.() ?? null, events, acks: seats.map((st) => st?.ack ?? 0) });
        events = [];
        // A seat held too long is given up: the next player to join takes it.
        let freed = false;
        seats.forEach((st, i) => { if (st && st.cid == null && game.time > st.awayUntil) { seats[i] = null; freed = true; } });
        if (freed) { tellSeats(); checkIdle(); }
      }
    }
  }, 2);
  function stop() { clearInterval(timer); port.close?.(); }
  checkIdle();
  return { stop };
}
