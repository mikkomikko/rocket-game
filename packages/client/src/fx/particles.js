import * as THREE from 'three';
import { P } from '../config.js';
import { solidAt } from '../level/mask.js';
import { scene } from '../render/scene.js';
import { pointGeo, pointMaterial } from './pools.js';

// Glowing particles (sparks, embers, frost), drawn as one additive point cloud.
export const MAXP = 2500;
export const PT = {
  x: new Float32Array(MAXP), y: new Float32Array(MAXP), vx: new Float32Array(MAXP), vy: new Float32Array(MAXP),
  life: new Float32Array(MAXP), max: new Float32Array(MAXP), g: new Float32Array(MAXP), sz: new Float32Array(MAXP),
  r: new Float32Array(MAXP), gr: new Float32Array(MAXP), b: new Float32Array(MAXP), on: new Uint8Array(MAXP), cursor: 0,
};
export const partGeo = pointGeo(MAXP);
const partPts = new THREE.Points(partGeo, pointMaterial(0));
partPts.frustumCulled = false;
partPts.position.z = 1.5;
scene.add(partPts);

export function emit(x, y, vx, vy, life, color, grav, size = 4) {
  const i = PT.cursor;
  PT.cursor = (PT.cursor + 1) % MAXP;
  PT.on[i] = 1; PT.x[i] = x; PT.y[i] = y; PT.vx[i] = vx; PT.vy[i] = vy;
  PT.life[i] = life; PT.max[i] = life; PT.g[i] = grav; PT.sz[i] = size;
  PT.r[i] = color.r; PT.gr[i] = color.g; PT.b[i] = color.b;
}
export function stepParticles(h) {
  const drag = Math.exp(-1.5 * h);
  for (let i = 0; i < MAXP; i++) {
    if (!PT.on[i]) continue;
    PT.life[i] -= h;
    if (PT.life[i] <= 0) { PT.on[i] = 0; continue; }
    PT.vy[i] -= P.gravity * PT.g[i] * h;
    PT.vx[i] *= drag; PT.vy[i] *= drag;
    PT.x[i] += PT.vx[i] * h; PT.y[i] += PT.vy[i] * h;
    if (solidAt(PT.x[i], PT.y[i])) PT.on[i] = 0;
  }
}
