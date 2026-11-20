import { isPractice, P, PR, WEAPONS } from '../config.js';
import { segDist } from '../math.js';
import { carve, maskAt, solidAt } from '../level/mask.js';
import { simEvent } from '../events.js';
import { mapRules } from '../maps.js';
import { localToWorld, SHIP_RADIUS, ships } from './ship.js';
import { addShake, damage, shipMass } from './physics.js';

/* ------------------------------------------------------------------ *
 * The Big laser: weapon 4. One shot per match, and dying does not give it back.
 * ------------------------------------------------------------------ */
export const BIG = { charge: 0.35, fire: 0.75, width: 44, damage: 90, enemyDamage: 260, push: 380 };
const LASER_IDX = WEAPONS.findIndex((w) => w.id === 'laser');
export const bigFree = () => isPractice() && PR.infiniteAmmo;   // Practice with infinite ammo: fire it as often as you like
export function fireBigLaser(s) {
  if (s.beam || (!(s.bigLaser > 0) && !bigFree())) return;
  if (!bigFree()) s.bigLaser = 0;
  s.beam = { phase: 'charge', t: BIG.charge, hit: new Set(), len: 0, ox: s.x, oy: s.y, ang: s.a + Math.PI / 2, carveT: 0 };
  s.fireCd = 0.4;
  simEvent('laserCharge', s);
}
export function stepBigLaser(s, h) {
  const b = s.beam;
  if (!b) return;
  const nose = localToWorld(s, 0, 13);
  b.ox = nose.x; b.oy = nose.y; b.ang = s.a + Math.PI / 2;   // follows the nose, so you can sweep it
  b.t -= h;
  s.fireCd = Math.max(s.fireCd, 0.1);
  if (b.phase === 'charge') {
    if (b.t <= 0) {
      b.phase = 'fire';
      b.t = BIG.fire;
      addShake(s, 1.4);
      for (const o of ships) if (o !== s && o.active) addShake(o, 0.6);
      const m = shipMass(s);
      s.vx -= Math.cos(b.ang) * BIG.push / m; s.vy -= Math.sin(b.ang) * BIG.push / m;
      s.landed = false;
      simEvent('sound', 'laserFire', s);
    }
    return;
  }
  // The beam burns through rock (digging a tunnel) and stops at hard walls and pads.
  const dx = Math.cos(b.ang), dy = Math.sin(b.ang);
  let d = 0;
  while (d < 2200) {
    const v = maskAt(b.ox + dx * d, b.oy + dy * d);
    if (v === 2 || v === 3 || (v === 1 && !P.destructible)) break;
    d += 5;
  }
  b.len = d;
  const map = mapRules();
  map.breakAt?.(b.ox + dx * (d + 3), b.oy + dy * (d + 3));
  b.carveT -= h;
  if (b.carveT <= 0 && P.destructible && !map.breakAt) {
    b.carveT = 0.06;
    for (let t = 8; t < d; t += 14) {
      const x = b.ox + dx * t, y = b.oy + dy * t;
      if (solidAt(x, y) || solidAt(x + dy * 18, y - dx * 18) || solidAt(x - dy * 18, y + dx * 18)) { simEvent('beamDig', x, y); carve(x, y, BIG.width * 0.5); }
    }
  }
  const half = BIG.width / 2;
  map.beamHit?.(b, s, d, half, BIG.enemyDamage);
  for (const o of ships) {
    if (o === s || !o.active || !o.alive || b.hit.has(o) || map.coop) continue;
    if (segDist(o.x, o.y, b.ox, b.oy, b.ang, d) < half + SHIP_RADIUS * P.shipSize * 0.8) {
      b.hit.add(o);
      damage(o, BIG.damage);
      const m = shipMass(o);
      o.vx += dx * 320 / m; o.vy += dy * 320 / m;
      o.landed = false;
      simEvent('laserHitShip', s, o);
    }
  }
  if (b.t <= 0) {
    s.beam = null;
    if (s.weapon === LASER_IDX && !bigFree()) { s.weapon = 0; simEvent('weaponChanged', s, LASER_IDX, 0, true); }
  }
}
