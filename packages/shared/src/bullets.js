import { P, WEAPONS } from './config.js';
import { game } from './state.js';
import { solidAt } from './level/mask.js';
import { simEvent } from './events.js';
import { mapRules } from './maps.js';
import { SHIP_RADIUS, ships } from './ships/ship.js';
import { damage, shipMass } from './ships/physics.js';
import { missileHitR, missileTarget, steerMissile } from './missile.js';
import { explode, freezeShip } from './explosions.js';

/* ------------------------------------------------------------------ *
 * Bullets: one fixed pool for every shot in the game (owner 0 and 1 are the players; 2 and up are map
 * enemies). Spawning, flight and hits on terrain, ships, enemies and map creatures.
 * The simulation uses slots 0 to MAXB - 1. The slots after them are for a browser's predicted shots
 * (shown until the server's bullet arrives); the simulation never touches them.
 * ------------------------------------------------------------------ */
export const MAXB = 600, PREDICTED_SLOTS = 64, BULLET_SLOTS = MAXB + PREDICTED_SLOTS;
const N = BULLET_SLOTS;
export const B = {
  x: new Float32Array(N), y: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N),
  life: new Float32Array(N), owner: new Int8Array(N), on: new Uint8Array(N), kind: new Uint8Array(N), cursor: 0,
  tx: new Float32Array(N), ty: new Float32Array(N), tt: new Float32Array(N),   // last point dropped on the trail
  seq: new Int32Array(N),   // a player's shot: the number of the input that fired it (online play matches shots by it)
};

// While a browser predicts its own ship, its shots go to the browser instead of into the pool.
let predictedShots = null;
export const onPredictedShot = (fn) => { predictedShots = fn; };

export function spawnBullet(owner, x, y, vx, vy, life, kind = 0) {
  if (game.predicting) { predictedShots?.(owner, x, y, vx, vy, life, kind); return; }
  for (let k = 0; k < MAXB; k++) {
    const i = (B.cursor + k) % MAXB;
    if (!B.on[i]) {
      B.on[i] = 1; B.owner[i] = owner; B.x[i] = x; B.y[i] = y; B.vx[i] = vx; B.vy[i] = vy; B.life[i] = life; B.kind[i] = kind;
      B.tx[i] = x; B.ty[i] = y; B.tt[i] = game.time;
      B.seq[i] = owner < 2 ? ships[owner].inputSeq || 0 : 0;
      B.cursor = (i + 1) % MAXB;
      return;
    }
  }
}
export function clearBullets() { B.on.fill(0); simEvent('bulletsCleared'); }

// Steers a homing missile in slot i (see missile.js).
const mis = { x: 0, y: 0, vx: 0, vy: 0 };
export function steerBullet(i, h) {
  mis.x = B.x[i]; mis.y = B.y[i]; mis.vx = B.vx[i]; mis.vy = B.vy[i];
  steerMissile(mis, missileTarget(B.owner[i]), h);
  B.vx[i] = mis.vx; B.vy[i] = mis.vy;
}

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
      if (wp.blast) explode(B.x[i], B.y[i], kind, B.owner[i]);   // a Cannon shell's fuse or a missile's fuel runs out
      else if (kind === 2) simEvent('iceBurst', B.x[i], B.y[i], 6);
      continue;
    }
    if (wp.homing) steerBullet(i, h);
    B.vy[i] -= P.gravity * P.bulletGravity * wp.grav * h;
    const dx = B.vx[i] * h, dy = B.vy[i] * h;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
    outer:
    for (let k = 0; k < n; k++) {
      B.x[i] += dx / n; B.y[i] += dy / n;
      const x = B.x[i], y = B.y[i];
      if (solidAt(x, y) || map.blocksShot?.(x, y)) {
        if (kind === 2) simEvent('iceBurst', x, y, 10);
        else explode(x, y, kind, B.owner[i]);
        B.on[i] = 0; break;
      }
      if (map.bulletHit?.(x, y, B.owner[i], P.bulletDamage * wp.damage, kind)) {
        if (wp.blast) explode(x, y, kind, B.owner[i]);
        B.on[i] = 0; break;
      }
      for (const s of ships) {
        if (s.id === B.owner[i] || !s.alive || (map.coop && B.owner[i] < 2)) continue;
        const r = wp.homing ? missileHitR() : SHIP_RADIUS * P.shipSize + 2;
        if ((x - s.x) ** 2 + (y - s.y) ** 2 < r * r) {
          const sp = Math.hypot(B.vx[i], B.vy[i]) || 1;
          const m = shipMass(s);
          s.vx += B.vx[i] / sp * P.knockback * wp.knockback / m;
          s.vy += B.vy[i] / sp * P.knockback * wp.knockback / m;
          if (P.knockback > 0) s.landed = false;
          if (kind === 0) simEvent('sound', 'hit', x, y);
          damage(s, P.bulletDamage * wp.damage);
          if (kind === 2) freezeShip(s);
          if (wp.blast) explode(x, y, kind, B.owner[i], s);
          simEvent('shipHit', x, y, s, kind);
          B.on[i] = 0;
          break outer;
        }
      }
    }
    if (!B.on[i]) simEvent('bulletEnd', i);
  }
}
