import { P, WEAPONS } from '@rocket-duel/shared/config.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { game } from '@rocket-duel/shared/state.js';
import { carve, solidAt } from '@rocket-duel/shared/level/mask.js';
import { quietly, simEvent } from '@rocket-duel/shared/events.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { canFire, moveShip } from '@rocket-duel/shared/ships/physics.js';
import { cycleWeapon, fire } from '@rocket-duel/shared/ships/weapons.js';
import { B, BULLET_SLOTS, MAXB, onPredictedShot, PREDICTED_SLOTS } from '@rocket-duel/shared/bullets.js';
import { applyShips, BULLET_ROW, decodeArgs } from '@rocket-duel/shared/net.js';
import { setMode } from '../game/modes.js';
import { stage } from '../render/scene.js';
import { removeBoxes } from '../systems/boxes.js';

/* ------------------------------------------------------------------ *
 * Online play (open the page with ?server=ws://host:port). The server runs the match; this page sends
 * the player's input, shows the server's snapshots, and replays its events through the same listeners
 * as local play, so every sound and effect works as usual. Protocol: @rocket-duel/shared/net.js.
 *
 * Prediction: the page flies its own ship straight away with the shared physics, one numbered input per
 * step. Each snapshot says which input the server reached; the page takes the server's ship and replays
 * the newer inputs on top. Whatever still differs (a bump) is eased in rather than jumped to.
 * Its own shots are predicted too: the flash, sound and bullet show at once, in the bullet slots after
 * MAXB, until the server's bullet fired by the same input arrives and takes over.
 * ------------------------------------------------------------------ */
// Tuning that stays the viewer's own: camera, looks, sound and input. Everything else comes from the server.
const LOCAL_KEYS = ['zoom', 'cameraLag', 'lookahead', 'split', 'showTrajectory', 'trajectorySeconds', 'showHull',
  'showVelocity', 'smoke', 'smokeLife', 'smokeRate', 'sound', 'volume', 'p1Pad', 'p2Pad', 'deadzone'];
export const net = { online: false, id: 0, ws: null, snapAt: 0, gap: 1000 / 30, seq: 0, input: { turn: 0, thrust: 0, fire: false } };
const history = [];   // [seq, input] the server hasn't confirmed yet
let outbox = [];      // inputs not sent yet
const corr = [0, 1].map(() => ({ x: 0, y: 0, a: 0 }));   // prediction error still being eased out, per ship
let freshStep = false, shotCursor = 0;   // freshStep: predicting a step for the first time (not a replay)
const hidden = new Set();       // input numbers of shots we already showed ending (they hit a wall here first)
const hiddenSlots = new Set();  // server slots holding those shots, kept out of sight

const setStatus = (text) => { document.querySelector('.sub').textContent = text; };
const send = (m) => { if (net.ws && net.ws.readyState === WebSocket.OPEN) net.ws.send(JSON.stringify(m)); };

export function connect(url) {
  net.online = true;
  stage.dataset.online = '';
  setStatus(`Online: connecting to ${url}…`);
  const ws = new WebSocket(url);
  net.ws = ws;
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') welcome(m);
    else if (m.t === 'snap') snap(m);
    else if (m.t === 'full') setStatus('Online: this match already has two players.');
  });
  ws.addEventListener('close', () => setStatus('Online: disconnected from the server. Reload to try again.'));
  ws.addEventListener('error', () => setStatus(`Online: can't reach ${url}.`));
}

function welcome(m) {
  net.id = m.id;
  stage.dataset.me = m.id;
  const keep = Object.fromEntries(LOCAL_KEYS.map((k) => [k, P[k]]));
  Object.assign(P, m.P, keep);
  setMode('duel', true);   // builds the server's map from its seed (and switches to the single view)
  removeBoxes();           // supply boxes don't run online yet
  for (const [x, y, r] of m.carves) carve(x, y, r);
  setStatus(`Online: you are Player ${m.id + 1}. Steer with WASD or the arrows.`);
}

function predict(s, inp, h, fresh) {
  s.input = inp;
  game.predicting = true;
  let canAct = false;
  quietly(() => { canAct = moveShip(s, h); });
  // A fresh step shows its shot (flash, sound, bullet); a replay only keeps ammo, cooldown and recoil right.
  // The Big laser waits for the server.
  if (canAct && canFire(s) && WEAPONS[s.weapon].id !== 'laser') {
    freshStep = fresh;
    if (fresh) fire(s); else quietly(() => fire(s));
    freshStep = false;
  }
  game.predicting = false;
}
onPredictedShot((owner, x, y, vx, vy, life, kind) => {
  if (!freshStep) return;
  for (let k = 0; k < PREDICTED_SLOTS; k++) {
    const i = MAXB + (shotCursor + k) % PREDICTED_SLOTS;
    if (B.on[i]) continue;
    B.on[i] = 1; B.owner[i] = owner; B.x[i] = x; B.y[i] = y; B.vx[i] = vx; B.vy[i] = vy; B.life[i] = life; B.kind[i] = kind;
    B.tx[i] = x; B.ty[i] = y; B.tt[i] = game.time; B.seq[i] = net.seq;
    shotCursor = (i - MAXB + 1) % PREDICTED_SLOTS;
    return;
  }
});
function endShot(i) { simEvent('bulletEnd', i); B.on[i] = 0; }

// The server's bullets replace ours. A predicted shot hands its trail to the server's copy of it; one the
// server has already passed without a copy (it didn't fire it, or the shot ended at once) goes away.
function applyBullets(rows, ack) {
  const seen = new Uint8Array(MAXB);
  for (let k = 0; k < rows.length; k += BULLET_ROW) {
    const [i, x, y, vx, vy, kind, owner, seq] = rows.slice(k, k + BULLET_ROW);
    const mine = owner === net.id;
    if (mine && (hiddenSlots.has(i) || hidden.has(seq))) { hiddenSlots.add(i); B.on[i] = 0; continue; }
    seen[i] = 1;
    if (mine && !B.on[i]) {
      for (let p = MAXB; p < BULLET_SLOTS; p++) {
        if (!B.on[p] || B.seq[p] !== seq) continue;
        B.tx[i] = B.tx[p]; B.ty[i] = B.ty[p]; B.tt[i] = B.tt[p]; B.kind[i] = kind; B.on[i] = 1;
        B.on[p] = 0;
        break;
      }
    }
    if (!B.on[i] || B.kind[i] !== kind) { B.tx[i] = x; B.ty[i] = y; B.tt[i] = game.time; }
    B.on[i] = 1; B.x[i] = x; B.y[i] = y; B.vx[i] = vx; B.vy[i] = vy;
    B.kind[i] = kind; B.owner[i] = owner; B.seq[i] = seq; B.life[i] = 1;
  }
  for (let i = 0; i < MAXB; i++) if (!seen[i]) B.on[i] = 0;
  for (let p = MAXB; p < BULLET_SLOTS; p++) if (B.on[p] && B.seq[p] <= ack) endShot(p);
  for (const seq of hidden) if (seq < ack - 600) hidden.delete(seq);
}

function snap(m) {
  const me = ships[net.id], h = 1 / P.physicsHz;
  const was = { x: me.x, y: me.y, a: me.a, px: me.px, py: me.py, pa: me.pa, alive: me.alive };
  const wasAlive = ships.map((s) => s.alive);
  for (const s of ships) if (s !== me) { s.px = s.x; s.py = s.y; s.pa = s.a; }   // draw from the last snapshot to this one
  applyShips(m.ships);
  ships.forEach((s, i) => { if (s !== me && s.alive && !wasAlive[i]) { s.px = s.x; s.py = s.y; s.pa = s.a; } });   // no slide on respawn

  // Our own ship: the server's state, then every input it hasn't applied yet.
  while (history.length && history[0][0] <= m.acks[net.id]) history.shift();
  if (me.alive && me.active) for (const [, inp] of history) predict(me, inp, h, false);
  const c = corr[net.id];
  if (was.alive && me.alive && Math.hypot(was.x - me.x, was.y - me.y) < 150) {
    // Keep drawing from where the ship was, and ease out the difference.
    c.x += was.x - me.x; c.y += was.y - me.y; c.a += was.a - me.a;
    me.px = me.x - (was.x - was.px); me.py = me.y - (was.y - was.py); me.pa = me.a - (was.a - was.pa);
  } else {
    c.x = c.y = c.a = 0;
    me.px = me.x; me.py = me.y; me.pa = me.a;
  }

  for (const [type, ...args] of m.events) {
    if (type === 'carve') carve(...args);
    else if (type === 'bulletEnd') {
      const [i, x, y] = args;
      if (hiddenSlots.delete(i) || !B.on[i]) continue;   // hidden, or it started and ended between snapshots
      B.x[i] = x; B.y[i] = y;
      endShot(i);
    } else if (type === 'fired' && args[0]?.ship === net.id) continue;   // already shown when we predicted it
    else simEvent(type, ...decodeArgs(args));
  }
  applyBullets(m.bullets, m.acks[net.id]);
  net.snapAt = performance.now();
}

// Where to draw a ship: between its last two steps (our own) or snapshots (the other player's), plus any
// prediction error still being eased out. stepAlpha is how far the clock is into the current step.
export function drawPos(s, stepAlpha) {
  const k = net.online && s.id !== net.id ? clamp((performance.now() - net.snapAt) / net.gap, 0, 1) : stepAlpha;
  const c = corr[s.id];
  return { x: s.px + (s.x - s.px) * k + c.x, y: s.py + (s.y - s.py) * k + c.y, a: s.pa + (s.a - s.pa) * k + c.a, k };
}
export function easeCorrections(dt) {
  const f = Math.exp(-dt * 12);
  for (const c of corr) { c.x *= f; c.y *= f; c.a *= f; }
}

// The local player can use either set of keys (or either pad); both steer the one ship.
export function readOnlineInput() {
  const a = ships[0].input, b = ships[1].input;
  net.input = { turn: clamp(a.turn + b.turn, -1, 1), thrust: Math.max(a.thrust, b.thrust), fire: a.fire || b.fire };
}
export function sendInputs() {
  if (!outbox.length) return;
  send({ t: 'input', seq: net.seq - outbox.length + 1, list: outbox.map((i) => [i.turn, i.thrust, i.fire ? 1 : 0]) });
  outbox = [];
}
export function switchWeapon(s) {
  if (net.online) send({ t: 'cycle' }); else cycleWeapon(s);
}

// One step online: our ship moves and fires now (predicted); bullets keep flying until the next snapshot corrects them.
export function netStep(h) {
  game.time += h;
  game.matchClock += h;
  const me = ships[net.id], inp = { ...net.input };
  net.seq++;
  history.push([net.seq, inp]);
  if (history.length > 600) history.shift();
  outbox.push(inp);
  me.px = me.x; me.py = me.y; me.pa = me.a;
  if (me.alive && me.active) predict(me, inp, h, true);
  for (let i = 0; i < BULLET_SLOTS; i++) {
    if (!B.on[i]) continue;
    B.vy[i] -= P.gravity * P.bulletGravity * WEAPONS[B.kind[i]].grav * h;
    B.x[i] += B.vx[i] * h; B.y[i] += B.vy[i] * h;
    // A predicted shot stops at walls and when its time runs out; the server's copy of it then stays hidden.
    if (i >= MAXB && ((B.life[i] -= h) <= 0 || solidAt(B.x[i], B.y[i]))) { hidden.add(B.seq[i]); endShot(i); }
  }
}
