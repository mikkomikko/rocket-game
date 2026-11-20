import * as THREE from 'three';
import { clamp } from '../util/math.js';
import { level, maskAt, solidAt } from '../level/mask.js';
import { scene } from '../render/scene.js';
import { EMBER, pointScale, WHITE } from './pools.js';
import { emit } from './particles.js';
import { groundRGB } from '../maps/forest/plants.js';

/* ------------------------------------------------------------------ *
 * Terrain debris: solid bits (normal blending, so dark rock still shows) that fly, bounce and settle,
 * plus soft dust puffs. Each terrain type breaks differently:
 *   rock  - angular chunks that bounce and settle, fine grit and a violet dust cloud
 *   soil  - (forest) dirt clumps that thud down, leaf bits that flutter off grassy tops
 *   sand  - (desert) a spray of fine grains that sink in where they land, and a big sandy haze
 *   metal - (Floors, Starship, hard walls and pads) hot sparks and a few bouncing steel flakes
 * ------------------------------------------------------------------ */
const MAXD = 3200;
// Overall debris tuning: how many bits each hit throws out, and how big they are (puffs grow less).
const DEBRIS_AMOUNT = 2, DEBRIS_SIZE = 1.7, PUFF_SIZE = 1.3;
export const DB = {
  x: new Float32Array(MAXD), y: new Float32Array(MAXD), vx: new Float32Array(MAXD), vy: new Float32Array(MAXD),
  life: new Float32Array(MAXD), max: new Float32Array(MAXD), g: new Float32Array(MAXD), sz: new Float32Array(MAXD),
  r: new Float32Array(MAXD), gr: new Float32Array(MAXD), b: new Float32Array(MAXD),
  rot: new Float32Array(MAXD), spin: new Float32Array(MAXD), shape: new Uint8Array(MAXD),
  rest: new Float32Array(MAXD), bn: new Int8Array(MAXD), flut: new Float32Array(MAXD), stuck: new Uint8Array(MAXD),
  on: new Uint8Array(MAXD), cursor: 0,
};
const debGeo = new THREE.BufferGeometry();
debGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXD * 3), 3));
debGeo.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(MAXD * 3), 3));
for (const k of ['size', 'alpha', 'rot', 'shape']) debGeo.setAttribute(k, new THREE.BufferAttribute(new Float32Array(MAXD), 1));
const debPts = new THREE.Points(debGeo, new THREE.ShaderMaterial({
  uniforms: { uScale: pointScale },
  vertexShader: `
attribute float size; attribute vec3 tint; attribute float alpha; attribute float rot; attribute float shape;
uniform float uScale;
varying vec3 vTint; varying float vAlpha; varying float vRot; varying float vShape;
void main() {
  vTint = tint; vAlpha = alpha; vRot = rot; vShape = shape;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale;
}`,
  fragmentShader: `
varying vec3 vTint; varying float vAlpha; varying float vRot; varying float vShape;
void main() {
  vec2 p = gl_PointCoord - 0.5; p.y = -p.y;
  float c = cos(vRot), s = sin(vRot);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float light = 0.72 + 0.9 * (p.y - 0.45 * p.x);   // lit from above, like the terrain
  vec3 col = vTint; float a = 1.0;
  if (vShape < 0.5) {            // rock chunk: a rotated, lopsided shard with a cut corner
    vec2 k = abs(q) * vec2(1.0, 1.4);
    if (max(k.x, k.y) + 0.3 * max(q.x + q.y, 0.0) > 0.42) discard;
    col *= light;
  } else if (vShape < 1.5) {     // dirt clump
    if (length(q * vec2(1.0, 1.25)) > 0.45) discard;
    col *= light;
  } else if (vShape < 2.5) {     // leaf
    if (length(q * vec2(1.0, 2.8)) > 0.46) discard;
    col *= 0.85 + 0.45 * q.x;
  } else if (vShape < 3.5) {     // grain
    if (length(p) > 0.45) discard;
    col *= 0.8 + 0.5 * p.y;
  } else {                       // dust puff
    a = 1.0 - smoothstep(0.0, 0.5, length(p)); a *= a;
  }
  gl_FragColor = vec4(col, a * vAlpha);
  #include <colorspace_fragment>
}`,
  transparent: true,
  depthWrite: false,
}));
debPts.frustumCulled = false;
debPts.position.z = 0.9;
scene.add(debPts);

const DEB_COL = new THREE.Color();
function debris(x, y, vx, vy, life, rgb, shape, size, g, rest = 0, bounces = 0, flut = 0) {
  const i = DB.cursor;
  DB.cursor = (DB.cursor + 1) % MAXD;
  DEB_COL.setRGB(clamp(rgb[0], 0, 1), clamp(rgb[1], 0, 1), clamp(rgb[2], 0, 1), THREE.SRGBColorSpace);
  DB.on[i] = 1; DB.stuck[i] = 0;
  DB.x[i] = x; DB.y[i] = y; DB.vx[i] = vx; DB.vy[i] = vy;
  DB.life[i] = life; DB.max[i] = life; DB.g[i] = g; DB.sz[i] = size * (shape === 4 ? PUFF_SIZE : DEBRIS_SIZE);
  DB.r[i] = DEB_COL.r; DB.gr[i] = DEB_COL.g; DB.b[i] = DEB_COL.b;
  DB.rot[i] = Math.random() * 6.283; DB.spin[i] = (Math.random() - 0.5) * 24;
  DB.shape[i] = shape; DB.rest[i] = rest; DB.bn[i] = bounces; DB.flut[i] = flut;
}
export function stepTerrainBits(h) {
  const air = Math.exp(-0.5 * h), leafAir = Math.exp(-2.6 * h), puffAir = Math.exp(-2.2 * h);
  for (let i = 0; i < MAXD; i++) {
    if (!DB.on[i]) continue;
    DB.life[i] -= h;
    if (DB.life[i] <= 0) { DB.on[i] = 0; continue; }
    if (DB.shape[i] === 4) {   // puffs drift, slow down and rise a little
      DB.vx[i] *= puffAir; DB.vy[i] *= puffAir; DB.vy[i] += 8 * h;
      DB.x[i] += DB.vx[i] * h; DB.y[i] += DB.vy[i] * h;
      continue;
    }
    if (DB.stuck[i]) { if (!solidAt(DB.x[i], DB.y[i] - 1.5)) DB.stuck[i] = 0; else continue; }   // falls again if its ledge is shot away
    if (DB.flut[i]) {          // leaves sway from side to side as they sink
      DB.vx[i] = DB.vx[i] * leafAir + Math.sin(DB.life[i] * 6 + i) * DB.flut[i] * h;
      DB.vy[i] *= leafAir;
    } else { DB.vx[i] *= air; DB.vy[i] *= air; }
    DB.vy[i] -= DB.g[i] * h;
    const nx = DB.x[i] + DB.vx[i] * h, ny = DB.y[i] + DB.vy[i] * h;
    if (solidAt(nx, ny)) {
      if (DB.bn[i] > 0) {
        DB.bn[i]--;
        if (solidAt(nx, DB.y[i])) { DB.vx[i] = -DB.vx[i] * DB.rest[i]; DB.vy[i] *= 0.7; }
        if (solidAt(DB.x[i], ny)) { DB.vy[i] = -DB.vy[i] * DB.rest[i]; DB.vx[i] *= 0.7; }
        DB.spin[i] *= -0.6;
      } else {                 // comes to rest on the surface and fades
        DB.stuck[i] = 1; DB.vx[i] = 0; DB.vy[i] = 0;
        DB.life[i] = Math.min(DB.life[i], 0.5 + Math.random() * 0.9);
      }
      continue;
    }
    DB.x[i] = nx; DB.y[i] = ny;
    DB.rot[i] += DB.spin[i] * h;
  }
}
export function drawTerrainBits() {
  const A = debGeo.attributes;
  const pp = A.position.array, pc = A.tint.array, ps = A.size.array, pa = A.alpha.array, pr = A.rot.array, sh = A.shape.array;
  let n = 0;
  for (let i = 0; i < MAXD; i++) {
    if (!DB.on[i]) continue;
    const f = DB.life[i] / DB.max[i];
    pp[n * 3] = DB.x[i]; pp[n * 3 + 1] = DB.y[i]; pp[n * 3 + 2] = 0;
    pc[n * 3] = DB.r[i]; pc[n * 3 + 1] = DB.gr[i]; pc[n * 3 + 2] = DB.b[i];
    if (DB.shape[i] === 4) {
      const age = 1 - f;
      ps[n] = DB.sz[i] * (1 + 1.8 * age);
      pa[n] = 0.42 * f * Math.min(1, age * 10);
    } else {
      ps[n] = DB.sz[i];
      pa[n] = Math.min(1, f * 4);
    }
    pr[n] = DB.rot[i]; sh[n] = DB.shape[i];
    n++;
  }
  debGeo.setDrawRange(0, n);
  for (const k of ['position', 'tint', 'size', 'alpha', 'rot', 'shape']) A[k].needsUpdate = true;
}

// Which way the surface at (x, y) faces, how much solid is around, and whether it is a hard wall or pad.
export function surfaceAt(x, y) {
  let nx = 0, ny = 0, solid = 0, hard = 0;
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6, ca = Math.cos(a), sa = Math.sin(a);
    for (const r of [4, 9]) {
      const m = maskAt(x + ca * r, y + sa * r);
      if (m) { solid++; nx -= ca; ny -= sa; if (m !== 1) hard++; }
    }
  }
  const l = Math.hypot(nx, ny);
  return { solid, hard: hard * 2 > solid, nx: l > 1e-3 ? nx / l : 0, ny: l > 1e-3 ? ny / l : 1 };
}
export function terrainMaterial(hard) {
  if (hard || level.theme === 'floors' || level.theme === 'ship') return 'metal';
  if (level.theme === 'forest') return 'soil';
  if (level.theme === 'desert') return 'sand';
  return 'rock';
}
const rnd = (a, b) => a + Math.random() * (b - a);
const jitter = (c, j) => c.map((v) => v * (1 + (Math.random() - 0.5) * j));
// Throw out k "units" of material from a surface point facing (nx, ny).
export function spray(x, y, nx, ny, mat, k) {
  const base = groundRGB(y).map((v) => v / 255);
  const ang0 = Math.atan2(ny, nx), sk = Math.sqrt(k);
  const ox = x + nx * 4, oy = y + ny * 4;
  const dir = (spread, s0, s1) => { const a = ang0 + (Math.random() - 0.5) * spread, sp = rnd(s0, s1) * sk; return [Math.cos(a) * sp, Math.sin(a) * sp]; };
  const count = (n) => Math.max(1, Math.round(n * k * DEBRIS_AMOUNT * (0.8 + Math.random() * 0.4)));
  if (mat === 'rock') {
    const lit = [0.86, 0.40, 0.46];
    for (let j = count(10); j-- > 0;) {
      const [vx, vy] = dir(2.6, 60, 250);
      const c = Math.random() < 0.3 ? jitter(lit, 0.25) : jitter(base.map((v) => v * 1.5 + 0.03), 0.35);
      debris(ox, oy, vx, vy, rnd(1.2, 2.4), c, 0, rnd(2.2, 4.8) * Math.min(1.5, sk), 430, 0.35, 2);
    }
    for (let j = count(8); j-- > 0;) {
      const [vx, vy] = dir(2.2, 80, 320);
      debris(ox, oy, vx, vy, rnd(0.5, 1.0), jitter(base.map((v) => v * 1.9 + 0.05), 0.3), 3, rnd(1.1, 1.9), 320);
    }
    for (let j = count(3); j-- > 0;) {
      const [vx, vy] = dir(2.0, 15, 50);
      debris(ox, oy, vx, vy, rnd(1.1, 2.0), [0.36 + base[0] * 0.4, 0.27 + base[1] * 0.4, 0.40 + base[2] * 0.4], 4, rnd(14, 26) * sk, 0);
    }
  } else if (mat === 'soil') {
    for (let j = count(9); j-- > 0;) {
      const [vx, vy] = dir(2.4, 50, 220);
      debris(ox, oy, vx, vy, rnd(1.0, 2.0), jitter(base.map((v) => v * 1.1), 0.4), 1, rnd(2.4, 5) * Math.min(1.5, sk), 400, 0.15, 1);
    }
    if (ny > 0.2) {   // grassy tops lose leaves and blades
      const greens = [[0.36, 0.70, 0.30], [0.55, 0.82, 0.38], [0.24, 0.52, 0.24], [0.80, 0.86, 0.40]];
      for (let j = count(6); j-- > 0;) {
        const [vx, vy] = dir(1.8, 40, 150);
        debris(ox, oy, vx, vy + 30, rnd(2.0, 3.6), jitter(greens[j % 4], 0.2), 2, rnd(3.5, 6), 45, 0, 0, rnd(160, 300));
      }
    }
    for (let j = count(2); j-- > 0;) {
      const [vx, vy] = dir(2.0, 12, 40);
      debris(ox, oy, vx, vy, rnd(1.0, 1.8), [0.42, 0.34, 0.25], 4, rnd(12, 22) * sk, 0);
    }
  } else if (mat === 'sand') {
    for (let j = count(30); j-- > 0;) {
      const [vx, vy] = dir(1.9, 60, 300);
      debris(ox, oy, vx, vy + 40, rnd(0.8, 1.7), jitter(base.map((v) => v * (Math.random() < 0.5 ? 1.05 : 0.8)), 0.15), 3, rnd(1.1, 2.2), 360);
    }
    for (let j = count(4); j-- > 0;) {
      const [vx, vy] = dir(2.2, 20, 70);
      debris(ox, oy, vx, vy + 10, rnd(1.6, 2.8), jitter([0.88, 0.70, 0.50], 0.08), 4, rnd(18, 34) * sk, 0);
    }
  } else {   // metal: sparks plus a few steel flakes
    for (let j = count(12); j-- > 0;) {
      const [vx, vy] = dir(2.0, 150, 430);
      emit(ox, oy, vx, vy, rnd(0.15, 0.42), j % 3 ? EMBER : WHITE, 20, rnd(2, 3.4) * DEBRIS_SIZE);
    }
    for (let j = count(3); j-- > 0;) {
      const [vx, vy] = dir(2.4, 60, 200);
      debris(ox, oy, vx, vy, rnd(1.0, 1.8), jitter([0.62, 0.64, 0.74], 0.2), 0, rnd(1.6, 2.6), 420, 0.55, 3);
    }
    const [vx, vy] = dir(1.5, 10, 30);
    debris(ox, oy, vx, vy, rnd(0.6, 1.0), [0.55, 0.55, 0.62], 4, rnd(8, 14) * sk, 0);
  }
}
// Debris from a hit at (x, y): call before carving, while the surface is still there.
export function terrainDebris(x, y, k) {
  const sf = surfaceAt(x, y);
  if (sf.solid < 2) return;   // nothing solid here, e.g. a shell going off in the air
  spray(x, y, sf.nx, sf.ny, terrainMaterial(sf.hard), k);
}
