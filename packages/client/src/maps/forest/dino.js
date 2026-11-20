import * as THREE from 'three';
import { P } from '../../config.js';
import { approach, clamp } from '../../util/math.js';
import { level, solidAt, W } from '../../level/mask.js';
import { scene } from '../../render/scene.js';
import { shapeGeo, SHIP_RADIUS, ships } from '../../ships/ship.js';
import { addShake, kill } from '../../ships/physics.js';
import { DUST, WHITE } from '../../fx/pools.js';
import { emit } from '../../fx/particles.js';
import { emitSmoke } from '../../fx/smoke.js';
import { groundRGB } from './plants.js';

// The dinosaur: a small cyan T-rex with black eyes, built from flat shapes. Faces +x; feet at y = 0.
export const DINO_S = 0.85, DINO_SPEED = 330, DINO_EVERY = 10;
const dinoMats = {};
for (const [k, hex] of Object.entries({ body: '#2fe6f0', far: '#1aa3b4', stripe: '#1cb8c8', mouth: '#0b3640', eye: '#000000', tooth: '#f4fbff' })) {
  dinoMats[k] = new THREE.MeshBasicMaterial({ color: hex, transparent: true, side: THREE.DoubleSide });
}
function smoothGeo(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  s.splineThru(pts.slice(1).map((p) => new THREE.Vector2(p[0], p[1])));
  return new THREE.ShapeGeometry(s, 4);
}
function dMesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, dinoMats[mat]);
  m.position.set(x, y, z);
  return m;
}
function makeDinoLeg(mat, z) {
  const hip = new THREE.Group();
  hip.position.set(-2, 30, z);
  hip.add(dMesh(smoothGeo([[-7, 3], [0, 8], [7, 3], [6, -7], [3, -15], [-1, -16], [-5, -9], [-7, 3]]), mat));
  const knee = new THREE.Group();
  knee.position.set(1, -14, 0.001);
  knee.add(dMesh(shapeGeo([[-3, 1], [2.5, 1], [2.5, -12], [-1.5, -13]]), mat));
  const ankle = new THREE.Group();
  ankle.position.set(0.5, -12.5, 0.002);
  ankle.add(dMesh(shapeGeo([[-2.5, 1.5], [2, 1.5], [9, -1], [10, -3], [-3, -3]]), mat));
  knee.add(ankle);
  hip.add(knee);
  return { hip, knee, ankle };
}
const dinoRoot = new THREE.Group();
dinoRoot.visible = false;
scene.add(dinoRoot);
const dinoRig = new THREE.Group();
dinoRoot.add(dinoRig);
const dinoLegs = [makeDinoLeg('far', -0.03), makeDinoLeg('body', 0.03)];
const DINO_ARM = [[0, 0], [5, -3], [7, -6], [5, -7], [3, -4], [-1, -2]];
const dinoArms = [dMesh(shapeGeo(DINO_ARM), 'far', 21, 38, -0.02), dMesh(shapeGeo(DINO_ARM), 'body', 18, 37, 0.04)];
const dinoTorso = dMesh(smoothGeo([[-50, 31], [-34, 36], [-16, 41], [0, 45], [12, 48], [20, 54], [27, 52], [24, 42], [16, 32], [6, 26], [-6, 25], [-20, 28], [-36, 30], [-50, 31]]), 'body');
const dinoStripes = [[-34, 33.5, 3.2], [-22, 37, 3.6], [-10, 40.5, 3.8], [2, 43, 3.4]].map(([x, y, r]) => {
  const m = dMesh(new THREE.CircleGeometry(r, 12), 'stripe', x, y, 0.005);
  m.scale.y = 0.55;
  return m;
});
const dinoHead = new THREE.Group();
dinoHead.position.set(22, 50, 0.01);
dinoHead.add(dMesh(smoothGeo([[-6, 4], [0, 11], [10, 13], [19, 10], [23, 6], [22, 2], [12, 1], [2, 0], [-5, -2], [-6, 4]]), 'body'));
dinoHead.add(dMesh(shapeGeo([[3, 1.5], [22, 2], [20, -6], [6, -5]]), 'mouth', 0, 0, -0.005));
dinoHead.add(dMesh(new THREE.CircleGeometry(2.4, 16), 'eye', 9, 8, 0.01));
dinoHead.add(dMesh(new THREE.CircleGeometry(0.8, 8), 'mouth', 20, 7, 0.01));
for (let x = 8; x <= 20; x += 3) dinoHead.add(dMesh(shapeGeo([[x, 1.4], [x + 1.6, 1.4], [x + 0.8, -1.5]]), 'tooth', 0, 0, 0.004));
const dinoJaw = new THREE.Group();
dinoJaw.position.set(4, 0.5, 0.008);
dinoJaw.add(dMesh(smoothGeo([[-1, 0.8], [8, 0.9], [17, 0.8], [16, -2], [8, -5], [0, -4], [-2, -1], [-1, 0.8]]), 'body'));
for (let x = 5; x <= 15; x += 3) dinoJaw.add(dMesh(shapeGeo([[x, 0.6], [x + 1.4, 0.6], [x + 0.7, 2.6]]), 'tooth', 0, 0, -0.001));
dinoHead.add(dinoJaw);
dinoRig.add(dinoLegs[0].hip, dinoArms[0], dinoTorso, ...dinoStripes, dinoHead, dinoLegs[1].hip, dinoArms[1]);
// Rare mushroom dino (every fifth run): white dots, little mushrooms growing on its back and a mushroom hat.
for (const [k, hex] of Object.entries({ dot: '#ffffff', shCap: '#e8332e', shStem: '#f2e3c6', sh1: '#ff8a2a', sh2: '#9b4dff', sh3: '#22c7b8' })) {
  dinoMats[k] = new THREE.MeshBasicMaterial({ color: hex, transparent: true, side: THREE.DoubleSide });
}
const domeGeo = (r) => new THREE.CircleGeometry(r, 18, 0, Math.PI);
function tinyShroom(x, y, h, r, cap, tilt) {
  const g = new THREE.Group();
  g.position.set(x, y, 0.006); g.rotation.z = tilt;
  g.add(dMesh(shapeGeo([[-1.1, -1], [1.1, -1], [0.9, h], [-0.9, h]]), 'shStem'));
  const c = dMesh(domeGeo(r), cap, 0, h, 0.002); c.scale.y = 0.75; g.add(c);
  g.add(dMesh(new THREE.CircleGeometry(r * 0.22, 8), 'dot', -r * 0.35, h + r * 0.35, 0.004));
  g.add(dMesh(new THREE.CircleGeometry(r * 0.16, 8), 'dot', r * 0.3, h + r * 0.2, 0.004));
  return g;
}
const dinoShroom = new THREE.Group();
dinoShroom.visible = false;
for (const [x, y, r] of [[-40, 32, 1.3], [-28, 33.5, 1.8], [-14, 34, 2.1], [0, 37, 2.4], [-6, 30, 1.5], [12, 39, 1.9], [8, 44, 1.5]]) dinoShroom.add(dMesh(new THREE.CircleGeometry(r, 12), 'dot', x, y, 0.007));
dinoShroom.add(tinyShroom(-44, 31, 5, 4, 'sh1', 0.25), tinyShroom(-30, 34.5, 8, 6, 'sh2', 0.1), tinyShroom(-15, 39, 6, 5, 'sh3', -0.05), tinyShroom(-2, 43.5, 9, 6.5, 'sh1', -0.15));
dinoRig.add(dinoShroom);
const dinoHat = new THREE.Group();
dinoHat.position.set(10, 12.5, 0.02); dinoHat.rotation.z = 0.12; dinoHat.visible = false;
const hatGills = dMesh(new THREE.CircleGeometry(11, 16), 'shStem', 0, 0, -0.002); hatGills.scale.y = 0.16;
const hatCap = dMesh(domeGeo(13), 'shCap'); hatCap.scale.y = 0.8;
dinoHat.add(hatGills, hatCap);
for (const [x, y, r] of [[-6, 4, 1.8], [0, 7.5, 2.2], [6, 3.5, 1.9], [-1.5, 2.2, 1.1], [9.5, 1.3, 1]]) dinoHat.add(dMesh(new THREE.CircleGeometry(r, 10), 'dot', x, y, 0.003));
dinoHead.add(dinoHat);

export const DINO = { active: false, x: 0, y: 0, px: 0, py: 0, dir: -1, next: 4, phase: 0, open: 0.1, chew: 0, burp: 0, alpha: 0 };
export function resetDino() {
  DINO.active = false; DINO.next = 4; DINO.chew = 0; DINO.burp = 0;
  dinoRoot.visible = false;
  dinoCount = 0;
}
function groundUnder(x, y) {
  if (solidAt(x, y)) { for (let k = 0; k < 120 && solidAt(x, y); k++) y += 1; return y; }
  for (let k = 0; k < 900 && y > 0 && !solidAt(x, y - 1); k++) y -= 1;
  return y;
}
const dinoMouth = () => ({ x: DINO.x + DINO.dir * 46 * DINO_S, zx: DINO.x + DINO.dir * 54 * DINO_S, y: DINO.y + 53 * DINO_S });
function eatShip(s, m) {
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 160;
    emit(m.zx, m.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.5, i % 3 ? s.color : WHITE, 0.4, 2 + Math.random() * 4);
  }
  kill(s, true);
  addShake(s, 1.4);
  DINO.open = 0; DINO.chew = 0.7; DINO.burp = 0.9;
}
// One shot kills the dino: is the point (x, y) inside its body?
const DINO_COL = new THREE.Color('#2fe6f0');
// Each run the dino gets a new color: [body, far side, stripes, eye].
const DINO_PALETTES = [
  ['#ff4a4a', '#c22a2a', '#a51d1d', '#000000'],   // red
  ['#2fe6f0', '#1aa3b4', '#1cb8c8', '#000000'],   // cyan
  ['#4fdc5a', '#2e9e3a', '#2a8a34', '#000000'],   // green
  ['#2a2a2e', '#141416', '#46464f', '#ffd23c'],   // black (yellow eyes so you can see them)
  ['#f4f4f6', '#c4c4ca', '#d2d2d8', '#000000'],   // white
  ['#3d7bff', '#2552c2', '#2a5ad8', '#000000'],   // blue
  ['#a85cff', '#7434c4', '#8440d8', '#000000'],   // purple
  ['#9a9aa2', '#6c6c74', '#7e7e86', '#000000'],   // grey
  ['#ff9a2e', '#c96a14', '#d4761c', '#000000'],   // orange
];
const RARE_PAL = ['#d8342c', '#9e2420', '#d8342c', '#000000'];   // mushroom red, stripes hidden under the dots
let dinoPal = 1, dinoCount = 0;
function recolorDino() {
  dinoCount++;
  const rare = dinoCount % 5 === 0;
  dinoShroom.visible = dinoHat.visible = rare;
  if (!rare) {
    let k = Math.floor(Math.random() * (DINO_PALETTES.length - 1));
    if (k >= dinoPal) k++;   // never the same color twice in a row
    dinoPal = k;
  }
  const [body, far, stripe, eye] = rare ? RARE_PAL : DINO_PALETTES[dinoPal];
  dinoMats.body.color.set(body); dinoMats.far.color.set(far);
  dinoMats.stripe.color.set(stripe); dinoMats.eye.color.set(eye);
  DINO_COL.set(body);
}
export function dinoHit(x, y) {
  if (level.theme !== 'forest' || !DINO.active || DINO.alpha < 0.3) return false;
  const lx = (x - DINO.x) * DINO.dir / DINO_S, ly = (y - DINO.y) / DINO_S;
  return lx > -52 && lx < 48 && ly > -2 && ly < 76;
}
export function killDino() {
  const cx = DINO.x - DINO.dir * 4 * DINO_S, cy = DINO.y + 36 * DINO_S;
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 220;
    emit(cx + (Math.random() - 0.5) * 50 * DINO_S, cy + (Math.random() - 0.5) * 40 * DINO_S, Math.cos(a) * sp, Math.sin(a) * sp + 60, 0.5 + Math.random() * 0.6, i % 3 ? DINO_COL : WHITE, 0.6, 3 + Math.random() * 4);
  }
  emit(cx, cy, 0, 0, 0.2, WHITE, 0, 60);
  if (P.smoke) for (let i = 0; i < 8; i++) emitSmoke(cx, cy, (Math.random() - 0.5) * 60, 20 + Math.random() * 40, 1.2 + Math.random(), 8 + Math.random() * 6);
  for (const s of ships) if (s.active) addShake(s, 0.5);
  DINO.active = false; DINO.chew = 0; DINO.burp = 0;
  dinoRoot.visible = false;
}
export function stepDino(h) {
  // A new run starts every DINO_EVERY seconds, alternating left and right.
  DINO.next -= h;
  if (DINO.next <= 0) {
    DINO.next += DINO_EVERY;
    DINO.dir = -DINO.dir;
    DINO.x = DINO.dir > 0 ? 24 : W - 24;
    DINO.y = groundUnder(DINO.x, 420);
    DINO.px = DINO.x; DINO.py = DINO.y;
    DINO.phase = 0; DINO.open = 0.1; DINO.chew = 0; DINO.alpha = 0;
    DINO.active = true;
    recolorDino();
  }
  if (DINO.burp > 0) {
    DINO.burp -= h;
    if (DINO.burp <= 0 && DINO.active) {
      const m = dinoMouth();
      for (let i = 0; i < 6; i++) emitSmoke(m.zx, m.y, DINO.dir * (20 + Math.random() * 30), 10 + Math.random() * 20, 1.6 + Math.random(), 6 + Math.random() * 5);
    }
  }
  if (!DINO.active) return;
  DINO.px = DINO.x; DINO.py = DINO.y;
  DINO.x += DINO.dir * DINO_SPEED * h;
  DINO.phase += h * 15;
  const target = groundUnder(DINO.x, DINO.y + 24);
  DINO.y += (target - DINO.y) * Math.min(1, h * 25);
  const fromWall = DINO.dir > 0 ? DINO.x - 16 : W - 16 - DINO.x;
  const toWall = DINO.dir > 0 ? W - 16 - DINO.x : DINO.x - 16;
  DINO.alpha = clamp(Math.min(fromWall, toWall) / 60, 0, 1);
  if (toWall <= 0) { DINO.active = false; return; }
  if (Math.random() < h * 18) {
    const g = groundRGB(DINO.y);
    DUST.setRGB(g[0] / 255 * 1.6, g[1] / 255 * 1.6, g[2] / 255 * 1.6, THREE.SRGBColorSpace);
    emit(DINO.x - DINO.dir * 8, DINO.y + 2, -DINO.dir * (30 + Math.random() * 50), 20 + Math.random() * 40, 0.4 + Math.random() * 0.3, DUST, 1, 3 + Math.random() * 3);
  }
  // Jaws open wide when a rocket is ahead; anything right in front of the mouth gets eaten.
  const m = dinoMouth();
  let threat = false;
  for (const s of ships) {
    if (!s.active || !s.alive) continue;
    const ahead = (s.x - m.x) * DINO.dir;
    if (ahead > -12 && ahead < 170 && Math.abs(s.y - m.y) < 80) threat = true;
    const R = 16 * DINO_S + SHIP_RADIUS * P.shipSize * 0.8;
    if (DINO.alpha > 0.5 && (s.x - m.zx) ** 2 + (s.y - m.y) ** 2 < R * R) eatShip(s, m);
  }
  if (DINO.chew > 0) { DINO.chew -= h; DINO.open = 0.12 * Math.abs(Math.sin(DINO.chew * 28)); }
  else DINO.open = approach(DINO.open, threat ? 0.75 : 0.1 + 0.06 * Math.sin(DINO.phase * 0.5), h * 6);
}

function poseDinoLeg(L, ph) {
  const s = Math.sin(ph), c = Math.cos(ph);
  L.hip.rotation.z = 0.25 + s * 0.65;
  L.knee.rotation.z = -0.55 - Math.max(0, c) * 0.7;
  L.ankle.rotation.z = -(L.hip.rotation.z + L.knee.rotation.z) - 0.1 + Math.max(0, -c) * 0.4;
}
export function drawDino(a) {
  dinoRoot.visible = DINO.active;
  if (!DINO.active) return;
  dinoRoot.position.set(DINO.px + (DINO.x - DINO.px) * a, DINO.py + (DINO.y - DINO.py) * a, 0.95);
  dinoRoot.scale.set(DINO.dir * DINO_S, DINO_S, 1);
  const ph = DINO.phase;
  poseDinoLeg(dinoLegs[1], ph);
  poseDinoLeg(dinoLegs[0], ph + Math.PI);
  dinoRig.position.y = Math.abs(Math.sin(ph)) * 2 - 1;
  dinoRig.rotation.z = 0.03 * Math.sin(ph * 2);
  dinoArms[0].rotation.z = 0.3 * Math.sin(ph + 1);
  dinoArms[1].rotation.z = 0.3 * Math.sin(ph + 1 + Math.PI);
  dinoHead.rotation.z = 0.05 * Math.sin(ph * 2) + DINO.open * 0.3;
  dinoJaw.rotation.z = -DINO.open;
  for (const mat of Object.values(dinoMats)) mat.opacity = DINO.alpha;
}
