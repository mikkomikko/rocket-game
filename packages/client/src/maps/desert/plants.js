import * as THREE from 'three';
import { P } from '../../config.js';
import { mulberry32 } from '../../util/math.js';
import { W } from '../../level/mask.js';
import { addBlob, addStrip, backPlants, lighter, pickOf, plants, rebuildFrontPlants, setLayer, surfaceY } from '../forest/plants.js';

/* ------------------------------------------------------------------ *
 * Dune sea: cacti, bones and the giant sandworm
 * ------------------------------------------------------------------ */
export const DESERT_SAND = [222, 170, 112];
export const SAND = new THREE.Color('#e3b47c'), SAND_DK = new THREE.Color('#b98552'), FLESH = new THREE.Color('#ef8a96');
const dcol = (hex, back, rng) => new THREE.Color(back ? '#4c2c46' : hex).multiplyScalar(0.85 + rng() * 0.3);
function saguaro(b, x, y, rng, k, back) {
  const c = dcol('#3f8f52', back, rng), rib = back ? c : lighter(c, 0.2);
  const h = (70 + rng() * 60) * k, w = 12 * k;
  const arms = 1 + Math.floor(rng() * 2.4);
  for (let j = 0; j < arms; j++) {
    const s = j % 2 ? 1 : -1, ay = y + h * (0.32 + rng() * 0.3), up = (20 + rng() * 18) * k;
    addStrip(b, [[x, ay], [x + s * 10 * k, ay], [x + s * 16 * k, ay + 6 * k], [x + s * 16 * k, ay + up]], [9 * k, 9 * k, 9 * k, 8 * k], c);
    addBlob(b, x + s * 16 * k, ay + up, 4 * k, 4 * k, c, 10);
  }
  addStrip(b, [[x, y], [x, y + h]], [w, w * 0.9], c);
  addBlob(b, x, y + h, w * 0.45, w * 0.45, c, 12);
  if (back) return;
  for (const o of [-2.8, 0, 2.8]) addStrip(b, [[x + o * k, y + 4 * k], [x + o * k, y + h - 2 * k]], [1.3 * k, 1.1 * k], rib);
  if (rng() < 0.5) addBlob(b, x, y + h + 4 * k, 3.5 * k, 2.6 * k, new THREE.Color(pickOf(rng, ['#ff6fb5', '#fff1a8', '#ff8a3d'])), 10);
}
function pricklyPear(b, x, y, rng, k, back) {
  const c = dcol('#5aa05a', back, rng);
  const pads = [[0, 11, 8, 11]];
  const n = 2 + Math.floor(rng() * 3);
  for (let j = 0; j < n; j++) {
    const p = pads[Math.floor(rng() * pads.length)];
    const s = rng() < 0.5 ? -1 : 1;
    pads.push([p[0] + s * p[2] * (0.5 + rng() * 0.4), p[1] + p[3] * (0.8 + rng() * 0.3), p[2] * 0.85, p[3] * 0.85]);
  }
  for (const [px, py, rx, ry] of pads) {
    addBlob(b, x + px * k, y + py * k, rx * k, ry * k, c.clone().multiplyScalar(0.9 + rng() * 0.2), 14);
    if (!back) for (let q = 0; q < 3; q++) addBlob(b, x + (px + (rng() - 0.5) * rx) * k, y + (py + (rng() - 0.5) * ry) * k, 0.7 * k, 0.7 * k, new THREE.Color('#e9f2c8'), 5);
  }
  if (!back) for (const [px, py, , ry] of pads.slice(1)) if (rng() < 0.6) addBlob(b, x + px * k, y + (py + ry) * k, 2.2 * k, 2.8 * k, new THREE.Color('#e8334e'), 8);
}
function barrelCactus(b, x, y, rng, k, back) {
  const n = 1 + Math.floor(rng() * 3);
  for (let j = 0; j < n; j++) {
    const s = (j === 0 ? 1 : 0.6 + rng() * 0.25) * k, bx = x + (j === 0 ? 0 : (j % 2 ? 1 : -1) * 14 * k);
    const c = dcol('#4f9a5e', back, rng);
    addBlob(b, bx, y + 10 * s, 10 * s, 12 * s, c, 16);
    if (back) continue;
    for (const o of [-5, 0, 5]) addStrip(b, [[bx + o * s, y + 1 * s], [bx + o * 0.8 * s, y + 20 * s]], [1.2 * s, 1.2 * s], lighter(c, 0.22));
    addBlob(b, bx, y + 21 * s, 4.5 * s, 2.5 * s, new THREE.Color(pickOf(rng, ['#ffd23c', '#ff8a3d', '#ff5a7a'])), 10);
  }
}
function dryShrub(b, x, y, rng, k, back) {
  const c = dcol('#8a6a44', back, rng);
  for (let j = 0; j < 9; j++) {
    const a = Math.PI * (0.15 + 0.7 * rng()), len = (14 + rng() * 16) * k;
    const mx = x + Math.cos(a) * len * 0.5, my = y + Math.sin(a) * len * 0.5;
    addStrip(b, [[x, y], [mx, my], [x + Math.cos(a + 0.2) * len, y + Math.sin(a + 0.2) * len]], [2 * k, 1.4 * k, 0.6 * k], c);
    addStrip(b, [[mx, my], [mx + Math.cos(a - 0.6) * len * 0.4, my + Math.sin(a - 0.6) * len * 0.4]], [1.1 * k, 0.5 * k], c);
  }
}
// The bones of a long-dead sandworm: a spine with ribs arching over the sand and a big round skull.
function wormBones(b, x, y, rng, k, back) {
  const c = dcol('#efe4cc', back, rng), dark = back ? c : c.clone().multiplyScalar(0.75);
  const len = (90 + rng() * 40) * k, n = 6, s = rng() < 0.5 ? -1 : 1;
  const sp = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; sp.push([x - s * len / 2 + s * len * t, y + 3 * k + Math.sin(t * Math.PI) * 6 * k]); }
  for (let j = 0; j < n; j++) {
    const t = (j + 1) / (n + 1), rx = x - s * len / 2 + s * len * t, hgt = (30 - 12 * Math.abs(t - 0.4)) * k, wd = 9 * k;
    const pts = [];
    for (let i = 0; i <= 8; i++) { const u = i / 8 * Math.PI; pts.push([rx - Math.cos(u) * wd, y + Math.sin(u) * hgt]); }
    addStrip(b, pts, pts.map(() => 3 * k), c);
  }
  addStrip(b, sp, sp.map(() => 4 * k), dark);
  const hx = x + s * (len / 2 + 10 * k);
  addBlob(b, hx, y + 11 * k, 14 * k, 11 * k, c, 16);
  if (back) return;
  addBlob(b, hx + s * 8 * k, y + 9 * k, 4.5 * k, 6 * k, new THREE.Color('#3a2230'), 12);
  addBlob(b, hx - s * 2 * k, y + 14 * k, 2.4 * k, 2.4 * k, new THREE.Color('#3a2230'), 8);
}
function rockSpire(b, x, y, rng, k, back) {
  const h = (120 + rng() * 120) * k, w = (24 + rng() * 14) * k;
  const pts = [], ws = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([x + Math.sin(t * 3 + x) * 4 * k, y + h * t]); ws.push(w * (1 - 0.55 * t) * (i % 2 ? 1 : 0.88)); }
  addStrip(b, pts, ws, dcol('#9a5a44', back, rng));
  addBlob(b, pts[6][0], pts[6][1], ws[6] * 0.7, 5 * k, dcol('#9a5a44', back, rng), 10);
}
const DESERT_KINDS = [[0.3, saguaro], [0.48, barrelCactus], [0.66, pricklyPear], [0.9, dryShrub], [1.01, wormBones]];
export function buildDesertPlants() {
  const rng = mulberry32((P.seed | 0) * 37 + 11);
  const back = { pos: [], col: [] };
  for (let x = 40; x < W - 40; x += 70 + rng() * 90) {
    pickOf(rng, [saguaro, saguaro, rockSpire, rockSpire, wormBones])(back, x, surfaceY(x) - 30, rng, 1.5 + rng() * 0.6, true);
  }
  setLayer(backPlants, back);
  plants.length = 0;
  let bones = 0;
  for (let x = 30; x < W - 30; x += 34 + rng() * 60) {
    const y = surfaceY(x), r = rng();
    let make = DESERT_KINDS.find((kd) => r < kd[0])[1];
    if (make === wormBones && bones++ >= 2) make = dryShrub;
    const buf = { pos: [], col: [] };
    make(buf, x, y - 2, rng, 0.8 + rng() * 0.4, false);
    plants.push({ x, y, alive: true, buf });
  }
  rebuildFrontPlants();
}
