import { DEG, isPractice, MINIGUN_RATE, P, PR, WEAPONS } from '../config.js';
import { simEvent } from '../events.js';
import { random } from '../random.js';
import { localToWorld } from './ship.js';
import { missileReach } from '../missile.js';
import { addShake, shipMass } from './physics.js';
import { spawnBullet } from '../bullets.js';
import { bigFree, fireBigLaser } from './bigLaser.js';

// Firing and weapon switching.
export function fire(s) {
  const wp = WEAPONS[s.weapon];
  if (wp.id === 'laser') { fireBigLaser(s); return; }
  if (!weaponReady(s, s.weapon)) return;   // out of missiles
  // A missile: where it will go, for the shooter's sight (missile.js; it launches exactly as below, with no spread).
  const reach = wp.homing ? missileReach(s) : null;
  if (wp.homing && !bigFree()) s.missiles--;
  const ang = s.a + (random() - 0.5) * 2 * (P.spread * (wp.id === 'heavy' ? 0.3 : wp.homing ? 0 : 1) + (s.minigunT > 0 ? 3 : 0)) * DEG;
  const dx = -Math.sin(ang), dy = Math.cos(ang);
  const nose = localToWorld(s, 0, 13);
  const spd = P.bulletSpeed * wp.speed;
  spawnBullet(s.id, nose.x, nose.y, dx * spd + s.vx * P.inheritVelocity, dy * spd + s.vy * P.inheritVelocity, P.bulletLife * wp.life, s.weapon);
  if (!(isPractice() && PR.infiniteAmmo) && !(s.minigunT > 0)) s.ammo = Math.max(0, s.ammo - wp.cost);   // the minigun uses no ammo
  s.fireCd = 1 / (P.fireRate * wp.rate * (s.minigunT > 0 ? MINIGUN_RATE : 1));
  if (P.recoil > 0) {
    const m = shipMass(s), rc = P.recoil * wp.recoil * (s.minigunT > 0 ? 0.25 : 1) / m;
    // The Cannon kicks hard enough to knock a landed ship off the ground; the others only push in the air.
    if (s.landed && wp.id === 'heavy') s.landed = false;
    if (!s.landed) {
      s.vx -= -Math.sin(s.a) * rc;
      s.vy -= Math.cos(s.a) * rc;
    }
  }
  if (wp.id === 'heavy') addShake(s, 0.5);
  simEvent('fired', s, wp.id, nose, ang, reach);
  if (!weaponReady(s, s.weapon)) cycleWeapon(s);   // that was the last missile
}

/* Weapon switching: cycles to the next weapon. */
export function cycleWeapon(s) {
  if (!s.active) return;
  const prev = s.weapon;
  // A used Big laser is skipped until the next match, and the Missile while you have none left.
  do s.weapon = (s.weapon + 1) % WEAPONS.length; while (!weaponReady(s, s.weapon));
  s.fireCd = Math.max(s.fireCd, 0.15);
  simEvent('weaponChanged', s, prev, s.weapon, false);
}

// Whether weapon k has a shot left: the Big laser once a match, missiles until they run out (practice with infinite ammo: always).
export function weaponReady(s, k) {
  const id = WEAPONS[k].id;
  if (bigFree()) return true;
  if (id === 'laser') return s.bigLaser > 0;
  if (id === 'missile') return s.missiles > 0;
  return true;
}
