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
import { activeMap } from '../maps/index.js';
import { stage } from '../render/scene.js';
import { applyBoxes, boxes } from '@rocket-duel/shared/boxes.js';
import { applySkins } from '../ui/skins.js';
import { appEl, togglePause } from '../ui/header.js';

/* ------------------------------------------------------------------ *
 * Online play: New game → Online, or an invite link (?room=abc123). The server runs the match; this page sends
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
export const net = { online: false, joined: false, id: 0, ws: null, seats: [null, null], snapAt: 0, gap: 1000 / 30, seq: 0, cycle: false, input: { turn: 0, thrust: 0, fire: false } };
const pending = [];   // [seq, input] the server hasn't confirmed yet
let outbox = [];      // inputs not sent yet
const corr = [0, 1].map(() => ({ x: 0, y: 0, a: 0 }));   // prediction error still being eased out, per ship
let freshStep = false, shotCursor = 0;   // freshStep: predicting a step for the first time (not a replay)
const hidden = new Set();       // input numbers of shots we already showed ending (they hit a wall here first)
const hiddenSlots = new Set();  // server slots holding those shots, kept out of sight

const send = (m) => { if (net.ws && net.ws.readyState === WebSocket.OPEN) net.ws.send(JSON.stringify(m)); };

// The game server: ?server=… on the page, else the one the build was made for (VITE_SERVER_URL), else
// port 8787 on this machine while developing, else the address the page came from.
export function serverURL() {
  const q = new URLSearchParams(location.search).get('server');
  const url = q || import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? `ws://${location.hostname}:8787`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  return url.replace(/\/$/, '');
}
// The page's address with ?room=…, for the invite link (a ?server=… stays on it).
export function roomLink(room) {
  const q = new URLSearchParams(location.search);
  q.set('room', room);
  return `${location.origin}${location.pathname}?${q}`;
}

/* Connecting, and reconnecting after a dropped connection. The welcome brings a token that takes back the
 * same seat (and score); it is kept per tab, so reloading the page rejoins too. */
const conn = { room: null, map: null, skins: null, token: null, tries: 0, timer: 0, done: false, lostAt: 0 };
const RETRY_FOR = 25;   // seconds of retrying before giving up (the server holds the seat for 30)
const tokenKey = (room) => `rocket-duel-token-${room}`;
// True when this tab already has a seat in that room (it reloaded): it can rejoin without asking.
export function hasSeat(room) { try { return !!sessionStorage.getItem(tokenKey(room)); } catch { return false; } }

// room: a room's name to join, or null to start one on map.
export function connect({ room = null, map = 'cave', skins }) {
  Object.assign(conn, { room, map, skins, tries: 0, done: false, lostAt: 0 });
  try { conn.token = room ? sessionStorage.getItem(tokenKey(room)) : null; } catch { conn.token = null; }
  net.online = true;
  stage.dataset.online = '';
  appEl.dataset.online = '';
  if (game.paused) togglePause();
  showCard('connecting');
  open();
}
function open() {
  clearTimeout(conn.timer);
  const q = new URLSearchParams({ room: conn.room || 'new' });
  if (!conn.room) q.set('map', conn.map);
  if (conn.token) q.set('token', conn.token);
  let ws;
  try { ws = new WebSocket(`${serverURL()}/?${q}`); } catch { lost(); return; }
  net.ws = ws;
  ws.addEventListener('message', (e) => {
    if (net.ws !== ws) return;
    const m = JSON.parse(e.data);
    if (m.t === 'snap') snap(m);
    else if (m.t === 'welcome') welcome(m);
    else if (m.t === 'seats') { net.seats = m.seats; showCard(); }
    else if (m.t === 'full') end('full');
    else if (m.t === 'noroom') end('noroom');
    else if (m.t === 'replaced') end('replaced');
    else if (m.t === 'error') end('error', m.text);
  });
  ws.addEventListener('close', () => { if (net.ws === ws) lost(); });
}
// The connection dropped (or never opened): try again, more slowly each time, until RETRY_FOR runs out.
function lost() {
  net.ws = null;
  net.joined = false;
  if (conn.done) return;
  const now = performance.now();
  if (!conn.lostAt) conn.lostAt = now;
  if (now - conn.lostAt > RETRY_FOR * 1000) { end(conn.room ? 'gone' : 'unreachable'); return; }
  showCard(conn.room ? 'reconnecting' : 'connecting');
  conn.timer = setTimeout(open, Math.min(4000, 400 * 2 ** conn.tries++));
}
function end(why, text) {
  conn.done = true;
  net.joined = false;
  clearTimeout(conn.timer);
  net.ws?.close();
  net.ws = null;
  showCard(why, text);
}
export function leaveOnline() {
  const q = new URLSearchParams(location.search);
  q.delete('room');
  location.href = `${location.pathname}${q.size ? `?${q}` : ''}`;
}

/* The card at the top of the game view: connecting, waiting for an opponent (with the invite link),
 * an opponent who dropped out, our own connection coming back, or why online play stopped. */
const card = {
  el: document.getElementById('netCard'), title: document.getElementById('netTitle'), text: document.getElementById('netText'),
  link: document.getElementById('netLinkRow'), input: document.getElementById('netLink'), copy: document.getElementById('netCopy'),
  action: document.getElementById('netAction'), state: null,
};
const CARD = {
  connecting: ['Connecting…', 'Reaching the game server.'],
  reconnecting: ['Connection lost', 'Reconnecting… your ship waits for you.'],
  waiting: ['Waiting for an opponent', 'Send this link to a friend. The match starts when they open it; fly around meanwhile.'],
  away: ['Your opponent dropped out', 'Waiting for them to reconnect…'],
  full: ['This game is full', 'Two players are already in it. Start your own from New game.', 'New game'],
  replaced: ['Playing in another window', 'This game continues in the window you opened it in last.', 'Leave'],
  noroom: ['This game has ended', 'The room closed, or the link is wrong. Start a new one.', 'New game'],
  gone: ['Lost the connection', 'The game server stopped answering.', 'Try again'],
  unreachable: ['Can\'t reach the game server', `Nothing answered at ${serverURL()}.`, 'Try again'],
  error: ['Can\'t start a game', '', 'Back'],
};
function showCard(state, text) {
  if (state === undefined) {   // from the seats: still waiting, or someone dropped out
    if (card.state && !['waiting', 'away', null].includes(card.state)) return;
    const other = net.seats[1 - net.id];
    state = other === 'here' ? null : other === 'away' ? 'away' : 'waiting';
  }
  card.state = state;
  card.el.hidden = !state;
  if (!state) return;
  const [title, body, action] = CARD[state];
  card.title.textContent = title;
  card.text.textContent = text || body;
  card.link.hidden = state !== 'waiting';
  if (state === 'waiting') card.input.value = roomLink(conn.room);
  card.action.hidden = !action;
  if (action) card.action.textContent = action;
}
card.copy.addEventListener('click', async () => {
  card.input.select();
  try { await navigator.clipboard.writeText(card.input.value); } catch { document.execCommand?.('copy'); }
  card.copy.textContent = 'Copied';
  setTimeout(() => { card.copy.textContent = 'Copy link'; }, 1500);
});
card.action.addEventListener('click', () => {
  if (card.state === 'gone' || card.state === 'unreachable') {
    Object.assign(conn, { done: false, tries: 0, lostAt: 0 });
    showCard(conn.room ? 'reconnecting' : 'connecting');
    open();
  } else leaveOnline();
});

function welcome(m) {
  net.joined = true;
  net.id = m.id;
  net.seats = m.seats;
  conn.room = m.room;
  conn.token = m.token;
  conn.tries = 0; conn.lostAt = 0;
  try { sessionStorage.setItem(tokenKey(m.room), m.token); } catch { /* reconnecting after a reload is optional */ }
  history.replaceState(null, '', `${roomLink(m.room)}${location.hash}`);
  stage.dataset.me = m.id;
  // A fresh start for prediction: the server numbers this connection's inputs from 1 again.
  pending.length = 0; outbox = []; net.seq = 0;
  hidden.clear(); hiddenSlots.clear();
  for (let i = MAXB; i < BULLET_SLOTS; i++) B.on[i] = 0;
  for (const c of corr) c.x = c.y = c.a = 0;
  const keep = Object.fromEntries(LOCAL_KEYS.map((k) => [k, P[k]]));
  Object.assign(P, m.P, keep);
  setMode('duel', true);   // builds the server's map from its seed (and switches to the single view)
  boxes.length = 0;        // the first snapshot brings the server's boxes
  for (const [x, y, r] of m.carves) carve(x, y, r);
  // Your colour is your first skin, wherever you sit; the opponent gets your second.
  const [mine, theirs] = conn.skins;
  applySkins(m.id === 0 ? [mine, theirs] : [theirs, mine]);
  document.querySelector('.sub').textContent = `Online: you are Player ${m.id + 1} in game ${m.room}. Steer with WASD or the arrows.`;
  const keys = '<kbd>W</kbd><kbd>↑</kbd>thrust <kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd>turn <kbd>L Shift</kbd><kbd>-</kbd>fire <kbd>S</kbd><kbd>↓</kbd>weapon <kbd>M</kbd>sound';
  for (const el of document.querySelectorAll('.hud-keys')) el.innerHTML = keys;
  card.state = null;
  showCard();
}

function predict(s, inp, h, fresh) {
  s.input = inp;
  game.predicting = true;
  // A weapon switch shows (the box slides, a click) when first predicted; replays redo it quietly.
  if (inp.cycle) { if (fresh) cycleWeapon(s); else quietly(() => cycleWeapon(s)); }
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
  while (pending.length && pending[0][0] <= m.acks[net.id]) pending.shift();
  if (me.alive && me.active) for (const [, inp] of pending) predict(me, inp, h, false);
  const c = corr[net.id];
  if (was.alive && me.alive && Math.hypot(was.x - me.x, was.y - me.y) < 150) {
    // Keep drawing from where the ship was, and ease out the difference.
    c.x += was.x - me.x; c.y += was.y - me.y; c.a += was.a - me.a;
    me.px = me.x - (was.x - was.px); me.py = me.y - (was.y - was.py); me.pa = me.a - (was.a - was.pa);
  } else {
    c.x = c.y = c.a = 0;
    me.px = me.x; me.py = me.y; me.pa = me.a;
  }

  if (m.map) activeMap().apply?.(m.map);
  applyBoxes(m.boxes);   // before the events, so a box that just appeared sparkles where it now is
  for (const [type, ...args] of m.events) {
    if (type === 'carve') carve(...args);
    else if (type === 'bulletEnd') {
      const [i, x, y] = args;
      if (hiddenSlots.delete(i) || !B.on[i]) continue;   // hidden, or it started and ended between snapshots
      B.x[i] = x; B.y[i] = y;
      endShot(i);
    } else if ((type === 'fired' || (type === 'weaponChanged' && !args[3])) && args[0]?.ship === net.id) continue;   // already shown when we predicted it
    // (a quiet weaponChanged is the server's own switch away from a spent Big laser: that one we show)
    else simEvent(type, ...decodeArgs(args));
  }
  applyBullets(m.bullets, m.acks[net.id]);
  net.snapAt = performance.now();
}

// Where to draw a ship: between its last two steps (our own) or snapshots (the other player's), plus any
// prediction error still being eased out. stepAlpha is how far the clock is into the current step.
// How far the clock is from the last snapshot to the next: what the server's things are drawn at.
export const snapAlpha = () => clamp((performance.now() - net.snapAt) / net.gap, 0, 1);
export function drawPos(s, stepAlpha) {
  const k = net.online && s.id !== net.id ? snapAlpha() : stepAlpha;
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
  send({ t: 'input', seq: net.seq - outbox.length + 1, list: outbox.map((i) => [i.turn, i.thrust, i.fire ? 1 : 0, i.cycle ? 1 : 0]) });
  outbox = [];
}
// A map control (a level choice, a restart): online the server runs it, else it runs here.
export function mapAction(action) {
  if (net.online) send({ t: 'map', action }); else activeMap().action?.(ships[0], action);
}
export function switchWeapon(s) {
  if (net.online) net.cycle = true; else cycleWeapon(s);   // online: sent with the next step's input
}

// One step online: our ship moves and fires now (predicted); bullets keep flying until the next snapshot corrects them.
export function netStep(h) {
  game.time += h;
  game.matchClock += h;
  if (!net.joined) return;   // connecting: nothing to predict yet
  const me = ships[net.id], inp = { ...net.input, cycle: net.cycle };
  net.cycle = false;
  net.seq++;
  pending.push([net.seq, inp]);
  if (pending.length > 600) pending.shift();
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
document.getElementById('btnLeave').addEventListener('click', leaveOnline);
