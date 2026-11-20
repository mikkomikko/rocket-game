import * as THREE from 'three';
import { isPractice, P, PR, WEAPONS } from '@rocket-duel/shared/config.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { carve } from '@rocket-duel/shared/level/mask.js';
import { ships } from '../ships/ship.js';
import { addShake, damage, shipMass } from '../ships/physics.js';
import { DUST, EMBER, FIRE, ICE_COL, WHITE } from './pools.js';
import { spray, surfaceAt, terrainDebris, terrainMaterial } from './debris.js';
import { emit } from './particles.js';
import { emitSmoke } from './smoke.js';
import { activeMap, groundRGB } from '../maps/index.js';
import { sfx } from '../audio/sfx.js';

// Ice shots don't dig: they shatter into frost.
export function iceBurst(x, y, n) {
  sfx.tink(x, y);
  for (let j = 0; j < n; j++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 130;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.4, j % 3 ? ICE_COL : WHITE, 0.6, 2 + Math.random() * 3);
  }
  emit(x, y, 0, 0, 0.15, ICE_COL, 0, 16);
}
export function freezeShip(s) {
  if (!s.alive || s.invulnT > 0 || (isPractice() && PR.noDamage) || s.ballT > 0) return;
  s.frozenT = WEAPONS[2].freeze;
  s.thrust = 0; s.av = 0;
  sfx.frost(s);
  iceBurst(s.x, s.y, 22);
  addShake(s, 0.4);
}
// The Cannon shell: a big crater, splash damage and a shove for any ship nearby.
function bigBlast(x, y, owner, direct) {
  const wp = WEAPONS[1], map = activeMap();
  sfx.blast(x, y);
  if (map.breakAt) { for (let k = 0; k < 6; k++) map.breakAt(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30); }
  else if (P.destructible) carve(x, y, P.holeRadius * wp.hole);
  const R = wp.blast;
  for (const s of ships) {
    if (!s.active || !s.alive || s === direct) continue;
    if (map.coop && owner < 2) continue;
    const ddx = s.x - x, ddy = s.y - y, d = Math.hypot(ddx, ddy);
    if (d > R) continue;
    const f = 1 - d / R;   // falloff; your own ship takes half
    damage(s, P.bulletDamage * wp.damage * 0.6 * f * (s.id === owner ? 0.5 : 1));
    const m = shipMass(s), push = 260 * f / m;
    s.vx += (ddx / (d || 1)) * push; s.vy += (ddy / (d || 1)) * push;
    s.landed = false;
  }
  map.blastHit?.(x, y, R, owner, P.bulletDamage * wp.damage * 0.5);
  for (const s of ships) if (s.active && s.alive) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < 500) addShake(s, 1.1 * (1 - d / 500));
  }
  emit(x, y, 0, 0, 0.22, WHITE, 0, 60);
  emit(x, y, 0, 0, 0.35, FIRE, 0, 110);
  for (let j = 0; j < 40; j++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 320;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.35 + Math.random() * 0.6, j % 3 ? FIRE : EMBER, 0.5, 3 + Math.random() * 6);
  }
  if (P.smoke) for (let j = 0; j < 12; j++) {
    const a = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 80;
    emitSmoke(x, y, Math.cos(a) * sp, Math.sin(a) * sp, P.smokeLife * (0.7 + Math.random() * 0.5), 14 + Math.random() * 12);
  }
}
export function explode(x, y, kind = 0, owner = -1, direct = null) {
  if (kind !== 1) sfx.rock(x, y);
  terrainDebris(x, y, kind === 1 ? 2.6 : 1);
  if (kind === 1) bigBlast(x, y, owner, direct);
  else if (activeMap().breakAt) activeMap().breakAt(x, y);   // Floors walls can't be shot; only the orange blocks break
  else if (P.destructible) carve(x, y, P.holeRadius);
  const rc = groundRGB(y);
  DUST.setRGB(rc[0] / 255 * 1.6, rc[1] / 255 * 1.6, rc[2] / 255 * 1.6, THREE.SRGBColorSpace);
  emit(x, y, 0, 0, 0.14, EMBER, 0, 18);
  for (let j = 0; j < 7; j++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 140;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 + Math.random() * 0.3, j % 2 ? FIRE : EMBER, 0.3);
  }
}

export function dust(x, y, n, impact) {
  const rc = groundRGB(y);
  DUST.setRGB(rc[0] / 255 * 1.6, rc[1] / 255 * 1.6, rc[2] / 255 * 1.6, THREE.SRGBColorSpace);
  const count = Math.min(14, 3 + impact / 30);
  for (let j = 0; j < count; j++) {
    const sp = 20 + Math.random() * impact * 0.4;
    emit(x, y, n.x * sp + (Math.random() - 0.5) * 80, n.y * sp + (Math.random() - 0.5) * 80, 0.4 + Math.random() * 0.4, DUST, 1);
  }
  const sf = surfaceAt(x, y);
  spray(x, y, n.x, n.y, terrainMaterial(sf.hard), clamp(impact / 350, 0.15, 0.7));
}
