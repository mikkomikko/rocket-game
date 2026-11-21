import * as THREE from 'three';
import { P } from '@rocket-duel/shared/config.js';
import { onSim } from '@rocket-duel/shared/events.js';
import { level } from '@rocket-duel/shared/level/mask.js';
import { WORM, WORM_N, WORM_RUMBLE, wormR, wormUnder } from '@rocket-duel/shared/maps/desert.js';
import { scene } from '../../render/scene.js';
import { shapeGeo, views } from '../../ships/view.js';
import { WHITE } from '../../fx/pools.js';
import { emit } from '../../fx/particles.js';
import { emitSmoke } from '../../fx/smoke.js';
import { FLESH, SAND, SAND_DK } from './plants.js';

// The sandworm as drawn: a chain of flat circles behind the terrain, and the sand and flesh it throws.
// It runs in @rocket-duel/shared/maps/desert.js.
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
export function hideWorm() { wormRoot.visible = false; }
function sandBurst(x, y, n, up = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.1 + 0.8 * Math.random()), sp = 60 + Math.random() * 260;
    emit(x + (Math.random() - 0.5) * 40, y, Math.cos(a) * sp, Math.sin(a) * sp * up, 0.6 + Math.random() * 0.7, i % 4 ? SAND : SAND_DK, 1, 3 + Math.random() * 5);
  }
}

// What the simulation reports (@rocket-duel/shared/maps/desert.js): bursting out, diving in, meals and wounds.
onSim('wormBurst', (x, gy) => {
  sandBurst(x, gy, 60);
  if (P.smoke) for (let i = 0; i < 6; i++) emitSmoke(x + (Math.random() - 0.5) * 50, gy + 10, (Math.random() - 0.5) * 60, 30 + Math.random() * 40, 1.4 + Math.random(), 9 + Math.random() * 6);
});
onSim('wormDive', (x, y) => sandBurst(x, y, 40));
onSim('wormAte', (s, x, y) => {
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 160;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.5, i % 3 ? views[s.id].color : WHITE, 0.4, 2 + Math.random() * 4);
  }
});
onSim('wormHurt', (x, y) => {
  for (let i = 0; i < 10; i++) emit(x, y, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.4, i % 2 ? FLESH : WHITE, 0.5, 3 + Math.random() * 3);
});
onSim('wormKilled', (hx, hy) => {
  for (let i = 0; i < WORM_N; i += 2) {
    const [x, y] = WORM.seg[i];
    if (wormUnder(x, y)) continue;
    for (let j = 0; j < 7; j++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 200;
      emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp + 50, 0.5 + Math.random() * 0.6, j % 3 ? FLESH : SAND, 0.7, 3 + Math.random() * 5);
    }
  }
  emit(hx, hy, 0, 0, 0.25, WHITE, 0, 80);
  if (P.smoke) for (let i = 0; i < 8; i++) emitSmoke(hx, hy, (Math.random() - 0.5) * 60, 20 + Math.random() * 40, 1.2 + Math.random(), 8 + Math.random() * 6);
  wormRoot.visible = false;
});
onSim('wormThud', (x, y) => {
  for (let j = 0; j < 5; j++) emit(x, y, (Math.random() - 0.5) * 120, Math.random() * 100, 0.4, SAND, 1, 2 + Math.random() * 3);
});
// Looks each step: sand bubbling up while it rumbles, and pouring off its back while it flies.
export function wormLooks(h) {
  if (WORM.state === 'rumble') {
    const f = 1 - WORM.t / WORM_RUMBLE;
    if (Math.random() < h * (20 + 60 * f)) {
      emit(WORM.x + (Math.random() - 0.5) * (30 + 50 * f), WORM.gy + 2, (Math.random() - 0.5) * 60, 50 + Math.random() * 150 * (0.4 + f), 0.4 + Math.random() * 0.4, Math.random() < 0.5 ? SAND : SAND_DK, 1, 2 + Math.random() * 4);
    }
  } else if (WORM.state === 'fly' && Math.random() < h * 25) {
    const i = 1 + Math.floor(Math.random() * (WORM_N - 1)), [sx, sy] = WORM.seg[i];
    if (!wormUnder(sx, sy)) emit(sx, sy, (Math.random() - 0.5) * 30, -20, 0.8, SAND, 1, 2 + Math.random() * 3);
  }
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
