import { FRAG_IDX } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { B, BULLET_SLOTS } from '@rocket-duel/shared/bullets.js';
import { levelMat } from './scene.js';

/* ------------------------------------------------------------------ *
 * Point lights on the rock: a flying frag grenade glows and lights the cave walls around it, and
 * blasts flash. The level shader takes up to MAX_LIGHTS of them as (x, y, strength).
 * ------------------------------------------------------------------ */
export const MAX_LIGHTS = 8;   // keep in step with the uLights array in scene.js
const lights = levelMat.uniforms.uLights.value;   // MAX_LIGHTS × Vector3
const flashes = Array.from({ length: MAX_LIGHTS }, () => ({ x: 0, y: 0, k: 0, t0: 0, life: 0 }));
let cursor = 0;

// A short flash of light at x, y: strength k, fading out over life seconds.
export function flash(x, y, k, life) {
  const f = flashes[cursor];
  cursor = (cursor + 1) % MAX_LIGHTS;
  f.x = x; f.y = y; f.k = k; f.t0 = game.time; f.life = life;
}

// Gathers this frame's lights: every frag grenade in flight (with a flicker), then the flashes still fading.
export function updateLights() {
  let n = 0;
  for (let i = 0; i < BULLET_SLOTS && n < MAX_LIGHTS; i++) {
    if (!B.on[i] || B.kind[i] !== FRAG_IDX) continue;
    lights[n++].set(B.x[i], B.y[i], 0.85 + 0.25 * Math.sin(game.time * 47 + i * 1.7) * Math.sin(game.time * 23));
  }
  for (const f of flashes) {
    if (n >= MAX_LIGHTS) break;
    const age = (game.time - f.t0) / f.life;
    if (f.life <= 0 || age < 0 || age >= 1) continue;
    lights[n++].set(f.x, f.y, f.k * (1 - age) * (1 - age));
  }
  levelMat.uniforms.uLightN.value = n;
}
