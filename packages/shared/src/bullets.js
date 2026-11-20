import { BALL_IDX, BALL_R, P, WEAPONS } from './config.js';
import { game } from './state.js';
import { solidAt } from './level/mask.js';
import { simEvent } from './events.js';
import { mapRules } from './maps.js';
import { SHIP_RADIUS, ships } from './ships/ship.js';
import { damage, shipMass } from './ships/physics.js';
import { ballShip } from './ships/weapons.js';
import { explode, freezeShip } from './explosions.js';

/* ------------------------------------------------------------------ *
 * Bullets: one fixed pool for every shot in the game (owner 0 and 1 are the players; 2 and up are map
 * enemies). Spawning, flight and hits on terrain, ships, enemies and map creatures.
 * ------------------------------------------------------------------ */
export const MAXB = 600;
export const B = {
  x: new Float32Array(MAXB), y: new Float32Array(MAXB), vx: new Float32Array(MAXB), vy: new Float32Array(MAXB),
  life: new Float32Array(MAXB), owner: new Int8Array(MAXB), on: new Uint8Array(MAXB), kind: new Uint8Array(MAXB), cursor: 0,
  tx: new Float32Array(MAXB), ty: new Float32Array(MAXB), tt: new Float32Array(MAXB),   // last point dropped on the trail
};

export function spawnBullet(owner, x, y, vx, vy, life, kind = 0) {
  for (let k = 0; k < MAXB; k++) {
    const i = (B.cursor + k) % MAXB;
    if (!B.on[i]) {
      B.on[i] = 1; B.owner[i] = owner; B.x[i] = x; B.y[i] = y; B.vx[i] = vx; B.vy[i] = vy; B.life[i] = life; B.kind[i] = kind;
      B.tx[i] = x; B.ty[i] = y; B.tt[i] = game.time;
      B.cursor = (i + 1) % MAXB;
      return;
    }
  }
}
export function clearBullets() { B.on.fill(0); simEvent('bulletsCleared'); }

// Moves every bullet one step. When one stops, simEvent('bulletEnd', i) lets the client finish its trail.
export function stepBullets(h) {
  const map = mapRules();
  for (let i = 0; i < MAXB; i++) {
    if (!B.on[i]) continue;
    const kind = B.kind[i], wp = WEAPONS[kind];
    B.life[i] -= h;
    if (B.life[i] <= 0) {
      B.on[i] = 0;
      simEvent('bulletEnd', i);
      if (kind === 1) explode(B.x[i], B.y[i], 1, B.owner[i]);   // the Cannon shell goes off when its fuse runs out
      else if (kind === 2) simEvent('iceBurst', B.x[i], B.y[i], 6);
      else if (kind === BALL_IDX) simEvent('ballPop', B.x[i], B.y[i], 8);
      continue;
    }
    B.vy[i] -= P.gravity * P.bulletGravity * wp.grav * h;
    const dx = B.vx[i] * h, dy = B.vy[i] * h;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
    outer:
    for (let k = 0; k < n; k++) {
      B.x[i] += dx / n; B.y[i] += dy / n;
      const x = B.x[i], y = B.y[i];
      if (solidAt(x, y) || map.blocksShot?.(x, y)) {
        if (kind === 2) simEvent('iceBurst', x, y, 10);
        else if (kind === BALL_IDX) { simEvent('ballPop', x, y, 10); simEvent('sound', 'rock', x, y); }
        else explode(x, y, kind, B.owner[i]);
        B.on[i] = 0; break;
      }
      if (map.bulletHit?.(x, y, B.owner[i], P.bulletDamage * wp.damage, kind)) {
        if (kind === 1) explode(x, y, 1, B.owner[i]);
        B.on[i] = 0; break;
      }
      for (const s of ships) {
        if (s.id === B.owner[i] || !s.alive || (map.coop && B.owner[i] < 2)) continue;
        const r = (s.ballT > 0 ? BALL_R : SHIP_RADIUS) * P.shipSize + 2;
        if ((x - s.x) ** 2 + (y - s.y) ** 2 < r * r) {
          const sp = Math.hypot(B.vx[i], B.vy[i]) || 1;
          const m = shipMass(s);
          s.vx += B.vx[i] / sp * P.knockback * wp.knockback / m;
          s.vy += B.vy[i] / sp * P.knockback * wp.knockback / m;
          if (P.knockback > 0) s.landed = false;
          if (kind === 0) simEvent('sound', 'hit', x, y);
          damage(s, P.bulletDamage * wp.damage);
          if (kind === 2) freezeShip(s);
          if (kind === BALL_IDX) ballShip(s);
          if (kind === 1) explode(x, y, 1, B.owner[i], s);
          simEvent('shipHit', x, y, s, kind);
          B.on[i] = 0;
          break outer;
        }
      }
    }
    if (!B.on[i]) simEvent('bulletEnd', i);
  }
}
