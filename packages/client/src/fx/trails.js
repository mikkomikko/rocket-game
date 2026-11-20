import * as THREE from 'three';
import { BALL_IDX, WEAPONS } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { scene } from '../render/scene.js';
import { ships } from '../ships/ship.js';
import { B, BALL_COL, HEAVY_COL, ICE_COL, MAXB } from './pools.js';
import { ENEMY_RED } from '../maps/starship/constants.js';

/* Fading trails: every bullet drops short ribbon pieces along its path. Each piece fades and thins on its own clock,
 * so the oldest end goes first and the trail slowly shrinks back toward the shot (and stays behind at the impact point
 * until it has faded out). Length and width per weapon: tLife / tWidth in WEAPONS. */
export const MAXT = 12000, TRAIL_STEP = 6;
const TRAIL_STRENGTH = 0.18;
const TRAIL_START = 0.55;    // a fresh trail starts as if already this far into its fade (1 = full, lower = dimmer and thinner from the start)   // how strongly trails show (0 = invisible, 1 = full colour)
export const TR = {
  x0: new Float32Array(MAXT), y0: new Float32Array(MAXT), t0: new Float32Array(MAXT),
  x1: new Float32Array(MAXT), y1: new Float32Array(MAXT), t1: new Float32Array(MAXT),
  life: new Float32Array(MAXT), w: new Float32Array(MAXT),
  r: new Float32Array(MAXT), g: new Float32Array(MAXT), b: new Float32Array(MAXT), cursor: 0,
};
export const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((MAXT + MAXB) * 18), 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((MAXT + MAXB) * 18), 3));
const trailMesh = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
trailMesh.frustumCulled = false;
trailMesh.position.z = 1.9;
scene.add(trailMesh);
export const bulletColor = (i) => B.owner[i] >= 2 ? ENEMY_RED : B.kind[i] === 1 ? HEAVY_COL : B.kind[i] === 2 ? ICE_COL : B.kind[i] === BALL_IDX ? BALL_COL : ships[B.owner[i]].color;
// Drop a trail piece from the bullet's last trail point to where it is now (always when it ends, so the trail reaches the impact).
export function trailPoint(i, end) {
  const dx = B.x[i] - B.tx[i], dy = B.y[i] - B.ty[i], d2 = dx * dx + dy * dy;
  if (d2 < 0.0001 || (!end && d2 < TRAIL_STEP * TRAIL_STEP)) return;
  const wp = WEAPONS[B.kind[i]], col = bulletColor(i), k = TR.cursor;
  TR.x0[k] = B.tx[i]; TR.y0[k] = B.ty[i]; TR.t0[k] = B.tt[i];
  TR.x1[k] = B.x[i]; TR.y1[k] = B.y[i]; TR.t1[k] = game.time;
  TR.life[k] = wp.tLife; TR.w[k] = wp.tWidth; TR.r[k] = col.r; TR.g[k] = col.g; TR.b[k] = col.b;
  TR.cursor = (k + 1) % MAXT;
  B.tx[i] = B.x[i]; B.ty[i] = B.y[i]; B.tt[i] = game.time;
}
// One ribbon quad (two triangles); f0/f1 = how fresh each end is (1 new, 0 gone): brightness and width follow it.
export function trailQuad(p, c, n, x0, y0, f0, x1, y1, f1, w, r, g, b) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
  if (L < 0.01) return n;
  const nx = -dy / L, ny = dx / L;
  f0 *= TRAIL_START; f1 *= TRAIL_START;
  const w0 = w * (0.2 + 0.8 * f0) * 0.5, w1 = w * (0.2 + 0.8 * f1) * 0.5;
  const k0 = f0 * f0 * TRAIL_STRENGTH, k1 = f1 * f1 * TRAIL_STRENGTH;
  const ax = x0 + nx * w0, ay = y0 + ny * w0, bx = x0 - nx * w0, by = y0 - ny * w0;
  const cx = x1 + nx * w1, cy = y1 + ny * w1, ex = x1 - nx * w1, ey = y1 - ny * w1;
  const V = [ax, ay, k0, bx, by, k0, cx, cy, k1, cx, cy, k1, bx, by, k0, ex, ey, k1];
  let o = n * 18;
  for (let v = 0; v < 18; v += 3, o += 3) {
    p[o] = V[v]; p[o + 1] = V[v + 1]; p[o + 2] = 0;
    c[o] = r * V[v + 2]; c[o + 1] = g * V[v + 2]; c[o + 2] = b * V[v + 2];
  }
  return n + 1;
}
