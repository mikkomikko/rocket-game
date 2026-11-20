import { BALL_MASS, DEG, isPractice, P, PR, WEAPONS } from '../config.js';
import { approach, wrapAngle } from '../util/math.js';
import { carve, H, level, maskAt, solidAt } from '../level/mask.js';
import { hullSolid, hullWorld, localToWorld, ships } from './ship.js';
import { fire, shipR, stepBall } from './weapons.js';
import { EMBER, FIRE, ICE_COL, WHITE } from '../fx/pools.js';
import { dust } from '../fx/explosions.js';
import { terrainDebris } from '../fx/debris.js';
import { emit } from '../fx/particles.js';
import { emitSmoke } from '../fx/smoke.js';
import { resetLava } from '../maps/floors.js';
import { SH } from '../maps/starship/starship.js';
import { RB } from '../maps/hangar/hangar.js';
import { stepBigLaser } from './bigLaser.js';
import { sfx } from '../audio/sfx.js';

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

export function addShake(s, amount) { s.cam.shake = Math.max(s.cam.shake, amount * P.shake); }

export function damage(s, amount) {
  if (!s.alive || s.invulnT > 0 || (isPractice() && PR.noDamage) || (level.theme === 'ship' && RB.cut)) return;
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
  s.group.visible = false;
  const other = ships[1 - s.id];
  if (!isPractice() && level.theme !== 'floors' && level.theme !== 'ship') other.score++;   // in Floors and Starship you score another way
  if (level.theme === 'ship') SH.deaths++;
  const how = eaten === true ? 'eaten' : (eaten || '');
  s.eaten = how === 'eaten';
  s.lava = how === 'lava';
  if (s.eaten) { sfx.bump(s, 400); return; }
  sfx.death(s);
  if (s.lava) {
    for (let i = 0; i < 40; i++) emit(s.x + (Math.random() - 0.5) * 20, s.y, (Math.random() - 0.5) * 160, 80 + Math.random() * 220, 0.5 + Math.random() * 0.7, i % 2 ? FIRE : EMBER, 0.6, 3 + Math.random() * 5);
    for (let i = 0; i < 5; i++) emitSmoke(s.x, s.y + 10, (Math.random() - 0.5) * 30, 30 + Math.random() * 30, 1.5 + Math.random(), 8 + Math.random() * 6);
    addShake(s, 1.2);
    return;
  }
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 260;
    emit(s.x, s.y, s.vx * 0.4 + Math.cos(a) * sp, s.vy * 0.4 + Math.sin(a) * sp, 0.5 + Math.random() * 0.9, i % 3 ? s.color : FIRE, 0.4, 3 + Math.random() * 5);
  }
  emit(s.x, s.y, 0, 0, 0.35, s.color, 0, 70);
  emit(s.x, s.y, 0, 0, 0.2, WHITE, 0, 34);
  if (P.smoke) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = 15 + Math.random() * 70;
      emitSmoke(s.x, s.y, Math.cos(a) * sp + s.vx * 0.2, Math.sin(a) * sp + s.vy * 0.2, P.smokeLife * (0.8 + Math.random() * 0.6), 12 + Math.random() * 10);
    }
  }
  terrainDebris(s.x, s.y, 1.6);
  if (P.destructible) carve(s.x, s.y, P.holeRadius * 2.2);
  addShake(s, 1.6);
  if (other.active) addShake(other, 0.4);
}

export function respawn(s) {
  const sp = level.spawns[s.id];
  const air = isPractice() && PR.spawn === 'air';
  s.x = sp.x; s.y = air ? H / 2 : sp.y + 8 * P.shipSize + 0.6;
  s.px = s.x; s.py = s.y;
  s.vx = 0; s.vy = 0; s.a = 0; s.pa = 0; s.av = 0; s.thrust = 0;
  s.hp = 100; s.ammo = P.ammoMax;
  s.landed = !air; s.onPad = !isPractice(); s.alive = true; s.active = true; s.lastImpact = 0; s.eaten = false; s.lava = false; s.minigunT = 0; s.frozenT = 0; s.ballT = 0;
  if (level.theme === 'floors') resetLava(s.id);
  s.invulnT = P.invulnTime; s.fireCd = 0.2;
  s.cam.x = s.x; s.cam.y = s.y;
  s.group.visible = true;
  sfx.respawn(s);
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
    if (impact > 40) { dust(cx, cy, n, impact * 0.5); sfx.bump(s, impact * 0.4); }
    return;
  }
  const tx = s.vx - vn * n.x, ty = s.vy - vn * n.y;
  const bounce = impact < 12 ? 0 : P.restitution;
  const keep = 1 - P.wallFriction;
  s.vx = tx * keep + n.x * impact * bounce;
  s.vy = ty * keep + n.y * impact * bounce;
  if (impact > P.lethalImpact) damage(s, 1e9);
  else if (impact > P.safeImpact) damage(s, (impact - P.safeImpact) * P.damagePerSpeed);
  if (impact > 40) { addShake(s, Math.min(1, impact / 400)); dust(cx, cy, n, impact); sfx.bump(s, impact); }
}

export function updateShip(s, h) {
  if (!s.alive) { s.respawnT -= h; if (s.respawnT <= 0) respawn(s); return; }
  s.invulnT = Math.max(0, s.invulnT - h);
  s.fireCd -= h;
  if (s.minigunT > 0) s.minigunT = Math.max(0, s.minigunT - h);
  const inp = s.input;

  if (s.ballT > 0) { stepBall(s, h); return; }

  if (s.frozenT > 0) {
    // Frozen solid: no turning, thrust or firing. The ship keeps drifting with the velocity it had
    // when it was hit (no gravity, no drag), though walls, ships and hits can still push it.
    s.frozenT = Math.max(0, s.frozenT - h);
    s.av = 0; s.thrust = 0;
    if (!s.landed) {
      s.x += s.vx * h; s.y += s.vy * h;
      resolveTerrain(s);
    }
    if (Math.random() < 0.25) {
      const a = Math.random() * Math.PI * 2;
      emit(s.x + Math.cos(a) * 12, s.y + Math.sin(a) * 12, s.vx * 0.5 + Math.cos(a) * 20, s.vy * 0.5 + Math.sin(a) * 20, 0.5, ICE_COL, 0.3, 2.5 + Math.random() * 2);
    }
    if (s.frozenT === 0) {
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
        emit(s.x, s.y, s.vx * 0.3 + Math.cos(a) * sp, s.vy * 0.3 + Math.sin(a) * sp, 0.4 + Math.random() * 0.4, i % 2 ? ICE_COL : WHITE, 0.8, 2 + Math.random() * 3);
      }
    }
    return;
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
  if (!s.alive) return;
  if (inp.fire && s.fireCd <= 0 && (s.ammo >= WEAPONS[s.weapon].cost || s.minigunT > 0 || (isPractice() && PR.infiniteAmmo))) fire(s);
  stepBigLaser(s, h);
  if (s.thrust > 0.05 && Math.random() < s.thrust * 0.9) {
    const t = localToWorld(s, 0, -7);
    const sp = 120 + Math.random() * 120;
    emit(t.x, t.y, s.vx - fx * sp + (Math.random() - 0.5) * 50, s.vy - fy * sp + (Math.random() - 0.5) * 50, 0.25 + Math.random() * 0.25, Math.random() < 0.5 ? FIRE : EMBER, 0.2, 3 + Math.random() * 3);
  }
  if (P.smoke && s.thrust > 0.02) {
    s.smokeAcc += P.smokeRate * s.thrust * h;
    while (s.smokeAcc >= 1) {
      s.smokeAcc -= 1;
      const t = localToWorld(s, (Math.random() - 0.5) * 3, -10);
      const sp = 30 + Math.random() * 40;
      emitSmoke(t.x, t.y, s.vx * 0.25 - fx * sp + (Math.random() - 0.5) * 24, s.vy * 0.25 - fy * sp + (Math.random() - 0.5) * 24,
        P.smokeLife * (0.75 + Math.random() * 0.5), (7 + Math.random() * 5) * P.shipSize);
    }
  }
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
  if (j > 60) sfx.hit((a.x + b.x) / 2, (a.y + b.y) / 2);
}
