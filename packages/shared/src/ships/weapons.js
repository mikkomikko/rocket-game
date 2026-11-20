import { BALL_BOUNCE, BALL_GRAV, BALL_IDX, BALL_R, DEG, isPractice, MINIGUN_RATE, P, PR, WEAPONS } from '../config.js';
import { H, solidAt, W } from '../level/mask.js';
import { simEvent } from '../events.js';
import { random } from '../random.js';
import { localToWorld, SHIP_RADIUS } from './ship.js';
import { addShake, normalAt, shipMass } from './physics.js';
import { spawnBullet } from '../bullets.js';
import { bigFree, fireBigLaser } from './bigLaser.js';

// Firing, weapon switching and the ball weapon.
export function fire(s) {
  const wp = WEAPONS[s.weapon];
  if (wp.id === 'laser') { fireBigLaser(s); return; }
  const ang = s.a + (random() - 0.5) * 2 * (P.spread * (wp.id === 'heavy' ? 0.3 : 1) + (s.minigunT > 0 ? 3 : 0)) * DEG;
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
  simEvent('fired', s, wp.id, nose, ang);
}

/* Weapon switching: cycles to the next weapon. */
export function cycleWeapon(s) {
  if (!s.active) return;
  const prev = s.weapon;
  s.weapon = (s.weapon + 1) % WEAPONS.length;
  // A used Big laser is skipped until the next match.
  if (WEAPONS[s.weapon].id === 'laser' && !(s.bigLaser > 0) && !bigFree()) s.weapon = (s.weapon + 1) % WEAPONS.length;
  s.fireCd = Math.max(s.fireCd, 0.15);
  simEvent('weaponChanged', s, prev, s.weapon, false);
}

export const shipR = (s) => s.ballT > 0 ? BALL_R : SHIP_RADIUS * 0.9;

// Trapped in a Bouncer ball: no control, heavier gravity, bounces off everything, rolls on the ground.
export function ballShip(s) {
  if (!s.alive || s.invulnT > 0 || (isPractice() && PR.noDamage)) return;
  if (!(s.ballT > 0)) simEvent('ballPop', s.x, s.y, 20);
  s.ballT = WEAPONS[BALL_IDX].ball;
  s.frozenT = 0; s.landed = false; s.onPad = false; s.thrust = 0;
  simEvent('sound', 'boing', s, 300);
  addShake(s, 0.4);
}
export function stepBall(s, h) {
  s.ballT = Math.max(0, s.ballT - h);
  s.thrust = 0; s.landed = false; s.onPad = false;
  s.vy -= P.gravity * BALL_GRAV * h;
  const k = Math.exp(-P.linearDrag * 0.25 * h);
  s.vx *= k; s.vy *= k;
  const sp = Math.hypot(s.vx, s.vy), max = P.maxSpeed * 1.6;
  if (sp > max) { s.vx *= max / sp; s.vy *= max / sp; }
  s.x += s.vx * h; s.y += s.vy * h;
  s.a += s.av * h;
  resolveBall(s);
  if (s.ballT === 0) { simEvent('ballPop', s.x, s.y, 24); s.av = 0; simEvent('sound', 'boing', s, 120); }
}
function resolveBall(s) {
  const R = BALL_R * P.shipSize;
  let nx = 0, ny = 0, impact = 0;
  // Map edges: bounce straight back.
  if (s.x < R) { s.x = R; nx += 1; } else if (s.x > W - R) { s.x = W - R; nx -= 1; }
  if (s.y < R) { s.y = R; ny += 1; } else if (s.y > H - R) { s.y = H - R; ny -= 1; }
  // Terrain: points around the rim; push out along the line from the touching points to the centre.
  let hits = 0, cx = 0, cy = 0;
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, x = s.x + Math.cos(a) * R, y = s.y + Math.sin(a) * R;
    if (solidAt(x, y)) { hits++; cx += x; cy += y; }
  }
  if (hits) {
    cx /= hits; cy /= hits;
    let tx = s.x - cx, ty = s.y - cy, l = Math.hypot(tx, ty);
    if (l < 1e-6) { const n = normalAt(cx, cy, s); tx = n.x; ty = n.y; } else { tx /= l; ty /= l; }
    let free = false;
    for (let k = 0; k < 40; k++) {
      s.x += tx * 0.75; s.y += ty * 0.75;
      let solid = false;
      for (let j = 0; j < 24 && !solid; j++) { const a = j / 24 * Math.PI * 2; solid = solidAt(s.x + Math.cos(a) * R, s.y + Math.sin(a) * R); }
      if (!solid) { free = true; break; }
    }
    if (!free) { s.x = s.px; s.y = s.py; }
    nx += tx; ny += ty;
  }
  const l = Math.hypot(nx, ny);
  if (l < 1e-6) return;
  nx /= l; ny /= l;
  const vn = s.vx * nx + s.vy * ny;
  if (vn >= 0) return;
  impact = -vn;
  const tvx = s.vx - vn * nx, tvy = s.vy - vn * ny;
  const bounce = impact < 18 ? 0 : BALL_BOUNCE;   // tiny bounces settle so it can roll
  s.vx = tvx * 0.97 + nx * impact * bounce;
  s.vy = tvy * 0.97 + ny * impact * bounce;
  s.av = -(s.vx * ny - s.vy * nx) / R;            // roll: spin matches speed along the surface
  if (impact > 40) {
    addShake(s, Math.min(0.6, impact / 600));
    if (hits) simEvent('dust', s.x - nx * R, s.y - ny * R, { x: nx, y: ny }, impact * 0.6);
    simEvent('sound', 'boing', s, impact);
  }
}
