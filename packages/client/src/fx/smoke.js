import * as THREE from 'three';
import { solidAt } from '@rocket-duel/shared/level/mask.js';
import { scene } from '../render/scene.js';
import { pointScale } from './pools.js';

// Smoke: soft grey puffs that drift, grow and fade slowly. Normal blending, drawn behind the ships.
// A puff's dark (0..1) turns it from grey towards black soot.
export const MAXS = 1500;
export const SM = {
  x: new Float32Array(MAXS), y: new Float32Array(MAXS), vx: new Float32Array(MAXS), vy: new Float32Array(MAXS),
  life: new Float32Array(MAXS), max: new Float32Array(MAXS), sz: new Float32Array(MAXS), dark: new Float32Array(MAXS), on: new Uint8Array(MAXS), cursor: 0,
};
export const smokeGeo = new THREE.BufferGeometry();
smokeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXS * 3), 3));
smokeGeo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(MAXS), 1));
smokeGeo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(MAXS), 1));
smokeGeo.setAttribute('dark', new THREE.BufferAttribute(new Float32Array(MAXS), 1));
const smokePts = new THREE.Points(smokeGeo, new THREE.ShaderMaterial({
  uniforms: { uScale: pointScale, uColor: { value: new THREE.Color('#8d779f') } },
  vertexShader: `
attribute float size; attribute float alpha; attribute float dark;
uniform float uScale;
varying float vAlpha; varying float vDark;
void main() {
  vAlpha = alpha; vDark = dark;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale;
}`,
  fragmentShader: `
uniform vec3 uColor;
varying float vAlpha; varying float vDark;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = 1.0 - d * d;
  // dark 0 = the usual grey, 1 = near-black soot (thicker too)
  gl_FragColor = vec4(mix(uColor, vec3(0.06, 0.05, 0.06), vDark), a * a * vAlpha * (1.0 + vDark * 1.2));
  #include <colorspace_fragment>
}`,
  transparent: true,
  depthWrite: false,
}));
smokePts.frustumCulled = false;
smokePts.position.z = 0.8;
scene.add(smokePts);

export function emitSmoke(x, y, vx, vy, life, size, dark = 0) {
  const i = SM.cursor;
  SM.cursor = (SM.cursor + 1) % MAXS;
  SM.on[i] = 1; SM.x[i] = x; SM.y[i] = y; SM.vx[i] = vx; SM.vy[i] = vy;
  SM.life[i] = life; SM.max[i] = life; SM.sz[i] = size; SM.dark[i] = dark;
}
export function stepSmoke(h) {
  const drag = Math.exp(-1.8 * h);
  for (let i = 0; i < MAXS; i++) {
    if (!SM.on[i]) continue;
    SM.life[i] -= h;
    if (SM.life[i] <= 0) { SM.on[i] = 0; continue; }
    SM.vx[i] *= drag;
    SM.vy[i] = SM.vy[i] * drag + 14 * h;   // a gentle rise
    const nx = SM.x[i] + SM.vx[i] * h, ny = SM.y[i] + SM.vy[i] * h;
    if (solidAt(nx, ny)) { SM.vx[i] = 0; SM.vy[i] = 0; }
    else { SM.x[i] = nx; SM.y[i] = ny; }
  }
}
