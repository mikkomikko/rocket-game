import { BALL_IDX, BALL_R, P, WEAPONS } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { solidAt } from '@rocket-duel/shared/level/mask.js';
import { SHIP_RADIUS, ships } from '../ships/ship.js';
import { damage, shipMass } from '../ships/physics.js';
import { ballPop, ballShip } from '../ships/weapons.js';
import { B, ICE_COL, MAXB, WHITE } from './pools.js';
import { TR, trailPoint } from './trails.js';
import { explode, freezeShip, iceBurst } from './explosions.js';
import { emit } from './particles.js';
import { emitSmoke, SM } from './smoke.js';
import { sfx } from '../audio/sfx.js';
import { activeMap } from '../maps/index.js';

// Bullets: spawning, flight and hits on terrain, ships, enemies and map creatures.
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
export function clearBullets() { B.on.fill(0); SM.on.fill(0); TR.life.fill(0); }

export function stepBullets(h) {
  const map = activeMap();
  for (let i = 0; i < MAXB; i++) {
    if (!B.on[i]) continue;
    const kind = B.kind[i], wp = WEAPONS[kind];
    B.life[i] -= h;
    if (B.life[i] <= 0) {
      B.on[i] = 0;
      trailPoint(i, true);
      if (kind === 1) explode(B.x[i], B.y[i], 1, B.owner[i]);   // the Cannon shell goes off when its fuse runs out
      else if (kind === 2) iceBurst(B.x[i], B.y[i], 6);
      else if (kind === BALL_IDX) ballPop(B.x[i], B.y[i], 8);
      continue;
    }
    B.vy[i] -= P.gravity * P.bulletGravity * wp.grav * h;
    if (kind === 1 && P.smoke && Math.random() < 0.5) emitSmoke(B.x[i], B.y[i], (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, P.smokeLife * 0.35, 5 + Math.random() * 3);
    if (kind === 2 && Math.random() < 0.35) emit(B.x[i], B.y[i], (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.35, ICE_COL, 0.2, 2 + Math.random() * 2);
    const dx = B.vx[i] * h, dy = B.vy[i] * h;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
    outer:
    for (let k = 0; k < n; k++) {
      B.x[i] += dx / n; B.y[i] += dy / n;
      const x = B.x[i], y = B.y[i];
      if (solidAt(x, y) || map.blocksShot?.(x, y)) {
        if (kind === 2) iceBurst(x, y, 10); else if (kind === BALL_IDX) { ballPop(x, y, 10); sfx.rock(x, y); } else explode(x, y, kind, B.owner[i]);
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
          if (kind === 0) sfx.hit(x, y);
          damage(s, P.bulletDamage * wp.damage);
          if (kind === 2) freezeShip(s);
          if (kind === BALL_IDX) ballShip(s);
          if (kind === 1) explode(x, y, 1, B.owner[i], s);
          for (let j = 0; j < 8; j++) emit(x, y, (Math.random() - 0.5) * 180, (Math.random() - 0.5) * 180, 0.3, j % 2 ? (kind === 2 ? ICE_COL : s.color) : WHITE, 0.2);
          B.on[i] = 0;
          break outer;
        }
      }
    }
    trailPoint(i, !B.on[i]);
  }
}
