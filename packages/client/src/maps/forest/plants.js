import * as THREE from 'three';
import { P } from '@rocket-duel/shared/config.js';
import { clamp, mulberry32 } from '@rocket-duel/shared/math.js';
import { H, level, solidAt, W } from '@rocket-duel/shared/level/mask.js';
import { scene } from '../../render/scene.js';
import { emit } from '../../fx/particles.js';

/* ------------------------------------------------------------------ *
 * Forest planet: Jurassic plants and the cyan dinosaur
 * ------------------------------------------------------------------ */
const LEAF = new THREE.Color('#5fbf55');

// Plants: one vertex-coloured mesh per layer, rebuilt when a crater uproots a plant.
const plantMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
function plantLayer(z) {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), plantMat);
  m.position.z = z;
  m.frustumCulled = false;
  m.visible = false;
  scene.add(m);
  return m;
}
export const backPlants = plantLayer(-0.6), frontPlants = plantLayer(0.4);
export function clearPlants() {
  plants.length = 0;
  backPlants.visible = frontPlants.visible = false;
}
export let plants = [];
const PCOL = { trunk: '#5a4128', fern: '#2f8a43', cycad: '#4f9d3f', horse: '#7fae45', node: '#3f5f22', conifer: '#1f5e3c', cone: '#a0663a', back: '#123430' };
const tint = (hex, back, rng) => new THREE.Color(back ? PCOL.back : hex).multiplyScalar(0.85 + rng() * 0.3);
function addTri(b, ax, ay, bx, by, cx, cy, c) {
  b.pos.push(ax, ay, 0, bx, by, 0, cx, cy, 0);
  b.col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
}
export function addStrip(b, pts, ws, c) {
  const n = pts.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], e = pts[Math.min(n - 1, i + 1)];
    let dx = e[0] - a[0], dy = e[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const w = ws[i] / 2;
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
    R.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  for (let i = 0; i < n - 1; i++) {
    addTri(b, L[i][0], L[i][1], R[i][0], R[i][1], R[i + 1][0], R[i + 1][1], c);
    addTri(b, L[i][0], L[i][1], R[i + 1][0], R[i + 1][1], L[i + 1][0], L[i + 1][1], c);
  }
}
export function addBlob(b, cx, cy, rx, ry, c, seg = 10) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    addTri(b, cx, cy, cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, c);
  }
}
// A leaf or frond: a tapering, drooping strip with a serrated edge.
function addLeaf(b, x0, y0, ang, len, droop, width, c, n, serr) {
  const pts = [], ws = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x0 + Math.cos(ang) * len * t, y0 + Math.sin(ang) * len * t - droop * len * t * t]);
    ws.push(width * (1 - 0.9 * t) * (i % 2 ? 1 : serr) + 0.3);
  }
  addStrip(b, pts, ws, c);
}
function treeFern(b, x, y, rng, k, back) {
  const h = (40 + rng() * 55) * k, lean = (rng() - 0.5) * 0.3;
  const pts = [], ws = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push([x + lean * h * t * t, y + h * t]);
    ws.push((6.5 - 2.5 * t) * k);
  }
  addStrip(b, pts, ws, tint(PCOL.trunk, back, rng));
  const [tx, ty] = pts[6];
  for (let j = 0; j < 9; j++) {
    const a = Math.PI * (0.06 + 0.88 * j / 8) + (rng() - 0.5) * 0.15;
    addLeaf(b, tx, ty, a, (26 + rng() * 18) * k, 0.35 + 0.35 * Math.abs(Math.cos(a)), 6 * k, tint(PCOL.fern, back, rng), 16, 0.4);
  }
  addBlob(b, tx, ty, 4 * k, 3 * k, tint(PCOL.node, back, rng), 8);
}
function cycad(b, x, y, rng, k, back) {
  const h = (8 + rng() * 14) * k;
  addStrip(b, [[x, y], [x, y + h]], [12 * k, 10 * k], tint(PCOL.trunk, back, rng));
  for (let j = 0; j < 9; j++) {
    const a = Math.PI * (0.1 + 0.8 * j / 8) + (rng() - 0.5) * 0.12;
    addLeaf(b, x, y + h, a, (20 + rng() * 12) * k, 0.18, 5 * k, tint(PCOL.cycad, back, rng), 12, 0.5);
  }
  addBlob(b, x, y + h + 2 * k, 4 * k, 5 * k, tint(PCOL.cone, back, rng), 8);
}
function horsetails(b, x, y, rng, k, back) {
  const n = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const sx = x + (rng() - 0.5) * 16 * k, h = (26 + rng() * 44) * k, lean = (rng() - 0.5) * 0.25;
    const top = [sx + lean * h, y + h];
    addStrip(b, [[sx, y], top], [2.6 * k, 1.8 * k], tint(PCOL.horse, back, rng));
    const nodeC = tint(PCOL.node, back, rng);
    for (let yy = 7 * k; yy < h - 4 * k; yy += 7 * k) {
      const px = sx + lean * yy, py = y + yy;
      addBlob(b, px, py, 1.9 * k, 0.8 * k, nodeC, 6);
      addTri(b, px, py, px - 5 * k, py + 3 * k, px - 4.5 * k, py + 3.8 * k, nodeC);
      addTri(b, px, py, px + 5 * k, py + 3 * k, px + 4.5 * k, py + 3.8 * k, nodeC);
    }
    addBlob(b, top[0], top[1] + 2.5 * k, 1.7 * k, 3.6 * k, tint(PCOL.cone, back, rng), 8);
  }
}
function araucaria(b, x, y, rng, k, back) {
  const h = (110 + rng() * 90) * k;
  addStrip(b, [[x, y], [x, y + h * 0.5], [x, y + h]], [8 * k, 5.5 * k, 2.5 * k], tint(PCOL.trunk, back, rng));
  const green = tint(PCOL.conifer, back, rng);
  for (let yy = h * 0.45; yy < h; yy += (12 + rng() * 5) * k) {
    const f = (yy - h * 0.45) / (h * 0.55);
    const len = (30 * (1 - f * 0.6) + rng() * 8) * k;
    for (const side of [-1, 1]) {
      const pts = [], ws = [];
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        pts.push([x + side * len * u, y + yy - len * 0.12 * u + len * 0.4 * u * u * u]);
        ws.push((5 - 2.5 * u) * k);
      }
      addStrip(b, pts, ws, green);
      addBlob(b, pts[6][0], pts[6][1] + 1.5 * k, 4 * k, 3.2 * k, green, 8);
    }
  }
  addBlob(b, x, y + h + 2 * k, 6 * k, 5 * k, green, 10);
}
// Exotic plants: helpers
function addDome(b, cx, cy, rx, ry, c, seg = 16) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI, a1 = (i + 1) / seg * Math.PI;
    addTri(b, cx, cy, cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, c);
  }
}
export const pickOf = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const lighter = (c, f) => c.clone().lerp(new THREE.Color('#ffffff'), f);
// Alien palm: a curved, ringed trunk, long drooping fronds in odd colors and glowing fruit.
function alienPalm(b, x, y, rng, k, back) {
  const h = (70 + rng() * 70) * k, bend = (rng() - 0.5) * 0.7;
  const pts = [], ws = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([x + bend * h * t * t, y + h * t]); ws.push((7 - 3 * t) * k); }
  addStrip(b, pts, ws, tint('#6b4a2e', back, rng));
  const ring = tint('#3e2a18', back, rng);
  for (let i = 1; i < 10; i++) addBlob(b, pts[i][0], pts[i][1], ws[i] * 0.55, 1.1 * k, ring, 6);
  const [tx, ty] = pts[10];
  const frond = tint(pickOf(rng, ['#1fb59a', '#d1489c', '#3ccf6e', '#8a4fd8', '#e0a020']), back, rng);
  if (!back) for (let j = 0; j < 4; j++) addBlob(b, tx + (rng() - 0.5) * 10 * k, ty - (2 + rng() * 5) * k, 3 * k, 3.6 * k, new THREE.Color(pickOf(rng, ['#ffd23c', '#ff6f3d', '#7ff0ff'])), 8);
  for (let j = 0; j < 8; j++) {
    const a = Math.PI * (0.02 + 0.96 * j / 7) + (rng() - 0.5) * 0.2;
    addLeaf(b, tx, ty, a, (38 + rng() * 26) * k, 0.55 + 0.4 * Math.abs(Math.cos(a)), 9 * k, frond.clone().multiplyScalar(0.85 + rng() * 0.3), 18, 0.15);
  }
  addBlob(b, tx, ty, 5 * k, 4 * k, ring, 8);
}
// Dragon tree: a stout trunk that forks again and again under a wide umbrella crown.
function dragonTree(b, x, y, rng, k, back) {
  const trunk = tint('#8a6a52', back, rng);
  const h = (40 + rng() * 30) * k;
  addStrip(b, [[x, y], [x, y + h]], [11 * k, 8 * k], trunk);
  const tips = [];
  const branch = (bx, by, ang, len, w, d) => {
    const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
    addStrip(b, [[bx, by], [ex, ey]], [w, w * 0.75], trunk);
    if (d === 0) { tips.push([ex, ey]); return; }
    for (const s of [-1, 1]) branch(ex, ey, ang + s * (0.35 + rng() * 0.25), len * 0.72, w * 0.72, d - 1);
  };
  for (const s of [-1, 1]) branch(x, y + h, Math.PI / 2 + s * (0.45 + rng() * 0.2), 22 * k, 7 * k, 2);
  const crown = tint(pickOf(rng, ['#2e8f5a', '#b83a5e', '#2f9e9a', '#6d8f2a']), back, rng);
  let minX = Infinity, maxX = -Infinity, topY = -Infinity;
  for (const [tx, ty] of tips) { minX = Math.min(minX, tx); maxX = Math.max(maxX, tx); topY = Math.max(topY, ty); }
  const cx = (minX + maxX) / 2, rx = (maxX - minX) / 2 + 14 * k;
  addDome(b, cx, topY - 4 * k, rx, 20 * k, crown, 20);
  addBlob(b, cx, topY - 4 * k, rx, 4 * k, crown.clone().multiplyScalar(0.7), 16);
  for (let i = 0; i < 5; i++) addBlob(b, cx + (rng() - 0.5) * rx * 1.2, topY + (6 + rng() * 6) * k, (8 + rng() * 6) * k, (5 + rng() * 4) * k, crown.clone().multiplyScalar(1.05 + rng() * 0.15), 10);
}
// Spiral tree: a wavy trunk with curling branches that end in bright puffballs.
function spiralTree(b, x, y, rng, k, back) {
  const trunk = tint('#5b3b5e', back, rng);
  const h = (55 + rng() * 45) * k, ph = rng() * 6;
  const pts = [], ws = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([x + Math.sin(t * 7 + ph) * 5 * k * t, y + h * t]); ws.push((6 - 3.5 * t) * k); }
  addStrip(b, pts, ws, trunk);
  const [tx, ty] = pts[12];
  const puff = pickOf(rng, ['#ff6fb5', '#ff8a3d', '#b07cff', '#5fe0c0', '#ffd23c']);
  const n = 3 + Math.floor(rng() * 3);
  for (let j = 0; j < n; j++) {
    const side = j % 2 ? 1 : -1;
    const len = (22 + rng() * 18) * k, cp = [], cw = [];
    let px = tx, py = ty - j * 4 * k, a = Math.PI / 2 + side * (0.3 + rng() * 0.9);
    for (let i = 0; i <= 10; i++) { cp.push([px, py]); cw.push((3 - 2 * i / 10) * k); px += Math.cos(a) * len / 10; py += Math.sin(a) * len / 10; a += side * 0.2; }
    addStrip(b, cp, cw, trunk);
    const c = tint(puff, back, rng), [ex, ey] = cp[10], r = (7 + rng() * 5) * k;
    addBlob(b, ex, ey, r, r, c, 12);
    if (!back) addBlob(b, ex - r * 0.25, ey + r * 0.25, r * 0.5, r * 0.5, lighter(c, 0.35), 10);
  }
  const c = tint(puff, back, rng), r = (10 + rng() * 5) * k;
  addBlob(b, tx, ty + r * 0.6, r, r, c, 14);
  if (!back) addBlob(b, tx - r * 0.25, ty + r * 0.85, r * 0.5, r * 0.5, lighter(c, 0.35), 10);
}
// Giant mushrooms: a big one, sometimes with a couple of little ones beside it. [cap, spots, stem]
const SHROOMS = [['#e8332e', '#fff4e8', '#f2d8c0'], ['#9b4dff', '#f0c6ff', '#e8dcf5'], ['#ff8a2a', '#fff1c2', '#f5e6c8'], ['#22c7b8', '#e6fffb', '#d8efe8'], ['#3d6bff', '#dfe8ff', '#e2e6f2']];
function mushroom(b, x, y, rng, k, back, pal) {
  const cap = tint(pal[0], back, rng), spot = tint(pal[1], back, rng), stem = tint(pal[2], back, rng);
  const h = (45 + rng() * 55) * k, lean = (rng() - 0.5) * 12 * k;
  const pts = [[x, y], [x + lean * 0.3, y + h * 0.5], [x + lean, y + h]];
  addStrip(b, pts, [13 * k, 9 * k, 8 * k], stem);
  addBlob(b, x + lean * 0.6, y + h * 0.72, 9 * k, 2.6 * k, stem.clone().multiplyScalar(0.85), 10);   // ring on the stem
  const [cx, cy] = pts[2];
  const rx = (28 + rng() * 18) * k, ry = rx * (0.5 + rng() * 0.2);
  addBlob(b, cx, cy, rx * 0.92, 4 * k, cap.clone().multiplyScalar(0.55), 16);   // gills underneath
  addDome(b, cx, cy, rx, ry, cap, 20);
  if (back) return;
  addBlob(b, cx - rx * 0.35, cy + ry * 0.62, rx * 0.22, ry * 0.12, lighter(cap, 0.35), 10);   // shine
  const ns = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < ns; i++) {
    const u = Math.PI * (0.15 + 0.7 * rng()), f = 0.35 + rng() * 0.5, r = (2.5 + rng() * 3) * k;
    addBlob(b, cx + Math.cos(u) * rx * f, cy + Math.sin(u) * ry * f, r, r * 0.8, spot, 8);
  }
}
function giantMushroom(b, x, y, rng, k, back) {
  const pal = pickOf(rng, SHROOMS);
  const n = 1 + Math.floor(rng() * 3);
  for (let m = n - 1; m >= 0; m--) {
    const s = m === 0 ? 1 : 0.35 + rng() * 0.25;
    const mx = m === 0 ? x : x + (m % 2 ? 1 : -1) * (16 + rng() * 10) * k;
    mushroom(b, mx, y, rng, k * s, back, pal);
  }
}
const PLANT_KINDS = [[0.12, cycad], [0.22, horsetails], [0.3, treeFern], [0.48, alienPalm], [0.63, dragonTree], [0.79, spiralTree], [1.01, giantMushroom]];
const SMALL_PLANTS = [cycad, horsetails, treeFern];

// World y of the ground top under x (scanning up from the bottom frame).
export function surfaceY(x) {
  const c = clamp(Math.floor(x), 0, W - 1);
  let r = H - 17;
  while (r > 0 && level.mask[r * W + c] !== 0) r--;
  return H - r - 1;
}
export function setLayer(mesh, b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.col), 3));
  mesh.geometry.dispose();
  mesh.geometry = g;
}
export function rebuildFrontPlants() {
  const all = { pos: [], col: [] };
  for (const p of plants) {
    if (!p.alive) continue;
    for (const v of p.buf.pos) all.pos.push(v);
    for (const v of p.buf.col) all.col.push(v);
  }
  setLayer(frontPlants, all);
}
export function buildPlants() {
  const rng = mulberry32((P.seed | 0) * 31 + 5);
  const back = { pos: [], col: [] };
  for (let x = 40; x < W - 40; x += 60 + rng() * 80) {
    pickOf(rng, [alienPalm, dragonTree, giantMushroom, spiralTree, araucaria])(back, x, surfaceY(x) - 30, rng, 1.5 + rng() * 0.6, true);
  }
  setLayer(backPlants, back);
  plants.length = 0;
  for (let x = 30; x < W - 30; x += 26 + rng() * 50) {
    const y = surfaceY(x), r = rng();
    const make = PLANT_KINDS.find((kd) => r < kd[0])[1];
    const buf = { pos: [], col: [] };
    make(buf, x, y - 2, rng, 0.8 + rng() * 0.4, false);
    plants.push({ x, y, alive: true, buf });
  }
  // Smaller trees on the floating islands, leaving the minigun spot clear.
  for (const is of level.islands || []) {
    for (let x = is.x - is.hw + 18; x < is.x + is.hw - 18; x += 24 + rng() * 24) {
      if (Math.abs(x - W / 2) < 34) continue;
      const y = topBelow(x, is.top + 60);
      if (y < is.top - 40) continue;
      const r = rng();
      const make = PLANT_KINDS.find((kd) => r < kd[0])[1];
      const buf = { pos: [], col: [] };
      make(buf, x, y - 2, rng, SMALL_PLANTS.includes(make) ? 0.6 + rng() * 0.25 : 0.45 + rng() * 0.18, false);
      plants.push({ x, y, alive: true, buf });
    }
  }
  rebuildFrontPlants();
}
// World y of the first solid ground at or below (x, y).
export function topBelow(x, y) {
  while (y > 0 && !solidAt(x, y)) y -= 1;
  return y + 1;
}
// A crater under a plant knocks it over in a burst of leaves.
export function plantsAfterCarve(x, y, r) {
  let changed = false;
  for (const p of plants) {
    if (!p.alive || Math.abs(p.x - x) > r + 6 || Math.abs(p.y - y) > r + 8) continue;
    if (solidAt(p.x, p.y - 3)) continue;
    p.alive = false;
    changed = true;
    for (let i = 0; i < 12; i++) emit(p.x + (Math.random() - 0.5) * 16, p.y + Math.random() * 30, (Math.random() - 0.5) * 90, 40 + Math.random() * 90, 0.6 + Math.random() * 0.5, LEAF, 1, 3 + Math.random() * 3);
  }
  if (changed) rebuildFrontPlants();
}
