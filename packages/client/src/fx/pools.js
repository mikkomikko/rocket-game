import * as THREE from 'three';
import { BALL_COLOR, FREEZE_COLOR, WEAPONS } from '@rocket-duel/shared/config.js';
import { scene } from '../render/scene.js';
import { BULLET_SLOTS } from '@rocket-duel/shared/bullets.js';

/* ------------------------------------------------------------------ *
 * Bullets and particles (fixed pools, drawn as THREE.Points)
 * ------------------------------------------------------------------ */
export const FIRE = new THREE.Color('#ff8f3d'), EMBER = new THREE.Color('#ffd166'), WHITE = new THREE.Color('#ffffff');
export const ICE_COL = new THREE.Color(FREEZE_COLOR), HEAVY_COL = new THREE.Color(WEAPONS[1].color), BALL_COL = new THREE.Color(BALL_COLOR);
export const DUST = new THREE.Color();

// Soft, round, additive points sized in world units (bullets and particles).
export const pointScale = { value: 1 };
const POINT_VS = `
attribute float size; attribute vec3 tint;
uniform float uScale;
varying vec3 vTint;
void main() {
  vTint = tint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale;
}`;
const POINT_FS = `
uniform float uCore;
varying vec3 vTint;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = 1.0 - d; a *= a;
  float core = smoothstep(0.45, 0.0, d) * uCore;
  gl_FragColor = vec4(vTint * a + vec3(core), 1.0);
  #include <colorspace_fragment>
}`;
export const pointMaterial = (core) => new THREE.ShaderMaterial({
  uniforms: { uScale: pointScale, uCore: { value: core } },
  vertexShader: POINT_VS, fragmentShader: POINT_FS,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
export function pointGeo(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}
// Sends only the first n items of these attributes to the GPU: the pools are large and mostly empty,
// and uploading them whole every frame costs megabytes a second.
export function uploadUsed(geo, n, ...names) {
  for (const k of names) {
    const a = geo.attributes[k];
    a.clearUpdateRanges();
    if (n > 0) { a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
  }
}
export const bulletGeo = pointGeo(BULLET_SLOTS);
const bulletPts = new THREE.Points(bulletGeo, pointMaterial(0.9));
bulletPts.frustumCulled = false;
bulletPts.position.z = 2;
scene.add(bulletPts);
