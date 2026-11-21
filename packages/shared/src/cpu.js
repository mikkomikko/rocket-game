import { P, WEAPONS } from './config.js';
import { game } from './state.js';
import { clamp, wrapAngle } from './math.js';
import { H, level, maskAt, solidAt, W } from './level/mask.js';
import { mapRules } from './maps.js';
import { ships, SHIP_RADIUS } from './ships/ship.js';
import { shipMass } from './ships/physics.js';
import { cycleWeapon } from './ships/weapons.js';
import { FL } from './maps/floors.js';

/* ------------------------------------------------------------------ *
 * The computer pilot: in a one-player game it flies ship 1 against you. It only sets the ship's input
 * (turn, thrust, fire), as a player would, so it plays by the same physics and rules.
 *
 * It finds its way on a coarse grid of the cave (open cells, and rock it could dig through by shooting),
 * flies towards a waypoint with a speed that lets it stop before the next wall, and fights when it sees
 * you: it leads its shots, keeps some distance, and goes back to its pad to rearm and repair. In Floors it
 * races up its own hallway, shooting the blocks in the way.
 *
 * Deterministic: no Math.random, and its aim error is a slow wobble from the game clock, so a match with
 * the CPU replays like any other.
 * ------------------------------------------------------------------ */

// A one-player game has the CPU, except on maps where the players team up against the map (Starship).
export const cpuPlays = () => game.mode === 'solo' && !mapRules().noMatchWins;

const C = 14;   // grid cell size, world units
const OPEN = 1, DIG = 40;   // path costs: open air, rock the CPU would have to shoot through
export const cpuState = {
  gw: 0, gh: 0, cost: new Uint8Array(0), dist: new Float32Array(0), heap: new Int32Array(0),
  gridAt: -1e9, distAt: -1e9, distGoal: -1, map: null,
  mode: 'hunt', landedFor: 0, gun: 0, switchAt: -1e9,
  seenAt: -1e9, lastSeen: -1e9, burstEnd: -1e9, restEnd: -1e9, burstErr: 0, stuckT: 0, lastX: 0, lastY: 0,
};

// A new match: the CPU forgets what it was doing (and rebuilds its map of the cave on the next step).
export function resetCpu() {
  Object.assign(cpuState, {
    gridAt: -1e9, distAt: -1e9, distGoal: -1, map: null, mode: 'hunt', landedFor: 0, gun: 0, switchAt: -1e9,
    seenAt: -1e9, lastSeen: -1e9, burstEnd: -1e9, restEnd: -1e9, burstErr: 0, stuckT: 0, lastX: 0, lastY: 0, clock: 0,
  });
}

/* The grid: a cell is open when a ship fits there, diggable when it is rock (or a Floors block). */
function floorsBlockAt(x, y) {
  if (level.theme !== 'floors') return false;
  return FL.blocks.some((b) => b.alive && x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2);
}
const RING = [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12], [8.5, 8.5], [-8.5, 8.5], [8.5, -8.5], [-8.5, -8.5]];
function buildGrid() {
  cpuState.gw = Math.ceil(W / C); cpuState.gh = Math.ceil(H / C);
  const n = cpuState.gw * cpuState.gh;
  if (cpuState.cost.length !== n) { cpuState.cost = new Uint8Array(n); cpuState.dist = new Float32Array(n); cpuState.heap = new Int32Array(n * 8); }
  for (let gy = 0; gy < cpuState.gh; gy++) {
    for (let gx = 0; gx < cpuState.gw; gx++) {
      const x = gx * C + C / 2, y = gy * C + C / 2;
      let open = true, hard = false;
      for (const [dx, dy] of RING) {
        const v = maskAt(x + dx, y + dy);
        if (v === 0) continue;
        open = false;
        if ((v === 2 && !floorsBlockAt(x + dx, y + dy)) || v === 3) hard = true;
      }
      const dig = P.destructible || level.theme === 'floors';
      cpuState.cost[gy * cpuState.gw + gx] = open ? OPEN : (!hard && dig ? DIG : 0);
    }
  }
  cpuState.gridAt = game.time;
  cpuState.distAt = -1e9;
}
const cellOf = (x, y) => clamp(Math.floor(y / C), 0, cpuState.gh - 1) * cpuState.gw + clamp(Math.floor(x / C), 0, cpuState.gw - 1);
const cellX = (c) => (c % cpuState.gw) * C + C / 2, cellY = (c) => Math.floor(c / cpuState.gw) * C + C / 2;

// Distances to the goal cell from everywhere (Dijkstra on a binary heap of cells, 8 neighbours).
function buildDist(goal) {
  const { gw, gh, cost, dist, heap } = cpuState;
  dist.fill(Infinity);
  let size = 0;
  const push = (c) => {
    let i = size++;
    heap[i] = c;
    while (i > 0) { const p = (i - 1) >> 1; if (dist[heap[p]] <= dist[c]) break; heap[i] = heap[p]; heap[p] = c; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap[--size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= size) break;
      const m = l + 1 < size && dist[heap[l + 1]] < dist[heap[l]] ? l + 1 : l;
      if (dist[heap[m]] >= dist[last]) break;
      heap[i] = heap[m]; i = m;
    }
    heap[i] = last;
    return top;
  };
  dist[goal] = 0;
  push(goal);
  while (size > 0 && size < heap.length - 8) {
    const c = pop(), gx = c % gw, gy = (c - gx) / gw, d = dist[c];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const nc = ny * gw + nx, k = cost[nc];
        if (!k) continue;
        if (dx && dy && (!cost[gy * gw + nx] || !cost[ny * gw + gx])) continue;   // no squeezing past corners
        const nd = d + k * (dx && dy ? 1.414 : 1);
        if (nd < dist[nc]) { dist[nc] = nd; push(nc); }
      }
    }
  }
  cpuState.distGoal = goal;
  cpuState.distAt = game.time;
}

// Clear line between two points for a ship-wide body (or a bullet, with r = 0).
function clearLine(x0, y0, x1, y1, r = 0) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / 5));
  const px = d > 0 ? -(y1 - y0) / d * r : 0, py = d > 0 ? (x1 - x0) / d * r : 0;
  for (let i = 1; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
    if (solidAt(x, y) || (r && (solidAt(x + px, y + py) || solidAt(x - px, y - py)))) return false;
  }
  return true;
}
// How far a ship can fly from (x, y) along (dx, dy) before it meets a wall (up to max).
function clearance(x, y, dx, dy, max = 320) {
  const r = SHIP_RADIUS * P.shipSize, px = -dy * r * 0.7, py = dx * r * 0.7;
  for (let t = r; t < max; t += 6) {
    const qx = x + dx * t, qy = y + dy * t;
    if (solidAt(qx, qy) || solidAt(qx + px, qy + py) || solidAt(qx - px, qy - py)) return t - r;
  }
  return max;
}

// Where to go next: the farthest cell along the downhill path that is in plain view, and whether the
// next cell on the path is rock to shoot through.
function waypoint(s) {
  let c = cellOf(s.x, s.y);
  if (cpuState.cost[c] !== OPEN) {   // close to a wall (or a pad): start from the nearest open cell around
    const gx0 = c % cpuState.gw, gy0 = Math.floor(c / cpuState.gw);
    let best = -1, bestD = Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = gx0 + dx, ny = gy0 + dy;
      if (nx < 0 || ny < 0 || nx >= cpuState.gw || ny >= cpuState.gh) continue;
      const nc = ny * cpuState.gw + nx;
      const dd = dx * dx + dy * dy;
      if (cpuState.cost[nc] === OPEN && isFinite(cpuState.dist[nc]) && dd < bestD) { best = nc; bestD = dd; }
    }
    if (best < 0) return { x: s.x, y: s.y + 40, dig: false, reach: false, climb: true };
    c = best;
  }
  let wp = c, dig = false;
  for (let step = 0; step < 14; step++) {
    const gx = c % cpuState.gw, gy = Math.floor(c / cpuState.gw);
    let next = -1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= cpuState.gw || ny >= cpuState.gh) continue;
      const nc = ny * cpuState.gw + nx;
      if (cpuState.dist[nc] < cpuState.dist[next < 0 ? c : next]) next = nc;
    }
    if (next < 0) break;
    if (cpuState.cost[next] === DIG) { if (step < 3) dig = true; if (step === 0) wp = next; break; }
    if (step > 0 && !clearLine(s.x, s.y, cellX(next), cellY(next), 6)) break;
    wp = next; c = next;
  }
  return { x: cellX(wp), y: cellY(wp), dig, reach: true };
}

// A slow, smooth wobble in [-1, 1] from the game clock: the CPU's aim error.
const wobble = (t) => (Math.sin(t * 1.7) + Math.sin(t * 2.9 + 1.3) * 0.6 + Math.sin(t * 0.63 + 4.1) * 0.4) / 2;

/* Flying: turn the nose towards an angle, and thrust towards a wanted velocity. */
const noseAngle = (dx, dy) => Math.atan2(-dx, dy);
function steer(s, inp, want) {
  const err = wrapAngle(want - s.a);
  inp.turn = clamp((err * 7 - s.av * 0.15) / P.rotSpeed, -1, 1);
  return err;
}
function flyTowards(s, inp, vx, vy, aimAt = null, maxTilt = 2.6) {
  const accMax = P.thrustForce / shipMass(s);
  const k = 3;
  const ax = (vx - s.vx) * k, ay = (vy - s.vy) * k + P.gravity;
  if (aimAt === null) {
    // The nose follows the thrust we need (gravity is weak: to go down it thrusts down), but never tips past maxTilt.
    const err = steer(s, inp, clamp(noseAngle(ax, ay), -maxTilt, maxTilt));
    const along = -Math.sin(s.a) * ax + Math.cos(s.a) * ay;
    inp.thrust = Math.abs(err) < 0.8 ? clamp(along / accMax, 0, 1) : 0;
  } else {
    // Aiming: the nose is busy, so thrust only as far as it helps.
    steer(s, inp, aimAt);
    const along = -Math.sin(s.a) * ax + Math.cos(s.a) * ay;
    inp.thrust = clamp(along / accMax, 0, 1);
  }
}
// A wanted velocity, slowed down to what can still stop before the wall that way.
function safeVel(s, vx, vy) {
  const vl = Math.hypot(vx, vy);
  if (vl < 1) return { x: vx, y: vy };
  const lim = safeSpeed(s, clearance(s.x, s.y, vx / vl, vy / vl));
  return vl > lim ? { x: vx * lim / vl, y: vy * lim / vl } : { x: vx, y: vy };
}
// The speed that still lets the ship stop before a wall `room` away.
const safeSpeed = (s, room) => Math.sqrt(2 * 0.6 * (P.thrustForce / shipMass(s)) * Math.max(0, room - 18));

/* One step of the CPU's input for ship s. */
export function cpuInput(s, h) {
  const inp = s.input;
  inp.turn = 0; inp.thrust = 0; inp.fire = false;
  if (!s.alive || !s.active) return;
  if (game.time < cpuState.clock) resetCpu();   // the clock went back: a new match
  cpuState.clock = game.time;
  if (cpuState.map !== level.builtMap || game.time - cpuState.gridAt > 1.2 || game.time < cpuState.gridAt) { cpuState.map = level.builtMap; buildGrid(); }

  const foe = ships[1 - s.id];
  const race = level.theme === 'floors';
  const pad = level.spawns[s.id];
  const foeHere = foe.active && foe.alive && !mapRules().coop;
  const dFoe = Math.hypot(foe.x - s.x, foe.y - s.y);
  const sees = foeHere && dFoe < 560 && clearLine(s.x, s.y, foe.x, foe.y);
  pickWeapon(s, sees, dFoe);
  const gun = WEAPONS[s.weapon];

  // What to do: rearm and repair on the pad when low, else race (Floors) or hunt and fight the player.
  if (s.ammo < Math.max(6, gun.cost * 2) || s.hp < 35) cpuState.mode = 'rearm';
  if (cpuState.mode === 'rearm' && s.landed && s.onPad && s.ammo >= P.ammoMax * 0.95 && s.hp >= 95) cpuState.mode = 'hunt';
  if (cpuState.mode === 'rearm' && s.landed && s.onPad && sees && dFoe < 300 && s.ammo > 15) cpuState.mode = 'hunt';   // defend the pad
  if (race) cpuState.mode = 'race';

  let gx, gy;
  if (cpuState.mode === 'race') {
    const [x0, x1] = FL.halls[s.id];
    gx = (x0 + x1) / 2; gy = Math.min(H - 20, FL.finish + 40);
  } else if (cpuState.mode === 'rearm') { gx = pad.x; gy = pad.y + 30; }
  else if (foeHere) { gx = foe.x; gy = foe.y; }
  else { gx = W / 2; gy = H / 2; }
  const goal = cellOf(gx, gy);
  if (goal !== cpuState.distGoal || game.time - cpuState.distAt > 0.4 || game.time < cpuState.distAt) buildDist(goal);

  // Sitting on the pad to rearm: stay put, upright, and shoot back if the player comes close.
  if (cpuState.mode === 'rearm' && s.landed && s.onPad) {
    if (sees) aimAndFire(s, inp, foe, dFoe, true);
    inp.thrust = 0;
    if (!sees) steer(s, inp, 0);
    return;
  }
  // Landing on the pad: come down slowly from right above it.
  if (cpuState.mode === 'rearm' && Math.abs(s.x - pad.x) < 40 && s.y > pad.y && s.y - pad.y < 120 && clearLine(s.x, s.y, pad.x, pad.y + 12, 6)) {
    const vy = -clamp((s.y - pad.y) * 0.9, 25, 70);
    flyTowards(s, inp, (pad.x - s.x) * 1.5, vy, null, 0.3);
    return;
  }

  // Taking off from the ground.
  if (s.landed) {
    cpuState.landedFor += h;
    steer(s, inp, 0);
    inp.thrust = 1;
    if (sees && cpuState.mode !== 'race') aimAndFire(s, inp, foe, dFoe, false);
    return;
  }
  cpuState.landedFor = 0;

  // Where the path goes, and how fast it's safe to fly there.
  const wp = waypoint(s);
  cpuState.wp = wp;
  let dx = wp.x - s.x, dy = wp.y - s.y;
  let d = Math.hypot(dx, dy);
  if (d < 1) { dx = gx - s.x; dy = gy - s.y; d = Math.hypot(dx, dy) || 1; }
  const ux = dx / d, uy = dy / d;
  const room = clearance(s.x, s.y, ux, uy);
  const speed = Math.max(40, Math.min(cpuState.mode === 'race' ? 230 : 190, d * 2.2 + 30, safeSpeed(s, room)));

  // Fighting: keep a good distance and point the guns at the player.
  if (sees && cpuState.mode === 'hunt') {
    const want = 240;
    const rx = (foe.x - s.x) / (dFoe || 1), ry = (foe.y - s.y) / (dFoe || 1);
    const closing = clamp((dFoe - want) * 0.8, -120, 120);
    const { x: vx, y: vy } = safeVel(s, rx * closing, ry * closing);   // don't back into a wall
    if (danger(s)) { avoid(s, inp); return; }
    const aim = aimAndFire(s, inp, foe, dFoe, false);
    flyTowards(s, inp, vx, vy, aim);
    // Falling with the nose off upright: a short burst upwards now and then keeps it in the air.
    if (s.vy < -70 && Math.abs(wrapAngle(s.a)) < 1.2) inp.thrust = Math.max(inp.thrust, 0.6);
    return;
  }

  if (danger(s)) { avoid(s, inp); return; }
  if (race) {   // an asteroid drifting into the way: dodge it
    const rock = asteroidThreat(s);
    if (rock) {
      // They drift sideways, so get out of their row: up past it, or down below it.
      const v = safeVel(s, 0, s.y >= rock.y ? 150 : -150);
      flyTowards(s, inp, v.x, v.y);
      return;
    }
  }

  // Stuck against rock on the way (or the path goes through it): shoot a way through.
  const moved = Math.hypot(s.x - cpuState.lastX, s.y - cpuState.lastY);
  cpuState.lastX = s.x; cpuState.lastY = s.y;
  cpuState.stuckT = moved < 12 * h ? cpuState.stuckT + h : Math.max(0, cpuState.stuckT - h * 2);
  if (wp.dig || cpuState.stuckT > 2) {
    const ang = noseAngle(ux, uy);
    flyTowards(s, inp, ux * 20, uy * 20, ang);
    if (Math.abs(wrapAngle(ang - s.a)) < 0.12 && s.ammo > 4 && s.weapon === cpuState.gun) inp.fire = true;
    if (cpuState.stuckT > 3) cpuState.stuckT = 0;
    return;
  }
  flyTowards(s, inp, ux * speed, uy * speed);
}

// Like a player: the Blaster to travel and dig, and (a skilled CPU) the Cannon up close when there's ammo for it. The weapon
// key cycles through every weapon, so it takes a few presses (and never fires on the way).
const BLASTER = WEAPONS.findIndex((w) => w.id === 'basic'), CANNON = WEAPONS.findIndex((w) => w.id === 'heavy');
function pickWeapon(s, sees, d) {
  if (s.minigunT > 0) cpuState.gun = s.weapon;
  else if (P.cpuSkill >= 0.6 && cpuState.mode === 'hunt' && sees && d < 200 && s.ammo >= 30) cpuState.gun = CANNON;
  else if (!sees || d > 280 || s.ammo < 15 || cpuState.mode !== 'hunt') cpuState.gun = BLASTER;
  if (s.weapon !== cpuState.gun && game.time - cpuState.switchAt > 0.12) { cycleWeapon(s); cpuState.switchAt = game.time; }
}

// Floors: an asteroid in our hallway that will be about where we'll be within the next moment.
function asteroidThreat(s) {
  for (const a of FL.asteroids) {
    if (a.hall !== s.id) continue;
    for (let t = 0; t <= 0.9; t += 0.15) {
      const d = Math.hypot(a.x + a.vx * t - (s.x + s.vx * t), a.y - (s.y + s.vy * t));
      if (d < a.r + SHIP_RADIUS * P.shipSize + 22) return a;
    }
  }
  return null;
}

// About to hit something at this speed?
function danger(s) {
  const v = Math.hypot(s.vx, s.vy);
  if (v < 60) return false;
  const room = clearance(s.x, s.y, s.vx / v, s.vy / v, 260);
  return v > safeSpeed(s, room) + 25;
}
function avoid(s, inp) {
  flyTowards(s, inp, s.vx * 0.15, s.vy * 0.15);   // brake hard
}

/* Aiming, with human flaws scaled by P.cpuSkill (0 sloppy, 1 sharp):
 *   it takes a moment to react after it first sees you,
 *   it leads moving targets only partly,
 *   its aim wobbles, and each burst starts a little off,
 *   it fires in short bursts with pauses in between, not a steady stream.
 * Points at where it thinks the player will be and returns the nose angle it wants. */
function aimAndFire(s, inp, foe, d, still) {
  const skill = clamp(P.cpuSkill, 0, 1);
  const gun = WEAPONS[s.weapon];
  const bs = P.bulletSpeed * gun.speed;
  const t = d / bs, lead = 0.3 + 0.7 * skill;
  const tx = foe.x + (foe.vx - s.vx * P.inheritVelocity) * t * lead;
  const ty = foe.y + (foe.vy - s.vy * P.inheritVelocity) * t * lead + 0.5 * P.gravity * P.bulletGravity * gun.grav * t * t;
  const amp = 0.5 - 0.38 * skill;   // radians: about ±22° wobble at the default skill 0.3
  const err = wobble(game.time * (0.8 + skill)) * amp + cpuState.burstErr;
  const ang = noseAngle(tx - s.x, ty - s.y) + err;
  if (still) steer(s, inp, ang);

  if (game.time - cpuState.lastSeen > 1) cpuState.seenAt = game.time;   // lost sight for a while: react anew
  cpuState.lastSeen = game.time;
  const reacting = game.time - cpuState.seenAt < 0.9 - 0.6 * skill;

  const off = Math.abs(wrapAngle(ang - s.a));
  const want = s.weapon === cpuState.gun && foe.invulnT <= 0.2 && d < 440 && !reacting
    && off < 0.03 + 14 / Math.max(60, d) && clearLine(s.x, s.y, foe.x, foe.y);
  inp.fire = want && trigger(skill, amp);
  return ang;
}
// Bursts: fire for a short while, then rest; a new burst starts with a fresh aim offset.
function trigger(skill, amp) {
  const now = game.time;
  if (now < cpuState.burstEnd) return true;
  if (now < cpuState.restEnd) return false;
  const r = (wobble(now * 3.7 + 11) + 1) / 2;   // 0..1, varies burst to burst
  cpuState.burstEnd = now + 0.2 + 0.35 * skill + 0.15 * r;
  cpuState.restEnd = cpuState.burstEnd + (1.5 - 1.0 * skill) * (0.7 + 0.6 * r);
  cpuState.burstErr = (r - 0.5) * amp;
  return true;
}
