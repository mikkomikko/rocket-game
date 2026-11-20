import { BALL_MASS, DEG, isPractice, P, PR, WEAPONS } from '../config.js';
import { approach, wrapAngle } from '../math.js';
import { game } from '../state.js';
import { carve, H, level, maskAt, solidAt } from '../level/mask.js';
import { simEvent } from '../events.js';
import { mapRules } from '../maps.js';
import { hullSolid, hullWorld, ships } from './ship.js';
import { fire, shipR, stepBall } from './weapons.js';
import { stepBigLaser } from './bigLaser.js';

// Ship physics: mass, landing, damage and respawn, terrain collision and ship-vs-ship bumps.
export const shipMass = (s) => P.mass + s.ammo * P.ammoWeight + (s.ballT > 0 ? BALL_MASS : 0);

export function normalAt(x, y, s) {
  let nx = 0, ny = 0;
  const R = 5;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      if (solidAt(x + dx, y + dy)) { nx -= dx; ny -= dy; }
    }
  }
  const l = Math.hypot(nx, ny);
  if (l < 1e-6) {
    const v = Math.hypot(s.vx, s.vy);
    return v > 1e-6 ? { x: -s.vx / v, y: -s.vy / v } : { x: 0, y: 1 };
  }
  return { x: nx / l, y: ny / l };
}

function standingOnPad(s) {
  const pts = hullWorld(s, 0, -2.5);
  return maskAt(pts[1][0], pts[1][1]) === 3 || maskAt(pts[2][0], pts[2][1]) === 3;
}
function supported(s) {
  const pts = hullWorld(s, 0, -2);
  for (const p of pts) if (solidAt(p[0], p[1])) return true;
  return false;
}

// Camera shake for this ship's player (0 to about 1.6).
export function addShake(s, amount) { simEvent('shake', s, amount); }

export function damage(s, amount) {
  if (game.predicting || !s.alive || s.invulnT > 0 || (isPractice() && PR.noDamage) || mapRules().shipsSafe?.()) return;
  s.hp -= amount;
  addShake(s, Math.min(1, amount / 30));
  if (s.hp <= 0) { s.hp = 0; kill(s); }
}

export function kill(s, eaten = false) {
  s.minigunT = 0;
  s.beam = null;   // a beam in progress stops, but a used Big laser does not come back
  s.frozenT = 0;
  s.ballT = 0;
  s.alive = false;
  s.respawnT = P.respawnTime;
  s.deathX = s.x; s.deathY = s.y;
  s.thrust = 0;
  const other = ships[1 - s.id];
  if (!isPractice() && !mapRules().coop) other.score++;   // in Floors and Starship you score another way
  mapRules().onKill?.(s);
  const how = eaten === true ? 'eaten' : (eaten || '');
  s.eaten = how === 'eaten';
  s.lava = how === 'lava';
  simEvent('killed', s, how);
  if (!s.eaten && !s.lava && P.destructible) carve(s.x, s.y, P.holeRadius * 2.2);
}

export function respawn(s) {
  const sp = level.spawns[s.id];
  const air = isPractice() && PR.spawn === 'air';
  s.x = sp.x; s.y = air ? H / 2 : sp.y + 8 * P.shipSize + 0.6;
  s.px = s.x; s.py = s.y;
  s.vx = 0; s.vy = 0; s.a = 0; s.pa = 0; s.av = 0; s.thrust = 0;
  s.hp = 100; s.ammo = P.ammoMax;
  s.landed = !air; s.onPad = !isPractice(); s.alive = true; s.active = true; s.lastImpact = 0; s.eaten = false; s.lava = false; s.minigunT = 0; s.frozenT = 0; s.ballT = 0;
  mapRules().onRespawn?.(s);
  s.invulnT = P.invulnTime; s.fireCd = 0.2;
  simEvent('respawned', s);
}

function resolveTerrain(s) {
  const pts = hullWorld(s);
  let hits = 0, cx = 0, cy = 0;
  for (const p of pts) if (solidAt(p[0], p[1])) { hits++; cx += p[0]; cy += p[1]; }
  if (!hits) return;
  cx /= hits; cy /= hits;
  const n = normalAt(cx, cy, s);
  let free = false;
  for (let k = 0; k < 24; k++) {
    s.x += n.x * 0.75; s.y += n.y * 0.75;
    if (!hullSolid(s)) { free = true; break; }
  }
  if (!free) { s.x = s.px; s.y = s.py; }

  const vn = s.vx * n.x + s.vy * n.y;
  if (vn >= 0) return;
  const impact = -vn;
  if (impact > 5) s.lastImpact = impact;
  const upright = Math.abs(wrapAngle(s.a)) <= P.landMaxAngle * DEG;
  if (n.y > 0.7 && upright && impact <= P.landMaxSpeed) {
    s.landed = true; s.vx = 0; s.vy = 0;
    s.onPad = standingOnPad(s);
    if (impact > 40) simEvent('touchdown', s, cx, cy, n, impact);
    return;
  }
  const tx = s.vx - vn * n.x, ty = s.vy - vn * n.y;
  const bounce = impact < 12 ? 0 : P.restitution;
  const keep = 1 - P.wallFriction;
  s.vx = tx * keep + n.x * impact * bounce;
  s.vy = ty * keep + n.y * impact * bounce;
  if (impact > P.lethalImpact) damage(s, 1e9);
  else if (impact > P.safeImpact) damage(s, (impact - P.safeImpact) * P.damagePerSpeed);
  if (impact > 40) simEvent('crash', s, cx, cy, n, impact);
}

// Moves a ship one step from its input: turning, thrust, gravity and terrain. A browser also runs this to
// predict its own ship. Returns true when the ship can act this step (fire).
export function moveShip(s, h) {
  if (!s.alive) { s.respawnT -= h; if (s.respawnT <= 0) respawn(s); return false; }
  s.invulnT = Math.max(0, s.invulnT - h);
  s.fireCd -= h;
  if (s.minigunT > 0) s.minigunT = Math.max(0, s.minigunT - h);
  const inp = s.input;

  if (s.ballT > 0) { stepBall(s, h); return false; }

  if (s.frozenT > 0) {
    // Frozen solid: no turning, thrust or firing. The ship keeps drifting with the velocity it had
    // when it was hit (no gravity, no drag), though walls, ships and hits can still push it.
    s.frozenT = Math.max(0, s.frozenT - h);
    s.av = 0; s.thrust = 0;
    if (!s.landed) {
      s.x += s.vx * h; s.y += s.vy * h;
      resolveTerrain(s);
    }
    if (s.frozenT === 0) simEvent('thawed', s);
    return false;
  }

  s.av = approach(s.av, inp.turn * P.rotSpeed, P.rotAccel * h);
  s.a += s.av * h;
  const tgt = inp.thrust;
  s.thrust = approach(s.thrust, tgt, (tgt > s.thrust ? P.thrustRampUp : P.thrustRampDown) * h);

  const m = shipMass(s);
  const fx = -Math.sin(s.a), fy = Math.cos(s.a);
  const acc = P.thrustForce * s.thrust / m;

  if (s.landed) {
    if (acc * fy > P.gravity + 1 || !supported(s)) {
      s.landed = false;
    } else {
      s.vx = 0; s.vy = 0;
      if (s.av !== 0) resolveTerrain(s);
      if (s.onPad) {
        s.ammo = Math.min(P.ammoMax, s.ammo + P.rearmRate * h);
        s.hp = Math.min(100, s.hp + P.repairRate * h);
      }
    }
  }
  if (!s.landed) {
    s.onPad = false;
    s.vx += fx * acc * h;
    s.vy += (fy * acc - P.gravity) * h;
    const k = Math.exp(-P.linearDrag * h);
    s.vx *= k; s.vy *= k;
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > P.maxSpeed) { s.vx *= P.maxSpeed / sp; s.vy *= P.maxSpeed / sp; }
    s.x += s.vx * h; s.y += s.vy * h;
    resolveTerrain(s);
  }
  return s.alive;
}

export function updateShip(s, h) {
  if (!moveShip(s, h)) return;
  const inp = s.input;
  if (inp.fire && s.fireCd <= 0 && (s.ammo >= WEAPONS[s.weapon].cost || s.minigunT > 0 || (isPractice() && PR.infiniteAmmo))) fire(s);
  stepBigLaser(s, h);
}

export function shipVsShip() {
  const a = ships[0], b = ships[1];
  if (!a.active || !b.active || !a.alive || !b.alive) return;
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  const R = (shipR(a) + shipR(b)) * P.shipSize;
  if (d >= R || d < 1e-6) return;
  const nx = dx / d, ny = dy / d, overlap = R - d;
  a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
  b.x += nx * overlap / 2; b.y += ny * overlap / 2;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv >= 0) return;
  const ma = shipMass(a), mb = shipMass(b);
  const j = -(1 + P.shipBounce) * rv / (1 / ma + 1 / mb);
  a.vx -= j / ma * nx; a.vy -= j / ma * ny;
  b.vx += j / mb * nx; b.vy += j / mb * ny;
  if (j > 5) { a.landed = false; b.landed = false; }
  if (j > 60) simEvent('sound', 'hit', (a.x + b.x) / 2, (a.y + b.y) / 2);
}
