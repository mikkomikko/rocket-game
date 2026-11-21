import { MISSILE_IDX, P, WEAPONS } from './config.js';
import { solidAt } from './level/mask.js';
import { mapRules } from './maps.js';
import { clamp } from './math.js';
import { localToWorld, SHIP_RADIUS, ships } from './ships/ship.js';

/* ------------------------------------------------------------------ *
 * The homing missile's flight (see the Missile in config.js). The simulation steers live missiles with it,
 * a browser steers the missiles it shows between snapshots with it, and missileReach() flies a pretend
 * missile as one is fired, to show the shooter whether it will reach the other ship.
 * ------------------------------------------------------------------ */
const HM = () => WEAPONS[MISSILE_IDX].homing;

// The ship a player's missile chases: the other player, while it's in play. Map enemies' shots and
// team maps (Floors, Starship) have none, so the missile flies straight.
export function missileTarget(owner) {
  if (owner > 1 || mapRules().coop) return null;
  const t = ships[1 - owner];
  return t.active && t.alive ? t : null;
}

// Hit radius around a ship: the ship plus the proximity fuse.
export const missileHitR = () => SHIP_RADIUS * P.shipSize + 2 + HM().fuse;

// One step of steering for missile m ({ x, y, vx, vy }): speed eases to cruise speed and the heading turns
// towards (tx, ty) by at most the turn rate (faster close to the target). No target: it only speeds up.
export function steerMissile(m, target, h) {
  const hm = HM(), cruise = P.bulletSpeed * hm.cruise;
  let sp = Math.hypot(m.vx, m.vy), ang = Math.atan2(m.vy, m.vx);
  sp += (cruise - sp) * Math.min(1, hm.accel * h);
  if (target) {
    const dx = target.x - m.x, dy = target.y - m.y, d = Math.hypot(dx, dy);
    let diff = Math.atan2(dy, dx) - ang;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const turn = (hm.turn + (hm.closeTurn - hm.turn) * Math.max(0, 1 - d / hm.close)) * h;
    ang += clamp(diff, -turn, turn);
  }
  m.vx = Math.cos(ang) * sp; m.vy = Math.sin(ang) * sp;
}

// Where a missile ship s fired now would end up, if the other ship stayed where it is:
// { hit: true, x, y, t } on the target, { hit: false, x, y, t } where it would hit rock or run out of fuel
// (t: seconds of flight until then), or null when there's no target. Reads the world, changes nothing.
const sim = { x: 0, y: 0, vx: 0, vy: 0 };
export function missileReach(s) {
  const target = missileTarget(s.id);
  if (!target) return null;
  const wp = WEAPONS[MISSILE_IDX], map = mapRules(), h = 1 / P.physicsHz, r2 = missileHitR() ** 2;
  const nose = localToWorld(s, 0, 13), spd = P.bulletSpeed * wp.speed;
  sim.x = nose.x; sim.y = nose.y;
  sim.vx = -Math.sin(s.a) * spd + s.vx * P.inheritVelocity;
  sim.vy = Math.cos(s.a) * spd + s.vy * P.inheritVelocity;
  const fuel = P.bulletLife * wp.life;
  let t = 0;
  for (; t < fuel; t += h) {
    steerMissile(sim, target, h);
    const dx = sim.vx * h, dy = sim.vy * h, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
    for (let k = 0; k < n; k++) {
      sim.x += dx / n; sim.y += dy / n;
      if (solidAt(sim.x, sim.y) || map.blocksShot?.(sim.x, sim.y)) return { hit: false, x: sim.x, y: sim.y, t };
      if ((sim.x - target.x) ** 2 + (sim.y - target.y) ** 2 < r2) return { hit: true, x: target.x, y: target.y, t };
    }
  }
  return { hit: false, x: sim.x, y: sim.y, t };
}
