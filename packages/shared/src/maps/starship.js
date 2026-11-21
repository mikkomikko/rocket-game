import { P } from '../config.js';
import { clamp, segDist, wrapAngle } from '../math.js';
import { H, level, repaint, solidAt, W } from '../level/mask.js';
import { simEvent } from '../events.js';
import { random } from '../random.js';
import { armForMatch, SHIP_RADIUS, ships } from '../ships/ship.js';
import { addShake, damage, respawn } from '../ships/physics.js';
import { clearBullets, spawnBullet } from '../bullets.js';
import { applyRobot, encodeRobot, hurtRobot, RB, resetRobot, robotEye, robotShot, stepRobotFight } from './hangar.js';

/* ------------------------------------------------------------------ *
 * Starship and Robot hangar rules (level theme 'ship'): co-op waves of red robot ships, the raygun on
 * the roof, the boss and the escape door, ammo boxes and medkits; the hangar's giant robot is in
 * hangar.js. State only; the client draws it (client maps/starship, maps/hangar) and hears:
 *   shipLevel(n)                    a player chose to start at level n
 *   shipWave(i) / shipCleared(i)    wave i (an index into WAVES) started / was cleared
 *   shipEscape()                    the boss is down: the door opens
 *   enemySpawned(x, y, r)           a red ship of radius r appeared
 *   enemyHit(x, y)                  a shot hit a red ship
 *   enemyKilled(x, y, vx, vy, scale)
 *   enemyFired(x, y)                a red ship fired (its bullets are ordinary pool bullets, owner 2)
 *   laserHit(x, y)                  a big laser burned a ship there
 *   supplyTaken(s, kind, x, y)      ship s took an 'ammo' box or a 'medkit'
 * and the robot's events (hangar.js).
 * ------------------------------------------------------------------ */
export const WAVES = [
  { bots: 1 }, { bots: 3 }, { bots: 5 }, { bots: 8 }, { bots: 10 },
  { bots: 5, juggs: 2 }, { bots: 5, juggs: 2, raygun: true }, { boss: true },
];
export const EKIND = {
  bot: { hp: 24, r: 13, speed: 210, keep: 260, scale: 1.15, fire: [1.1, 1.8], laser: 0, shots: 1 },
  jugg: { hp: 160, r: 27, speed: 120, keep: 340, scale: 2.4, fire: [1.4, 2.0], laser: 5, shots: 2 },
  boss: { hp: 720, r: 50, speed: 85, keep: 420, scale: 4.4, fire: [0.5, 0.7], laser: 5, shots: 3 },
};
export const LASER_WARN = 0.9, LASER_FIRE = 0.35, LASER_DAMAGE = 40;
const AMMO_BACK = 12, MEDKIT_BACK = 25;

// enemies: { id, kind, K, x, y, px, py, vx, vy, a, pa, hp, ... }; ids let a browser keep each one's mesh.
export const SH = { spec: null, wave: -1, state: 'off', timer: 0, pending: [], spawnT: 0, spawnIdx: 0, enemies: [], lasers: [], time: 0, deaths: 0, door: 0, doorOpen: false, startLevel: 1, nextId: 1 };
export const RG = { x: 900, y: 0, ang: -Math.PI / 2, active: false, cd: 3, laser: null };
// Ammo boxes and medkits: { x, y, on, t } each, from the level spec.
export const AM = [], MK = [];
const robotMode = () => !!SH.spec && SH.spec.mode === 'robot';
const robotUp = () => robotMode() && RB.on && !RB.dead;

export function nearestPlayer(x, y) {
  let best = null, bd = Infinity;
  for (const s of ships) {
    if (!s.active || !s.alive) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function lineOfSight(x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8);
  for (let i = 1; i < n; i++) { const t = i / n; if (solidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false; }
  return true;
}
function laserLength(ox, oy, ang) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let d = 0;
  while (d < 2600 && !solidAt(ox + dx * d, oy + dy * d)) d += 5;
  return d;
}

export function spawnEnemy(kind, at) {
  const K = EKIND[kind], sp = at || (kind === 'boss' ? SH.spec.bossSpawn : SH.spec.spawnPts[SH.spawnIdx++ % SH.spec.spawnPts.length]);
  const e = { id: SH.nextId++, kind, K, x: sp[0], y: sp[1], px: sp[0], py: sp[1], vx: 0, vy: 0, a: Math.PI, pa: Math.PI, hp: K.hp, fireCd: 1 + random(), laserCd: K.laser ? 2.5 + random() : 0, laser: null, orbit: random() < 0.5 ? 1 : -1, flash: 0, thrust: 0, dead: false };
  simEvent('enemySpawned', e.x, e.y, K.r);
  SH.enemies.push(e);
  return e;
}
export function dropLaser(owner) {
  if (owner.laser) { SH.lasers = SH.lasers.filter((L) => L !== owner.laser); owner.laser = null; }
}
export function killEnemy(e, by) {
  if (e.dead) return;
  e.dead = true;
  simEvent('enemyKilled', e.x, e.y, e.vx, e.vy, e.K.scale);
  for (const s of ships) if (s.active && Math.hypot(s.x - e.x, s.y - e.y) < 500) addShake(s, 0.3 * e.K.scale);
  if (by) by.score++;
  dropLaser(e);
}
function hurtEnemy(e, dmg, flash, by) {
  e.hp -= dmg;
  e.flash = flash;
  if (e.hp <= 0) killEnemy(e, by);
}
export function bulletHitsEnemy(owner, x, y, dmg = P.bulletDamage, kind = 0) {
  if (robotMode() && robotShot(x, y, dmg, ships[owner], kind)) return true;
  for (const e of SH.enemies) {
    if (e.dead) continue;
    const r = e.K.r + 2;
    if ((x - e.x) ** 2 + (y - e.y) ** 2 > r * r) continue;
    simEvent('enemyHit', x, y);
    hurtEnemy(e, dmg, 0.08, ships[owner]);
    return true;
  }
  return false;
}

// Big lasers: a warning line first (L.phase 'warn'), then a thick beam that hurts ('fire').
function laserOrigin(L) {
  if (L.owner === RG) return [RG.x + Math.cos(L.ang) * 56, RG.y + Math.sin(L.ang) * 56];
  if (L.owner === RB) return robotEye();
  const e = L.owner;
  return [e.x + Math.cos(L.ang) * e.K.r, e.y + Math.sin(L.ang) * e.K.r];
}
export function startLaser(owner, ang) {
  const L = { owner, ang, phase: 'warn', t: LASER_WARN, hit: new Set(), width: owner === RG ? 30 : owner === RB ? RB.beamW : owner.kind === 'boss' ? 36 : 26, ox: 0, oy: 0, len: 0, locked: false };
  owner.laser = L;
  SH.lasers.push(L);
  return L;
}
function stepLasers(h) {
  for (const L of SH.lasers) {
    if (L.owner !== RG && L.owner.dead) { L.done = true; continue; }
    [L.ox, L.oy] = laserOrigin(L);
    L.len = laserLength(L.ox, L.oy, L.ang);
    L.t -= h;
    if (L.phase === 'warn') {
      if (L.t <= 0) {
        L.phase = 'fire'; L.t = L.fireT || LASER_FIRE;
        for (const s of ships) if (s.active) addShake(s, 0.35);
      }
      continue;
    }
    for (const s of ships) {
      if (!s.active || !s.alive || L.hit.has(s)) continue;
      if (segDist(s.x, s.y, L.ox, L.oy, L.ang, L.len) < L.width / 2 + SHIP_RADIUS * P.shipSize * 0.7) {
        L.hit.add(s);
        damage(s, LASER_DAMAGE);
        simEvent('laserHit', s.x, s.y);
      }
    }
    if (L.t <= 0) L.done = true;
  }
  for (const L of SH.lasers) if (L.done && L.owner.laser === L) L.owner.laser = null;
  SH.lasers = SH.lasers.filter((L) => !L.done);
}

function stepEnemy(e, h) {
  const K = e.K, s = nearestPlayer(e.x, e.y);
  e.px = e.x; e.py = e.y; e.pa = e.a;
  e.flash = Math.max(0, e.flash - h);
  let dvx = 0, dvy = 0, tAng = e.a;
  if (s) {
    const dx = s.x - e.x, dy = s.y - e.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const radial = d > K.keep + 60 ? 1 : d < K.keep - 60 ? -0.8 : 0;
    dvx = (ux * radial - uy * e.orbit * 0.6) * K.speed;
    dvy = (uy * radial + ux * e.orbit * 0.6) * K.speed;
    tAng = Math.atan2(dy, dx) - Math.PI / 2;
  }
  for (let k = 0; k < 8; k++) {   // steer away from walls and boxes
    const a = k * Math.PI / 4;
    if (solidAt(e.x + Math.cos(a) * (K.r + 45), e.y + Math.sin(a) * (K.r + 45))) { dvx -= Math.cos(a) * K.speed * 0.9; dvy -= Math.sin(a) * K.speed * 0.9; }
  }
  for (const o of SH.enemies) {   // don't bunch up
    if (o === e || o.dead) continue;
    const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy), R = K.r + o.K.r + 10;
    if (d < R && d > 1e-6) { dvx += dx / d * K.speed * 0.8; dvy += dy / d * K.speed * 0.8; }
  }
  const k = Math.min(1, h * 2.2);
  e.vx += (dvx - e.vx) * k;
  e.vy += (dvy - e.vy) * k;
  const sp = Math.hypot(e.vx, e.vy), top = K.speed * 1.2;
  if (sp > top) { e.vx *= top / sp; e.vy *= top / sp; }
  e.x += e.vx * h;
  e.y += e.vy * h;
  for (let k2 = 0; k2 < 8; k2++) {
    const a = k2 * Math.PI / 4;
    if (solidAt(e.x + Math.cos(a) * K.r, e.y + Math.sin(a) * K.r)) { e.x = e.px; e.y = e.py; e.vx *= -0.4; e.vy *= -0.4; break; }
  }
  e.thrust = clamp(sp / K.speed, 0, 1);
  const want = e.laser ? e.laser.ang - Math.PI / 2 : tAng;
  e.a += clamp(wrapAngle(want - e.a), -3 * h, 3 * h);
  if (!s) return;
  const see = lineOfSight(e.x, e.y, s.x, s.y), dist = Math.hypot(s.x - e.x, s.y - e.y);
  e.fireCd -= h;
  if (e.fireCd <= 0 && see && dist < 800 && !(e.laser && e.laser.phase === 'fire')) {
    e.fireCd = K.fire[0] + random() * (K.fire[1] - K.fire[0]);
    const base = Math.atan2(s.y - e.y, s.x - e.x);
    for (let i = 0; i < K.shots; i++) {
      const ang = base + (i - (K.shots - 1) / 2) * 0.14 + (random() - 0.5) * 0.12;
      spawnBullet(2, e.x + Math.cos(base) * K.r, e.y + Math.sin(base) * K.r, Math.cos(ang) * 470, Math.sin(ang) * 470, 2.2);
    }
    simEvent('enemyFired', e.x + Math.cos(base) * K.r, e.y + Math.sin(base) * K.r);
  }
  if (K.laser) {
    e.laserCd -= h;
    if (e.laserCd <= 0 && see && !e.laser) { e.laserCd = K.laser; startLaser(e, Math.atan2(s.y - e.y, s.x - e.x)); }
  }
}
function stepRaygun(h) {
  if (!RG.active) return;
  const s = nearestPlayer(RG.x, RG.y);
  if (s && !RG.laser) {
    const want = clamp(Math.atan2(s.y - RG.y, s.x - RG.x), -Math.PI + 0.15, -0.15);
    RG.ang += clamp(want - RG.ang, -1.6 * h, 1.6 * h);
  }
  RG.cd -= h;
  if (RG.cd <= 0 && s && !RG.laser) { RG.cd = 3; startLaser(RG, RG.ang); }
}
function setRaygun(on) {
  RG.active = on;
  RG.cd = 3;
  if (!on) dropLaser(RG);
}
// The exit door is part of the hull until the boss is beaten. A browser online calls this from apply too,
// so its own ship flies through the same opening.
export function setDoor(open) {
  if (!SH.spec || !SH.spec.door || SH.doorOpen === open) return;
  SH.doorOpen = open;
  const [x0, y0, x1, y1] = SH.spec.door, m = level.mask;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[(H - 1 - y) * W + x] = open ? 0 : 2;
  repaint(x0 - 3, H - y1 - 3, x1 + 3, H - y0 + 3);
}
function startWave(i) {
  SH.wave = i;
  if (i >= WAVES.length) {
    SH.state = 'escape';
    setDoor(true);
    simEvent('shipEscape');
    return;
  }
  const w = WAVES[i];
  SH.pending = [...Array(w.bots || 0).fill('bot'), ...Array(w.juggs || 0).fill('jugg'), ...(w.boss ? ['boss'] : [])];
  SH.state = 'fight';
  SH.spawnT = 0.3;
  setRaygun(!!w.raygun);
  simEvent('shipWave', i);
}
function waveCleared() {
  const w = WAVES[SH.wave];
  if (w.raygun) setRaygun(false);
  if (w.boss) { startWave(SH.wave + 1); return; }
  SH.state = 'between';
  SH.timer = 3;
  simEvent('shipCleared', SH.wave);
}
// Escaped, or the robot is beaten: the browser shows the finish panel while SH.state is 'done'.
export function finishRun() {
  SH.state = 'done';
  RB.cut = false;
}
// The level chooser: start at level 1 to 5. The timer starts when you pick.
export function chooseLevel(n) {
  if (SH.state !== 'choose') return;
  SH.startLevel = n;
  SH.wave = n - 2;
  SH.state = 'between';
  SH.timer = 2;
  SH.time = 0;
  simEvent('shipLevel', n);
}
const supply = (list, y) => list.map(([x, y0]) => ({ x, y: y0 + y, on: true, t: 0 }));
// Fly into an ammo box to refill your ammo, or into a medkit to heal to full; each comes back a while after it is taken.
function stepSupplies(list, kind, back, h) {
  for (const a of list) {
    if (!a.on) { a.t -= h; if (a.t <= 0) a.on = true; continue; }
    for (const s of ships) {
      if (!s.active || !s.alive || (kind === 'ammo' ? s.ammo >= P.ammoMax - 0.5 : s.hp >= 99.5)) continue;
      if (Math.hypot(s.x - a.x, s.y - a.y) > 24 * Math.max(1, P.shipSize)) continue;
      if (kind === 'ammo') s.ammo = P.ammoMax; else s.hp = 100;
      a.on = false;
      a.t = back;
      simEvent('supplyTaken', s, kind, a.x, a.y);
      break;
    }
  }
}

// A new match on this map, or the map was just built (or replaced by another theme: then all goes off).
function resetStarship() {
  const on = level.theme === 'ship';
  if (SH.spec !== level.spec) SH.doorOpen = false;   // a freshly built map: the door is shut in the mask
  else setDoor(false);
  SH.spec = on ? level.spec : null;
  SH.enemies = [];
  SH.lasers = [];
  SH.pending = [];
  SH.wave = -1;
  SH.spawnIdx = 0;
  SH.time = 0;
  SH.deaths = 0;
  SH.door = 0;
  SH.nextId = 1;
  setRaygun(false);
  RG.ang = -Math.PI / 2;
  RG.y = H - 84;   // the raygun hangs from the roof
  AM.length = MK.length = 0;
  if (on) { AM.push(...supply(SH.spec.ammo, 16)); MK.push(...supply(SH.spec.medkits, 17)); }
  resetRobot();
  SH.state = on ? 'choose' : 'off';
  SH.timer = 3;
  if (on && robotMode()) {
    SH.state = 'between';
    simEvent('robotComing');
  }
}
function stepStarship(h) {
  if (SH.state === 'off') return;
  if (SH.state !== 'done' && SH.state !== 'choose') SH.time += h;
  if (robotMode()) stepRobotFight(h);
  else if (SH.state === 'between') {
    SH.timer -= h;
    if (SH.timer <= 0) startWave(SH.wave + 1);
  } else if (SH.state === 'fight') {
    if (SH.pending.length) {
      SH.spawnT -= h;
      if (SH.spawnT <= 0) { spawnEnemy(SH.pending.shift()); SH.spawnT = 0.45; }
    } else if (!SH.enemies.length) waveCleared();
  } else if (SH.state === 'escape') {
    SH.door = Math.min(1, SH.door + h * 0.8);
    for (const s of ships) if (s.active && s.alive && s.x > SH.spec.exitX) { finishRun(); break; }
  }
  for (const e of SH.enemies) if (!e.dead) stepEnemy(e, h);
  SH.enemies = SH.enemies.filter((e) => !e.dead);
  stepRaygun(h);
  stepLasers(h);
  stepSupplies(AM, 'ammo', AMMO_BACK, h);
  stepSupplies(MK, 'medkit', MEDKIT_BACK, h);
  for (const e of SH.enemies) {   // bumping into a robot hurts
    for (const s of ships) {
      if (!s.active || !s.alive) continue;
      const dx = s.x - e.x, dy = s.y - e.y, d = Math.hypot(dx, dy), R = e.K.r + SHIP_RADIUS * P.shipSize * 0.8;
      if (d >= R || d < 1e-6) continue;
      s.x = e.x + dx / d * R; s.y = e.y + dy / d * R;
      s.vx += dx / d * 120; s.vy += dy / d * 120;
      s.landed = false;
      s.rockCd = Math.max(0, (s.rockCd || 0) - h);
      if (!(s.rockCd > 0)) { s.rockCd = 0.6; damage(s, 10); }
    }
  }
}
// Restart after the finish (online; a browser on its own rebuilds the whole map instead).
function restart() {
  for (const s of ships) {
    s.score = 0; armForMatch(s);
    if (s.active) respawn(s);
  }
  clearBullets();
  resetStarship();
}

/* Online snapshot, compact:
 *   [head, enemies, lasers, raygun, supplies, robot]
 *   head      [state, wave, time, deaths, door, doorOpen, startLevel, pending]   (state: index in STATES)
 *   enemies   flat, 8 each: id, kind (index in KINDS), x, y, a, hp, flash (0/1), thrust
 *   lasers    flat, 8 each: owner (-1 raygun, -2 robot, else an enemy id), phase (0 warn, 1 fire), locked, ox, oy, ang, len, width
 *   raygun    [active, ang]
 *   supplies  0/1 per ammo box, then per medkit
 *   robot     0 on the Starship, else encodeRobot() (hangar.js) */
const STATES = ['off', 'choose', 'between', 'fight', 'escape', 'done', 'robot'], KINDS = ['bot', 'jugg', 'boss'];
export const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
const ownerCode = (o) => (o === RG ? -1 : o === RB ? -2 : o.id);
function encode() {
  const en = [], la = [];
  for (const e of SH.enemies) en.push(e.id, KINDS.indexOf(e.kind), r1(e.x), r1(e.y), r3(e.a), Math.ceil(e.hp), e.flash > 0 ? 1 : 0, r2(e.thrust));
  for (const L of SH.lasers) la.push(ownerCode(L.owner), L.phase === 'fire' ? 1 : 0, L.locked ? 1 : 0, r1(L.ox), r1(L.oy), r3(L.ang), Math.round(L.len), L.width);
  return [
    [STATES.indexOf(SH.state), SH.wave, r2(SH.time), SH.deaths, r2(SH.door), SH.doorOpen ? 1 : 0, SH.startLevel, SH.pending.length],
    en, la, [RG.active ? 1 : 0, r3(RG.ang)], [...AM, ...MK].map((a) => (a.on ? 1 : 0)), robotMode() ? encodeRobot() : 0,
  ];
}
function apply([head, en, la, rg, sup, robot]) {
  let doorOpen;
  [SH.state, SH.wave, SH.time, SH.deaths, SH.door, doorOpen, SH.startLevel] = head;
  SH.state = STATES[SH.state];
  SH.pending = new Array(head[7]).fill('bot');
  setDoor(!!doorOpen);
  const old = new Map(SH.enemies.map((e) => [e.id, e]));
  SH.enemies = [];
  for (let i = 0; i < en.length; i += 8) {
    const id = en[i], kind = KINDS[en[i + 1]];
    let e = old.get(id);
    if (!e || e.kind !== kind) e = { id, kind, K: EKIND[kind], x: en[i + 2], y: en[i + 3], a: en[i + 4], dead: false };
    e.px = e.x; e.py = e.y; e.pa = e.a;   // where it was, to draw it moving toward the new spot
    [e.x, e.y, e.a, e.hp] = en.slice(i + 2, i + 6);
    e.flash = en[i + 6] ? 1 : 0; e.thrust = en[i + 7]; e.laser = null;
    SH.enemies.push(e);
  }
  RG.active = !!rg[0]; RG.ang = rg[1]; RG.laser = null;
  sup.forEach((on, i) => { const a = i < AM.length ? AM[i] : MK[i - AM.length]; if (a) a.on = !!on; });
  if (robot) applyRobot(robot);
  RB.laser = null;
  const byId = new Map(SH.enemies.map((e) => [e.id, e]));
  SH.lasers = [];
  for (let i = 0; i < la.length; i += 8) {
    const owner = la[i] === -1 ? RG : la[i] === -2 ? RB : byId.get(la[i]);
    if (!owner) continue;
    const L = { owner, phase: la[i + 1] ? 'fire' : 'warn', locked: !!la[i + 2], ox: la[i + 3], oy: la[i + 4], ang: la[i + 5], len: la[i + 6], width: la[i + 7], t: 0, hit: new Set() };
    owner.laser = L;
    SH.lasers.push(L);
  }
}

// Players' controls: { level: 1..5 } on the level chooser, { restart: true } once the run is done.
function action(s, a) {
  if (!a || typeof a !== 'object' || level.theme !== 'ship') return;
  if (Number.isInteger(a.level) && a.level >= 1 && a.level <= 5) chooseLevel(a.level);
  else if (a.restart === true && SH.state === 'done') restart();
}

export const shipRules = {
  coop: true,
  noMatchWins: true,   // the players fight robots together: no first to P.winsToWin
  start: resetStarship,
  simStep: stepStarship,
  bulletHit(x, y, owner, dmg, kind) { return owner < 2 && bulletHitsEnemy(owner, x, y, dmg, kind); },
  blastHit(x, y, R, owner, dmg) {
    for (const e of SH.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - x, e.y - y) >= R + e.K.r) continue;
      e.hp -= dmg; e.flash = 0.08;
      if (e.hp <= 0 && owner < 2) killEnemy(e, ships[owner]);
    }
    if (owner < 2 && robotUp() && Math.hypot(RB.x - x, RB.y + 300 - y) < R + 150) hurtRobot(dmg, ships[owner]);
  },
  beamHit(b, s, len, half, dmg) {
    for (const e of SH.enemies) {
      if (e.dead || b.hit.has(e)) continue;
      if (segDist(e.x, e.y, b.ox, b.oy, b.ang, len) < half + e.K.r) {
        b.hit.add(e);
        hurtEnemy(e, dmg, 0.15, s);
      }
    }
    if (robotUp() && !b.hit.has(RB) && segDist(RB.x, RB.y + 300, b.ox, b.oy, b.ang, len) < half + 120) {
      b.hit.add(RB);
      hurtRobot(dmg, s);
    }
  },
  shipsSafe() { return RB.cut; },   // the robot's death cutscene
  onKill() { SH.deaths++; },
  action, encode, apply,
};
