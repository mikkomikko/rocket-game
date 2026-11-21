import { P } from '../config.js';
import { approach, clamp, segDist } from '../math.js';
import { carve, H, level, solidAt, W } from '../level/mask.js';
import { simEvent } from '../events.js';
import { random } from '../random.js';
import { SHIP_RADIUS, ships } from '../ships/ship.js';
import { addShake, damage, kill, shipMass } from '../ships/physics.js';

/* ------------------------------------------------------------------ *
 * Dune sea rules: the sandworm. Every WORM_EVERY seconds the sand rumbles, then it bursts out, arcs
 * through the air and dives back in. Its mouth swallows ships, its body knocks them about, and three
 * shots to the head (or the Big laser) burst it.
 * State only; the client draws it (client maps/desert) and hears:
 *   wormBurst(x, y)          it burst out of the sand at (x, y)
 *   wormDive(x, y)           its head dived back into the sand at (x, y)
 *   wormAte(s, x, y)         it swallowed ship s at (x, y)
 *   wormHurt(x, y)           a shot hit its head at (x, y)
 *   wormKilled(x, y)         it burst; (x, y) is its head, WORM.seg the rest of it
 *   wormThud(x, y)           a shot thudded into its body at (x, y)
 * ------------------------------------------------------------------ */
export const WORM_N = 24, WORM_GAP = 13, WORM_R = 24, WORM_G = 820, WORM_EVERY = 12, WORM_RUMBLE = 1.6;
export const WORM = { state: 'off', t: 7, x: 0, gy: 0, hx: 0, hy: 0, vx: 0, vy: 0, hp: 3, flash: 0, open: 0.4, gulp: 0, life: 0, air: false, entered: false, seg: [], prev: [] };
for (let i = 0; i < WORM_N; i++) { WORM.seg.push([0, 0]); WORM.prev.push([0, 0]); }
export const wormR = (i) => WORM_R * (1 - 0.6 * i / (WORM_N - 1));
export const wormUnder = (x, y) => y < 0 || solidAt(x, y);

// World y of the sand's surface at column x (the highest open cell from the bottom).
export function surfaceY(x) {
  const c = clamp(Math.floor(x), 0, W - 1);
  let r = H - 17;
  while (r > 0 && level.mask[r * W + c] !== 0) r--;
  return H - r - 1;
}
// Mostly under a ship, never on a pad or a mesa.
function pickWormX() {
  const bad = (x) => x < 90 || x > W - 90 || level.spawns.some((p) => Math.abs(p.x - x) < 120) || (level.mesas || []).some((mx) => Math.abs(mx - x) < 130);
  const alive = ships.filter((s) => s.active && s.alive);
  for (let k = 0; k < 16; k++) {
    const x = alive.length && k < 8 && random() < 0.7 ? alive[Math.floor(random() * alive.length)].x + (random() - 0.5) * 120 : 90 + random() * (W - 180);
    if (!bad(x)) return x;
  }
  return W / 2;
}
// Out it comes, aimed high enough to reach the nearest ship.
function launchWorm() {
  const x = WORM.x, gy = WORM.gy;
  let best = null, bd = Infinity;
  for (const s of ships) if (s.active && s.alive && Math.abs(s.x - x) < bd) { bd = Math.abs(s.x - x); best = s; }
  const peak = best && bd < 250 ? clamp(best.y - gy + 50, 200, 540) : 240 + random() * 220;
  WORM.vy = Math.sqrt(2 * WORM_G * peak);
  let dir = x < W / 2 ? 1 : -1;
  if (random() < 0.3) dir = -dir;
  WORM.vx = dir * (110 + random() * 150);
  WORM.hx = x; WORM.hy = gy - 30;
  const sp = Math.hypot(WORM.vx, WORM.vy);
  for (let i = 0; i < WORM_N; i++) {
    WORM.seg[i][0] = x - WORM.vx / sp * i * WORM_GAP; WORM.seg[i][1] = WORM.hy - WORM.vy / sp * i * WORM_GAP;
    WORM.prev[i][0] = WORM.seg[i][0]; WORM.prev[i][1] = WORM.seg[i][1];
  }
  WORM.state = 'fly'; WORM.hp = 3; WORM.life = 0; WORM.air = false; WORM.entered = false; WORM.open = 0.4; WORM.gulp = 0;
  if (P.destructible) carve(x, gy - 6, 30);
  simEvent('wormBurst', x, gy);
  for (const s of ships) if (s.active && Math.abs(s.x - x) < 500) addShake(s, 0.8);
}
export function hurtWorm() {
  WORM.hp--; WORM.flash = 0.15;
  simEvent('wormHurt', WORM.hx, WORM.hy);
  if (WORM.hp <= 0) killWorm();
}
export function killWorm() {
  simEvent('wormKilled', WORM.hx, WORM.hy);
  for (const s of ships) if (s.active) addShake(s, 0.7);
  WORM.state = 'off'; WORM.t = WORM_EVERY;
}
// 2 = the head (that's where it gets hurt), 1 = the body (shots just thud into it), 0 = a miss.
export function wormHit(x, y) {
  if (level.theme !== 'desert' || WORM.state !== 'fly') return 0;
  const R = WORM_R * 1.15;
  if ((x - WORM.hx) ** 2 + (y - WORM.hy) ** 2 < R * R) return 2;
  for (let i = 1; i < WORM_N; i++) {
    const [sx, sy] = WORM.seg[i], r = wormR(i);
    if ((x - sx) ** 2 + (y - sy) ** 2 < r * r) return 1;
  }
  return 0;
}
function stepWorm(h) {
  for (const s of ships) s.wormT = Math.max(0, (s.wormT || 0) - h);
  if (WORM.state === 'off') {
    WORM.t -= h;
    if (WORM.t <= 0) { WORM.x = pickWormX(); WORM.gy = surfaceY(WORM.x); WORM.state = 'rumble'; WORM.t = WORM_RUMBLE; }
    return;
  }
  if (WORM.state === 'rumble') {
    WORM.t -= h;
    const f = 1 - WORM.t / WORM_RUMBLE;
    for (const s of ships) if (s.active && Math.abs(s.x - WORM.x) < 350) addShake(s, 0.1 + 0.25 * f);
    if (WORM.t <= 0) launchWorm();
    return;
  }
  // Flying: the head follows a big arc and the body follows the head.
  WORM.life += h;
  for (let i = 0; i < WORM_N; i++) { WORM.prev[i][0] = WORM.seg[i][0]; WORM.prev[i][1] = WORM.seg[i][1]; }
  WORM.vy -= WORM_G * h;
  WORM.hx += WORM.vx * h; WORM.hy += WORM.vy * h;
  WORM.seg[0][0] = WORM.hx; WORM.seg[0][1] = WORM.hy;
  for (let i = 1; i < WORM_N; i++) {
    const a = WORM.seg[i - 1], b = WORM.seg[i];
    const dx = a[0] - b[0], dy = a[1] - b[1], d = Math.hypot(dx, dy);
    if (d > WORM_GAP) { b[0] = a[0] - dx / d * WORM_GAP; b[1] = a[1] - dy / d * WORM_GAP; }
  }
  const headIn = wormUnder(WORM.hx, WORM.hy);
  if (!WORM.air && !headIn && WORM.hy > WORM.gy + 10) WORM.air = true;
  if (WORM.air && headIn && !WORM.entered && WORM.vy < 0) {
    WORM.entered = true;
    if (P.destructible) carve(WORM.hx, WORM.hy + 6, 28);
    simEvent('wormDive', WORM.hx, WORM.hy + 4);
    for (const s of ships) if (s.active && Math.abs(s.x - WORM.hx) < 400) addShake(s, 0.5);
  }
  let near = false;
  for (const s of ships) {
    if (!s.active || !s.alive) continue;
    const sr = SHIP_RADIUS * P.shipSize * 0.8;
    const dh = Math.hypot(s.x - WORM.hx, s.y - WORM.hy);
    if (dh < 220) near = true;
    if (!headIn && dh < WORM_R * 1.12 + sr) {
      simEvent('wormAte', s, s.x, s.y);
      kill(s, true);
      addShake(s, 1.4);
      WORM.gulp = 0.6;
      continue;
    }
    for (let i = 2; i < WORM_N; i++) {
      const [sx, sy] = WORM.seg[i], r = wormR(i);
      if (wormUnder(sx, sy)) continue;
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < r + sr) {
        const nx = (s.x - sx) / (d || 1), ny = (s.y - sy) / (d || 1);
        s.vx += nx * 260 / shipMass(s); s.vy += (ny * 260 + 60) / shipMass(s);
        s.landed = false;
        if (!(s.wormT > 0)) { damage(s, 15); s.wormT = 0.5; addShake(s, 0.5); }
        break;
      }
    }
  }
  WORM.flash = Math.max(0, WORM.flash - h);
  if (WORM.gulp > 0) { WORM.gulp -= h; WORM.open = 0.15 * Math.abs(Math.sin(WORM.gulp * 25)); }
  else WORM.open = approach(WORM.open, near ? 1 : 0.4, h * 5);
  const done = WORM.life > 1 && WORM.seg.every(([sx, sy]) => wormUnder(sx, sy));
  if (done || WORM.life > 7) { WORM.state = 'off'; WORM.t = WORM_EVERY; }
}

const STATES = ['off', 'rumble', 'fly'];
const r1 = (v) => Math.round(v * 10) / 10;
export const desertRules = {
  start() { Object.assign(WORM, { state: 'off', t: 7, flash: 0 }); },
  simStep(h) { stepWorm(h); },
  bulletHit(x, y) {
    const wh = wormHit(x, y);
    if (!wh) return false;
    if (wh === 2) hurtWorm(); else simEvent('wormThud', x, y);
    return true;
  },
  beamHit(b, s, len, half) {
    if (WORM.state === 'fly' && segDist(WORM.hx, WORM.hy, b.ox, b.oy, b.ang, len) < half + WORM_R) killWorm();
  },
  // Online: [state (0 off, 1 rumble, 2 fly), t, x, gy] and, while it flies, [vx, vy, open, flash, x0, y0, x1, y1, …]
  // (the segments head first, to a tenth of a pixel).
  encode() {
    const w = WORM, top = [STATES.indexOf(w.state), r1(w.t), r1(w.x), r1(w.gy)];
    if (w.state !== 'fly') return [top];
    return [top, [r1(w.vx), r1(w.vy), Math.round(w.open * 100) / 100, Math.round(w.flash * 100) / 100, ...w.seg.flatMap(([x, y]) => [r1(x), r1(y)])]];
  },
  apply([top, fly]) {
    const was = WORM.state;
    let st;
    [st, WORM.t, WORM.x, WORM.gy] = top;
    WORM.state = STATES[st];
    if (!fly) return;
    [WORM.vx, WORM.vy, WORM.open, WORM.flash] = fly;
    for (let i = 0; i < WORM_N; i++) {
      const p = WORM.prev[i], q = WORM.seg[i];
      p[0] = q[0]; p[1] = q[1];
      q[0] = fly[4 + 2 * i]; q[1] = fly[5 + 2 * i];
      if (was !== 'fly') { p[0] = q[0]; p[1] = q[1]; }   // just burst out: no slide from where it last was
    }
    [WORM.hx, WORM.hy] = WORM.seg[0];
  },
};
