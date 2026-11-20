import { P, WEAPONS } from '@rocket-duel/shared/config.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { game } from '@rocket-duel/shared/state.js';
import { carve } from '@rocket-duel/shared/level/mask.js';
import { simEvent } from '@rocket-duel/shared/events.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { cycleWeapon } from '@rocket-duel/shared/ships/weapons.js';
import { B, MAXB } from '@rocket-duel/shared/bullets.js';
import { applyBullets, applyShips, decodeArgs } from '@rocket-duel/shared/net.js';
import { setMode } from '../game/modes.js';
import { removeBoxes } from '../systems/boxes.js';

/* ------------------------------------------------------------------ *
 * Online play (open the page with ?server=ws://host:port). The server runs the match; this page sends
 * the player's input, shows the server's snapshots, and replays its events through the same listeners
 * as local play, so every sound and effect works as usual. Protocol: @rocket-duel/shared/net.js.
 * ------------------------------------------------------------------ */
// Tuning that stays the viewer's own: camera, looks, sound and input. Everything else comes from the server.
const LOCAL_KEYS = ['zoom', 'cameraLag', 'lookahead', 'split', 'showTrajectory', 'trajectorySeconds', 'showHull',
  'showVelocity', 'smoke', 'smokeLife', 'smokeRate', 'sound', 'volume', 'p1Pad', 'p2Pad', 'deadzone'];
export const net = { online: false, id: 0, ws: null, snapAt: 0, gap: 1000 / 30, sent: '', sentAt: 0 };

const setStatus = (text) => { document.querySelector('.sub').textContent = text; };
const send = (m) => { if (net.ws && net.ws.readyState === WebSocket.OPEN) net.ws.send(JSON.stringify(m)); };

export function connect(url) {
  net.online = true;
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
  const keep = Object.fromEntries(LOCAL_KEYS.map((k) => [k, P[k]]));
  Object.assign(P, m.P, keep);
  setMode('duel', true);   // builds the server's map from its seed
  removeBoxes();           // supply boxes don't run online yet
  for (const [x, y, r] of m.carves) carve(x, y, r);
  setStatus(`Online: you are Player ${m.id + 1}. Steer with WASD or the arrows.`);
}

function snap(m) {
  const wasAlive = ships.map((s) => s.alive);
  for (const s of ships) { s.px = s.x; s.py = s.y; s.pa = s.a; }   // draw from the last snapshot to this one
  applyShips(m.ships);
  ships.forEach((s, i) => { if (s.alive && !wasAlive[i]) { s.px = s.x; s.py = s.y; s.pa = s.a; } });   // no slide on respawn
  for (const [type, ...args] of m.events) {
    if (type === 'carve') carve(...args);
    else if (type === 'bulletEnd') {
      const [i, x, y] = args;
      B.x[i] = x; B.y[i] = y;
      simEvent('bulletEnd', i);
      B.on[i] = 0;
    } else simEvent(type, ...decodeArgs(args));
  }
  applyBullets(m.bullets, game.time);
  net.snapAt = performance.now();
}

// How far to draw between the last two snapshots (0 to 1).
export const netAlpha = () => clamp((performance.now() - net.snapAt) / net.gap, 0, 1);

// The local player can use either set of keys (or either pad); both steer the one ship.
export function sendInput() {
  const a = ships[0].input, b = ships[1].input;
  const m = { t: 'input', turn: clamp(a.turn + b.turn, -1, 1), thrust: Math.max(a.thrust, b.thrust), fire: a.fire || b.fire };
  const key = JSON.stringify(m), now = performance.now();
  if (key === net.sent && now - net.sentAt < 250) return;
  net.sent = key; net.sentAt = now;
  send(m);
}
export function switchWeapon(s) {
  if (net.online) send({ t: 'cycle' }); else cycleWeapon(s);
}

// Between snapshots bullets keep flying on their own; the next snapshot corrects them.
export function netStep(h) {
  game.time += h;
  game.matchClock += h;
  for (let i = 0; i < MAXB; i++) {
    if (!B.on[i]) continue;
    B.vy[i] -= P.gravity * P.bulletGravity * WEAPONS[B.kind[i]].grav * h;
    B.x[i] += B.vx[i] * h; B.y[i] += B.vy[i] * h;
  }
}
