import * as THREE from 'three';
import { P } from '../../config.js';
import { approach, clamp } from '../../util/math.js';
import { carve, level, solidAt, W } from '../../level/mask.js';
import { scene } from '../../render/scene.js';
import { shapeGeo, SHIP_RADIUS, ships } from '../../ships/ship.js';
import { addShake, damage, kill, shipMass } from '../../ships/physics.js';
import { WHITE } from '../../fx/pools.js';
import { emit } from '../../fx/particles.js';
import { emitSmoke } from '../../fx/smoke.js';
import { surfaceY } from '../forest/plants.js';
import { FLESH, SAND, SAND_DK } from './plants.js';

// The sandworm: every WORM_EVERY seconds the sand rumbles, then it bursts out, arcs through the air and dives back in.
export const WORM_N = 24, WORM_GAP = 13, WORM_R = 24, WORM_G = 820, WORM_EVERY = 12, WORM_RUMBLE = 1.6;
export const WORM = { state: 'off', t: 7, x: 0, gy: 0, hx: 0, hy: 0, vx: 0, vy: 0, hp: 3, flash: 0, open: 0.4, gulp: 0, life: 0, air: false, entered: false, seg: [], prev: [] };
for (let i = 0; i < WORM_N; i++) { WORM.seg.push([0, 0]); WORM.prev.push([0, 0]); }
const wormR = (i) => WORM_R * (1 - 0.6 * i / (WORM_N - 1));
const wormMats = {};
for (const [k, hex] of Object.entries({ body: '#c98f6b', ring: '#a5674c', light: '#e8b892', head: '#b8735a', gum: '#a8384e', mouth: '#3a0f1c', tooth: '#fff4e0' })) wormMats[k] = new THREE.MeshBasicMaterial({ color: hex });
const WORM_HEAD = new THREE.Color('#b8735a');
const unitCircle = new THREE.CircleGeometry(1, 22);
const wormRoot = new THREE.Group();
wormRoot.position.z = -0.32;   // behind the terrain, so it really looks like it comes out of the sand
wormRoot.visible = false;
scene.add(wormRoot);
const wormSegs = [];
function wCircle(mat, r, x, y, z, sx = 1) {
  const m = new THREE.Mesh(unitCircle, wormMats[mat]);
  m.scale.set(r * sx, r, 1); m.position.set(x, y, z);
  return m;
}
for (let i = 0; i < WORM_N; i++) {
  const g = new THREE.Group(), r = wormR(i);
  g.position.z = (WORM_N - i) * 0.002;
  if (i === 0) {
    g.add(wCircle('head', r * 1.12, 0, 0, 0), wCircle('light', r * 0.45, -r * 0.25, r * 0.45, 0.0004));
    const mouth = new THREE.Group();
    mouth.position.set(r * 0.72, 0, 0.0008);
    mouth.add(wCircle('gum', r * 0.95, 0, 0, 0, 0.42), wCircle('mouth', r * 0.72, 0, 0, 0.0002, 0.38));
    for (let j = 0; j < 12; j++) {
      const a = j / 12 * Math.PI * 2, ex = Math.cos(a) * r * 0.36, ey = Math.sin(a) * r * 0.85;
      const t = new THREE.Mesh(shapeGeo([[ex - Math.sin(a) * 2.2, ey + Math.cos(a) * 2.2], [ex + Math.sin(a) * 2.2, ey - Math.cos(a) * 2.2], [ex * 0.55, ey * 0.55]]), wormMats.tooth);
      t.position.z = 0.0004;
      mouth.add(t);
    }
    g.add(mouth);
    g.userData.mouth = mouth;
  } else {
    g.add(wCircle(i % 2 ? 'body' : 'ring', r, 0, 0, 0), wCircle('light', r * 0.42, -r * 0.18, r * 0.42, 0.0004));
  }
  wormSegs.push(g);
  wormRoot.add(g);
}
export function resetWorm() {
  WORM.state = 'off'; WORM.t = 7; WORM.flash = 0;
  wormRoot.visible = false;
}
function pickWormX() {
  const bad = (x) => x < 90 || x > W - 90 || level.spawns.some((p) => Math.abs(p.x - x) < 120) || (level.mesas || []).some((mx) => Math.abs(mx - x) < 130);
  const alive = ships.filter((s) => s.active && s.alive);
  for (let k = 0; k < 16; k++) {
    const x = alive.length && k < 8 && Math.random() < 0.7 ? alive[Math.floor(Math.random() * alive.length)].x + (Math.random() - 0.5) * 120 : 90 + Math.random() * (W - 180);
    if (!bad(x)) return x;
  }
  return W / 2;
}
const wormUnder = (x, y) => y < 0 || solidAt(x, y);
function sandBurst(x, y, n, up = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.1 + 0.8 * Math.random()), sp = 60 + Math.random() * 260;
    emit(x + (Math.random() - 0.5) * 40, y, Math.cos(a) * sp, Math.sin(a) * sp * up, 0.6 + Math.random() * 0.7, i % 4 ? SAND : SAND_DK, 1, 3 + Math.random() * 5);
  }
}
function launchWorm() {
  const x = WORM.x, gy = WORM.gy;
  let best = null, bd = Infinity;
  for (const s of ships) if (s.active && s.alive && Math.abs(s.x - x) < bd) { bd = Math.abs(s.x - x); best = s; }
  const peak = best && bd < 250 ? clamp(best.y - gy + 50, 200, 540) : 240 + Math.random() * 220;
  WORM.vy = Math.sqrt(2 * WORM_G * peak);
  let dir = x < W / 2 ? 1 : -1;
  if (Math.random() < 0.3) dir = -dir;
  WORM.vx = dir * (110 + Math.random() * 150);
  WORM.hx = x; WORM.hy = gy - 30;
  const sp = Math.hypot(WORM.vx, WORM.vy);
  for (let i = 0; i < WORM_N; i++) {
    WORM.seg[i][0] = x - WORM.vx / sp * i * WORM_GAP; WORM.seg[i][1] = WORM.hy - WORM.vy / sp * i * WORM_GAP;
    WORM.prev[i][0] = WORM.seg[i][0]; WORM.prev[i][1] = WORM.seg[i][1];
  }
  WORM.state = 'fly'; WORM.hp = 3; WORM.life = 0; WORM.air = false; WORM.entered = false; WORM.open = 0.4; WORM.gulp = 0;
  if (P.destructible) carve(x, gy - 6, 30);
  sandBurst(x, gy, 60);
  if (P.smoke) for (let i = 0; i < 6; i++) emitSmoke(x + (Math.random() - 0.5) * 50, gy + 10, (Math.random() - 0.5) * 60, 30 + Math.random() * 40, 1.4 + Math.random(), 9 + Math.random() * 6);
  for (const s of ships) if (s.active && Math.abs(s.x - x) < 500) addShake(s, 0.8);
}
export function hurtWorm() {
  WORM.hp--; WORM.flash = 0.15;
  for (let i = 0; i < 10; i++) emit(WORM.hx, WORM.hy, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.4, i % 2 ? FLESH : WHITE, 0.5, 3 + Math.random() * 3);
  if (WORM.hp <= 0) killWorm();
}
export function killWorm() {
  for (let i = 0; i < WORM_N; i += 2) {
    const [x, y] = WORM.seg[i];
    if (wormUnder(x, y)) continue;
    for (let j = 0; j < 7; j++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 200;
      emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp + 50, 0.5 + Math.random() * 0.6, j % 3 ? FLESH : SAND, 0.7, 3 + Math.random() * 5);
    }
  }
  emit(WORM.hx, WORM.hy, 0, 0, 0.25, WHITE, 0, 80);
  if (P.smoke) for (let i = 0; i < 8; i++) emitSmoke(WORM.hx, WORM.hy, (Math.random() - 0.5) * 60, 20 + Math.random() * 40, 1.2 + Math.random(), 8 + Math.random() * 6);
  for (const s of ships) if (s.active) addShake(s, 0.7);
  WORM.state = 'off'; WORM.t = WORM_EVERY;
  wormRoot.visible = false;
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
export function stepWorm(h) {
  for (const s of ships) s.wormT = Math.max(0, (s.wormT || 0) - h);
  if (WORM.state === 'off') {
    WORM.t -= h;
    if (WORM.t <= 0) { WORM.x = pickWormX(); WORM.gy = surfaceY(WORM.x); WORM.state = 'rumble'; WORM.t = WORM_RUMBLE; }
    return;
  }
  if (WORM.state === 'rumble') {
    WORM.t -= h;
    const f = 1 - WORM.t / WORM_RUMBLE;
    if (Math.random() < h * (20 + 60 * f)) {
      emit(WORM.x + (Math.random() - 0.5) * (30 + 50 * f), WORM.gy + 2, (Math.random() - 0.5) * 60, 50 + Math.random() * 150 * (0.4 + f), 0.4 + Math.random() * 0.4, Math.random() < 0.5 ? SAND : SAND_DK, 1, 2 + Math.random() * 4);
    }
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
    sandBurst(WORM.hx, WORM.hy + 4, 40);
    for (const s of ships) if (s.active && Math.abs(s.x - WORM.hx) < 400) addShake(s, 0.5);
  }
  if (Math.random() < h * 25) {   // sand pouring off its back
    const i = 1 + Math.floor(Math.random() * (WORM_N - 1)), [sx, sy] = WORM.seg[i];
    if (!wormUnder(sx, sy)) emit(sx, sy, (Math.random() - 0.5) * 30, -20, 0.8, SAND, 1, 2 + Math.random() * 3);
  }
  let near = false;
  for (const s of ships) {
    if (!s.active || !s.alive) continue;
    const sr = SHIP_RADIUS * P.shipSize * 0.8;
    const dh = Math.hypot(s.x - WORM.hx, s.y - WORM.hy);
    if (dh < 220) near = true;
    if (!headIn && dh < WORM_R * 1.12 + sr) {
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 160;
        emit(s.x, s.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.5, i % 3 ? s.color : WHITE, 0.4, 2 + Math.random() * 4);
      }
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
  if (done || WORM.life > 7) { WORM.state = 'off'; WORM.t = WORM_EVERY; wormRoot.visible = false; }
}
export function drawWorm(a) {
  wormRoot.visible = level.theme === 'desert' && WORM.state === 'fly';
  if (!wormRoot.visible) return;
  for (let i = 0; i < WORM_N; i++) {
    const p = WORM.prev[i], q = WORM.seg[i];
    wormSegs[i].position.x = p[0] + (q[0] - p[0]) * a;
    wormSegs[i].position.y = p[1] + (q[1] - p[1]) * a;
  }
  const head = wormSegs[0];
  head.rotation.z = Math.atan2(WORM.vy, WORM.vx);
  head.userData.mouth.scale.y = 0.35 + 0.65 * WORM.open;
  wormMats.head.color.copy(WORM.flash > 0 ? WHITE : WORM_HEAD);
}
