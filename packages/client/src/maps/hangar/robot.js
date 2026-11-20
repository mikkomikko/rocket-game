import * as THREE from 'three';
import { P } from '../../config.js';
import { approach, clamp, wrapAngle } from '../../util/math.js';
import { H, solidAt, W } from '../../level/mask.js';
import { stage } from '../../render/scene.js';
import { shapeGeo, SHIP_RADIUS, ships } from '../../ships/ship.js';
import { addShake, damage, shipMass } from '../../ships/physics.js';
import { EMBER, FIRE, WHITE } from '../../fx/pools.js';
import { emit } from '../../fx/particles.js';
import { emitSmoke } from '../../fx/smoke.js';
import { showToast } from '../floors.js';
import { ENEMY_RED } from '../starship/constants.js';
import { finishRun, killEnemy, nearestPlayer, segDist, SH, SHIP_GROUP, spawnEnemy, startLaser } from '../starship/starship.js';
import { RB, rbLocal, rbRest, rbShoulder, ROBOT_DUST, ROBOT_HIP, ROBOT_MAXHP, ROBOT_ORANGE, ROBOT_REACH, ROBOT_XMIN, robotAngry, robotEye, robotStage } from './hangar.js';

// The hangar's giant robot: behaviour, damage, breaking apart, cutscene and drawing.
export function resetRobot() {
  clearDebris();
  cutscene(false);
  RB.stage = 0; RB.rot = 0; RB.rotV = 0; RB.fd = 1; RB.kneel = 0; RB.down = false; RB.ct = 0; RB.downT = 0; RB.titleShown = false; RB.finished = false; RB.combo = null; RB.camZ = RB.camZ || 1;
  const R = RB.mesh;
  if (R) {
    const D = R.dmg;
    for (const o of [D.chestPlate, D.ant1, D.ant2, D.finL, D.finR, D.crest, ...R.arms.map((a) => a.pad), ...R.arms.map((a) => a.fist)]) o.visible = true;
    D.tipGone = [false, false];
    R.g.rotation.z = 0; R.head.rotation.z = 0;
  }
  RB.on = false; RB.state = 'off'; RB.dead = false; RB.hp = ROBOT_MAXHP; RB.flash = 0; RB.x = 1450; RB.y = H + 40; RB.vy = 0; RB.dir = -1;
  RB.laser = null; RB.hatch = 0; RB.spawning = 0; RB.roof = 0; RB.bob = 0;
  RB.laserCd = 3; RB.punchCd = 2; RB.spawnCd = 7; RB.boot = 0; RB.lastStep = 0;
  for (const a of RB.arms) { a.mode = 'rest'; a.hits = 0; a.lost = false; a.hitFlash = 0; [a.fx, a.fy] = rbRest(a.side); }
}
function robotDrop() {
  RB.on = true; RB.state = 'drop'; RB.y = H + 40; RB.vy = -60;
  for (const a of RB.arms) [a.fx, a.fy] = rbRest(a.side);
  showToast('GIANT ROBOT!', 'It shoots a laser from its eye, punches and sends small robots. Work together, and aim for the head!');
}
// Where a shot lands on the robot: 'head' (extra damage), 'body', or 'armor' (legs and fists: no damage).
function robotPart(x, y) {
  if (!RB.on || RB.dead || RB.state === 'off') return null;
  const lx = x - RB.x, ly = y - RB.y - RB.bob;
  if (Math.abs(lx) < 54 && ly > ROBOT_HIP + 212 && ly < ROBOT_HIP + 292) return 'head';
  if (ly > 228 && ly < 404 && Math.abs(lx) < 95 + (ly - 228) * 0.1) return 'body';
  if (ly > ROBOT_HIP - 6 && ly < ROBOT_HIP + 36 && Math.abs(lx) < 64) return 'body';
  if (ly > -2 && ly < ROBOT_HIP && Math.abs(lx) < 78) return 'armor';
  for (const a of RB.arms) if ((x - a.fx) ** 2 + (y - a.fy) ** 2 < 34 * 34) return 'armor';
  const sh = rbShoulder(-1), sh2 = rbShoulder(1);
  if (Math.hypot(x - sh[0], y - sh[1]) < 30 || Math.hypot(x - sh2[0], y - sh2[1]) < 30) return 'armor';
  return null;
}
// Which arm (0 or 1) a shot hits, counting the fist and the piston arm; -1 for neither.
function robotArmAt(x, y) {
  for (let i = 0; i < 2; i++) {
    const a = RB.arms[i], [sx, sy] = rbShoulder(a.side);
    if (!a.lost && (x - a.fx) ** 2 + (y - a.fy) ** 2 < 36 * 36) return i;
    if (segDist(x, y, sx, sy, Math.atan2(a.fy - sy, a.fx - sx), Math.hypot(a.fx - sx, a.fy - sy)) < 16) return i;
  }
  return -1;
}
// Five Cannon hits on one arm and its hand falls off: that arm can't punch any more.
function loseHand(i) {
  const a = RB.arms[i], R = RB.mesh;
  a.lost = true; a.mode = 'back';
  if (R) spawnDebris([[-29, -27], [29, -27], [29, 27], [-29, 27]], R.M.plate, a.fx, a.fy, a.side * (150 + Math.random() * 150), 280);
  robotBoom(a.fx, a.fy, false);
  showToast('Hand blown off!', 'That arm can’t punch any more.');
}
export function robotShot(x, y, dmg, by, kind = 0) {
  if (RB.on && !RB.dead && RB.state !== 'off') {
    const i = robotArmAt(x, y);
    if (i >= 0) {
      const a = RB.arms[i];
      if (kind === 1 && !a.lost) {
        a.hits = (a.hits || 0) + 1;
        a.hitFlash = 0.15;
        for (let j = 0; j < 10; j++) emit(x, y, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, 0.35, j % 2 ? FIRE : WHITE, 0.4, 3 + Math.random() * 3);
        if (a.hits >= 5) loseHand(i);
      } else {
        for (let j = 0; j < 4; j++) emit(x, y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.2, j % 2 ? ROBOT_ORANGE : WHITE, 0.3, 2.5);
      }
      return true;
    }
  }
  const part = robotPart(x, y);
  if (!part) return false;
  if (part === 'armor') {
    for (let j = 0; j < 4; j++) emit(x, y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.2, j % 2 ? ROBOT_ORANGE : WHITE, 0.3, 2.5);
    return true;
  }
  hurtRobot(dmg * (part === 'head' ? 1.5 : 1), by);
  for (let j = 0; j < 5; j++) emit(x, y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.25, j % 2 ? ENEMY_RED : WHITE, 0.2, 3);
  return true;
}
export function hurtRobot(dmg, by) {
  if (!RB.on || RB.dead) return;
  RB.hp -= dmg;
  RB.flash = 0.08;
  if (RB.hp > 0) { const st = robotStage(); while (RB.stage < st) breakRobot(++RB.stage); }
  if (RB.hp <= 0) {
    RB.hp = 0; RB.dead = true; RB.state = 'dying';
    RB.ct = 0; RB.rot = 0; RB.rotV = 0; RB.kneel = 0; RB.down = false; RB.downT = 0; RB.combo = null;
    RB.fd = (W - 40 - RB.x) >= (RB.x - 905) ? 1 : -1;   // fall toward the side with more room
    if (by) by.score += 5;
    if (RB.laser) { SH.lasers = SH.lasers.filter((L) => L !== RB.laser); RB.laser = null; }
    for (const e of SH.enemies) killEnemy(e, null);
    for (const a of RB.arms) a.mode = 'rest';
    cutscene(true);
  }
}
// Falling-off pieces: real little shapes that tumble, bounce and stay lying on the floor.
const DEBRIS = [];
function spawnDebris(pts, mat, x, y, vx, vy) {
  const m = new THREE.Mesh(shapeGeo(pts), mat);
  m.position.set(x, y, 0.97);
  SHIP_GROUP.add(m);
  DEBRIS.push({ m, x, y, vx, vy, a: Math.random() * 6, va: (Math.random() - 0.5) * 12, rest: false });
  if (DEBRIS.length > 50) { const d = DEBRIS.shift(); SHIP_GROUP.remove(d.m); d.m.geometry.dispose(); }
}
function clearDebris() { for (const d of DEBRIS) { SHIP_GROUP.remove(d.m); d.m.geometry.dispose(); } DEBRIS.length = 0; }
function stepDebris(h) {
  for (const d of DEBRIS) {
    if (d.rest) continue;
    d.vy -= 900 * h;
    const nx = d.x + d.vx * h, ny = d.y + d.vy * h;
    if (solidAt(nx, ny - 6)) {
      if (Math.abs(d.vy) < 90 && Math.abs(d.vx) < 60) d.rest = true;
      if (solidAt(nx, d.y - 6)) d.vx *= -0.4; else { d.vy *= -0.35; d.vx *= 0.6; }
      d.va *= 0.5;
      if (Math.abs(d.vy) > 60) for (let i = 0; i < 3; i++) emit(d.x, d.y - 4, (Math.random() - 0.5) * 80, Math.random() * 40, 0.4, ROBOT_DUST, 1, 2 + Math.random() * 2);
    } else { d.x = nx; d.y = ny; d.a += d.va * h; }
  }
}
function drawDebris() { for (const d of DEBRIS) { d.m.position.x = d.x; d.m.position.y = d.y; d.m.rotation.z = d.a; } }
// One more step of breaking: a small blast and a piece flies off.
function breakRobot(n) {
  const R = RB.mesh;
  if (!R) return;
  const D = R.dmg, M = R.M;
  const at = (lx, ly) => rbLocal(lx * RB.dir, ly + RB.bob);
  const fling = () => [(Math.random() - 0.5) * 380, 180 + Math.random() * 260];
  const shards = (lx, ly, k) => {
    const [x, y] = at(lx, ly);
    for (let i = 0; i < k; i++) { const s = 6 + Math.random() * 10, [vx, vy] = fling(); spawnDebris([[-s, -s * 0.6], [s, -s * 0.4], [0, s]], Math.random() < 0.5 ? M.plate : M.steel, x, y, vx, vy); }
  };
  const boom = (lx, ly) => { const [x, y] = at(lx, ly); robotBoom(x, y, false); };
  const piece = (obj, pts, mat, lx, ly) => { obj.visible = false; const [x, y] = at(lx, ly), [vx, vy] = fling(); spawnDebris(pts, mat, x, y, vx, vy); };
  const HY = ROBOT_HIP + 250;
  if (n === 1) { boom(-50, 340); shards(-50, 340, 5); }
  if (n === 2) {
    piece(D.ant2, [[-2, -11], [2, -11], [2, 11], [-2, 11]], M.joint, 32, HY + 46);
    D.tipGone[1] = true;
    boom(20, HY + 10); shards(20, HY, 3);
  }
  if (n === 3) {
    const sh = rbShoulder(-1);
    R.arms[0].pad.visible = false;
    spawnDebris([[-38, -8], [38, -8], [30, 28], [-30, 32]], M.plate, sh[0], sh[1] + 10, -200 + Math.random() * 100, 260);
    robotBoom(sh[0], sh[1], false);
    piece(D.crest, [[-14, -13], [14, -13], [5, 14], [-5, 14]], M.stripe, 0, HY + 50);
  }
  if (n === 4) {
    D.chestPlate.visible = false;
    const [x, y] = at(0, 316);
    spawnDebris([[-80, -74], [0, -74], [0, 76], [-92, 76]], M.plate, x - 30, y, -260 - Math.random() * 120, 300);
    spawnDebris([[0, -74], [80, -74], [92, 76], [0, 76]], M.plate, x + 30, y, 260 + Math.random() * 120, 320);
    boom(0, 320); boom(-40, 280); shards(0, 320, 6);
  }
  if (n === 5) {
    const sh = rbShoulder(1);
    R.arms[1].pad.visible = false;
    spawnDebris([[-38, -8], [38, -8], [30, 28], [-30, 32]], M.plate, sh[0], sh[1] + 10, 200 - Math.random() * 100, 260);
    robotBoom(sh[0], sh[1], false);
    piece(D.finL, [[9, 14], [9, -32], [-10, -4], [-8, 24]], M.dark, -62, HY);
    piece(D.ant1, [[-2, -15], [2, -15], [2, 15], [-2, 15]], M.joint, -32, HY + 50);
    D.tipGone[0] = true;
    boom(0, HY); shards(0, HY, 4);
  }
  for (const s of ships) if (s.active) addShake(s, 0.7);
}
function robotBoom(x, y, big) {
  const n = big ? 90 : 26;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * (big ? 420 : 220);
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.9, i % 3 ? FIRE : i % 2 ? EMBER : WHITE, 0.4, 3 + Math.random() * (big ? 9 : 5));
  }
  emit(x, y, 0, 0, 0.3, FIRE, 0, big ? 160 : 60);
  if (P.smoke) for (let i = 0; i < (big ? 14 : 3); i++) emitSmoke(x, y, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80 + 20, 1.5 + Math.random(), 10 + Math.random() * 10);
  for (const s of ships) if (s.active) addShake(s, big ? 1.6 : 0.5);
}
export function stepRobotFight(h) {
  if (SH.state === 'between') {
    SH.timer -= h;
    if (SH.timer <= 0) { SH.state = 'robot'; robotDrop(); }
    return;
  }
  if (SH.state !== 'robot') return;
  stepRobot(h);
  if (RB.state === 'gone') {
    RB.t -= h;
    if (RB.t <= 0) finishRun();
  }
}
function stepRobot(h) {
  stepDebris(h);
  for (const s of ships) s.robotCd = Math.max(0, (s.robotCd || 0) - h);
  RB.flash = Math.max(0, RB.flash - h);
  RB.roof = approach(RB.roof, RB.state === 'drop' ? 1 : 0, h * 1.5);
  if (RB.state === 'drop') {
    RB.vy -= 700 * h;
    RB.y += RB.vy * h;
    if (RB.y <= 56) {
      RB.y = 56; RB.vy = 0; RB.state = 'fight'; RB.boot = 1.2;
      for (const fx of [-50, 50]) for (let i = 0; i < 25; i++) emit(RB.x + fx, 60, (Math.random() - 0.5) * 300, Math.random() * 160, 0.6 + Math.random() * 0.5, Math.random() < 0.5 ? WHITE : ROBOT_ORANGE, 1, 3 + Math.random() * 5);
      if (P.smoke) for (let i = 0; i < 10; i++) emitSmoke(RB.x + (Math.random() - 0.5) * 160, 70, (Math.random() - 0.5) * 120, 20 + Math.random() * 40, 1.6 + Math.random(), 10 + Math.random() * 8);
      for (const s of ships) if (s.active) addShake(s, 1.6);
    }
    for (const a of RB.arms) [a.fx, a.fy] = rbRest(a.side);
    return;
  }
  if (RB.state === 'dying') { stepRobotDeath(h); return; }
  if (RB.state !== 'fight') return;
  // After landing it powers up: the eye flickers on, then it roars into action.
  if (RB.boot > 0) {
    RB.boot -= h;
    for (const a of RB.arms) { const [rx, ry] = rbRest(a.side); a.fx += (rx - a.fx) * Math.min(1, h * 10); a.fy += (ry - a.fy) * Math.min(1, h * 10); }
    if (RB.boot <= 0) {
      const [bx, by] = robotEye();
      emit(bx, by, 0, 0, 0.35, ENEMY_RED, 0, 110);
      for (let j = 0; j < 24; j++) { const a = Math.random() * Math.PI * 2; emit(bx, by, Math.cos(a) * 220, Math.sin(a) * 220, 0.4, j % 2 ? ENEMY_RED : WHITE, 0, 3); }
      for (const s of ships) if (s.active) addShake(s, 0.9);
    }
    return;
  }
  const angry = robotAngry(), k = angry ? 0.7 : 1;
  const [ex, ey] = robotEye();
  const s = nearestPlayer(RB.x, RB.y + 300);
  RB.laserCd -= h; RB.punchCd -= h; RB.spawnCd -= h;
  const punching = RB.arms.some((a) => a.mode !== 'rest');
  const firing = RB.laser && RB.laser.phase === 'fire';
  // Small robots out of the chest hatch.
  const bots = SH.enemies.filter((e) => !e.dead).length;
  if (RB.spawnCd <= 0 && !RB.spawning && bots < 4) { RB.spawning = 1.6; RB.spawnCd = 11 * k; }
  if (RB.spawning > 0) {
    const before = RB.spawning;
    RB.spawning -= h;
    for (const at of angry ? [1.1, 0.8, 0.5] : [1.0, 0.6]) {
      if (before > at && RB.spawning <= at) {
        const hx = RB.x, hy = RB.y + 305 + RB.bob;
        spawnEnemy('bot', [hx, hy]);
        const e = SH.enemies[SH.enemies.length - 1];
        e.vx = RB.dir * (120 + Math.random() * 120) + (Math.random() - 0.5) * 120; e.vy = 120 + Math.random() * 120;
      }
    }
    if (RB.spawning < 0) RB.spawning = 0;
  }
  RB.hatch = approach(RB.hatch, RB.spawning > 0.25 ? 1 : 0, h * 3);
  // Eye laser: aims while it charges, then sweeps after you while it fires.
  // It aims, then LOCKS (the line goes thick and steady) and waits a moment before firing: that's your chance to dodge.
  if (s && !RB.laser && RB.laserCd <= 0 && !punching && (s.x - RB.x) * RB.dir >= 0) {   // its eye only sees forward
    startLaser(RB, Math.atan2(s.y - ey, s.x - ex));
    RB.laser.t = 1.3; RB.laser.fireT = 0.8;
    RB.laserCd = (angry ? 4.5 : 6.5) + Math.random();
  }
  if (RB.laser) {
    const L = RB.laser;
    if (L.phase === 'warn' && L.t > 0.45) {
      if (s) L.ang += clamp(wrapAngle(Math.atan2(s.y - ey, s.x - ex) - L.ang), -2.6 * h, 2.6 * h);
      if (Math.random() < h * 45) {   // energy gathering into the eye
        const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 30;
        emit(ex + Math.cos(a) * r, ey + Math.sin(a) * r, -Math.cos(a) * r * 3.2, -Math.sin(a) * r * 3.2, 0.3, Math.random() < 0.6 ? ENEMY_RED : WHITE, 0, 3 + Math.random() * 2);
      }
    } else if (L.phase === 'warn' && !L.locked) {
      L.locked = true;
      emit(ex, ey, 0, 0, 0.2, WHITE, 0, 60);
      for (let j = 0; j < 10; j++) { const a = Math.random() * Math.PI * 2; emit(ex, ey, Math.cos(a) * 160, Math.sin(a) * 160, 0.25, j % 2 ? ENEMY_RED : WHITE, 0, 3); }
    }
  }
  // Walk toward the nearest rocket when it is out of reach.
  let moving = false;
  if (s) {
    // It turns around slowly, so you can sneak behind it for a moment.
    const want = s.x < RB.x ? -1 : 1;
    if (want !== RB.dir) { RB.turnT = (RB.turnT || 0) + h; if (RB.turnT > (angry ? 0.9 : 1.4)) { RB.dir = want; RB.turnT = 0; } }
    else RB.turnT = 0;
    const gap = Math.abs(s.x - RB.x);
    if (!RB.laser && !punching && gap > 260 && want === RB.dir) {
      const nx = clamp(RB.x + RB.dir * (angry ? 95 : 70) * (RB.stage >= 4 ? 0.8 : 1) * h, ROBOT_XMIN, W - 170);
      moving = nx !== RB.x;
      RB.x = nx;
    }
  }
  if (moving) RB.phase += h * 5;
  else RB.phase = approach(RB.phase, Math.round(RB.phase / Math.PI) * Math.PI, h * 4);
  RB.bob = Math.abs(Math.sin(RB.phase)) * 5 + (RB.stage >= 4 && Math.sin(RB.phase) > 0 ? 7 * Math.sin(RB.phase) : 0);   // a limp once it's badly hurt
  // Heavy footsteps: dust and a little shake each time a foot comes down.
  const stepSign = Math.sin(RB.phase) >= 0 ? 1 : -1;
  if (moving && RB.lastStep && stepSign !== RB.lastStep) {
    const fx = RB.x + stepSign * 45;
    for (let i = 0; i < 10; i++) emit(fx + (Math.random() - 0.5) * 50, 60, (Math.random() - 0.5) * 160, 30 + Math.random() * 80, 0.5, i % 3 ? ROBOT_DUST : WHITE, 1, 3 + Math.random() * 3);
    for (const o of ships) if (o.active && Math.abs(o.x - RB.x) < 700) addShake(o, 0.25);
  }
  RB.lastStep = stepSign;
  if (P.smoke && Math.random() < h * 1.5) emitSmoke(RB.x + (Math.random() < 0.5 ? -64 : 64), RB.y + 470 + RB.bob, (Math.random() - 0.5) * 20, 40, 1.2, 6);
  robotDamageFx(h);
  // Punches: its right hand (on the screen's left) punches when you're in front of it; its LEFT hand (on the screen's right)
  // punches only when you're behind it. Random wind-up, aimed ahead of you or off to one side, sometimes a quick second jab.
  if (s && RB.punchCd <= 0 && !firing) {
    const behind = (s.x - RB.x) * RB.dir < 0;
    const side = behind ? 1 : -1;
    const a = RB.arms[side < 0 ? 0 : 1], [sx, sy] = rbShoulder(side);
    if (!a.lost && a.mode === 'rest' && Math.hypot(s.x - sx, s.y - sy) < ROBOT_REACH + 40) {
      startPunch(a, angry, false);
      RB.punchCd = (angry ? 0.5 : 0.9) + Math.random() * (angry ? 1.8 : 2.8);
      if (Math.random() < (angry ? 0.4 : 0.22)) RB.combo = { side, t: 0.25 + Math.random() * 0.35, wait: 2 };
    } else RB.punchCd = 0.2 + Math.random() * 0.5;
  }
  if (RB.combo) {
    const c = RB.combo, a = RB.arms[c.side < 0 ? 0 : 1];
    c.wait -= h;
    if (a.mode === 'rest') c.t -= h;
    const ok = s && ((s.x - RB.x) * RB.dir < 0) === (c.side > 0);   // the same rule: left hand only from behind
    if (c.t <= 0) { if (ok && !a.lost && !firing) startPunch(a, angry, true); RB.combo = null; }
    else if (c.wait <= 0) RB.combo = null;
  }
  for (const a of RB.arms) {
    const [sx, sy] = rbShoulder(a.side);
    if (a.mode === 'rest' || a.mode === 'back') {
      const [rx, ry] = rbRest(a.side);
      if (a.mode === 'rest') { a.fx += (rx - a.fx) * Math.min(1, h * 10); a.fy += (ry - a.fy) * Math.min(1, h * 10); }
      else {
        const dx = rx - a.fx, dy = ry - a.fy, d = Math.hypot(dx, dy), st = 900 * h;
        if (d <= st) { a.fx = rx; a.fy = ry; a.mode = 'rest'; } else { a.fx += dx / d * st; a.fy += dy / d * st; }
      }
    } else if (a.mode === 'wind') {
      const tgt = s ? { x: s.x + s.vx * (a.lead || 0) + (a.off || 0), y: s.y + s.vy * (a.lead || 0) + (a.offY || 0) } : { x: sx + a.side * 200, y: sy };
      const dx = tgt.x - sx, dy = tgt.y - sy, d = Math.hypot(dx, dy) || 1;
      a.ux = dx / d; a.uy = dy / d;
      a.fx += (sx - a.ux * 40 - a.fx) * Math.min(1, h * 12); a.fy += (sy - a.uy * 40 - 20 - a.fy) * Math.min(1, h * 12);
      a.t -= h;
      if (a.t <= 0) { a.mode = 'punch'; a.hit = false; a.fx = sx; a.fy = sy; }
    } else if (a.mode === 'punch') {
      a.fx += a.ux * (a.speed || 1700) * h; a.fy += a.uy * (a.speed || 1700) * h;
      for (const o of ships) {
        if (a.hit || !o.active || !o.alive) continue;
        if (Math.hypot(o.x - a.fx, o.y - a.fy) < 34 + SHIP_RADIUS * P.shipSize * 0.8) {
          a.hit = true;
          damage(o, 35);
          const m = shipMass(o);
          o.vx += a.ux * 560 / m; o.vy += (a.uy * 560 + 120) / m;
          o.landed = false;
          addShake(o, 1.2);
          for (let j = 0; j < 16; j++) emit(a.fx, a.fy, (Math.random() - 0.5) * 260, (Math.random() - 0.5) * 260, 0.35, j % 2 ? ROBOT_ORANGE : WHITE, 0.2, 4);
        }
      }
      const wall = solidAt(a.fx + a.ux * 28, a.fy + a.uy * 28);
      if (wall || Math.hypot(a.fx - sx, a.fy - sy) > ROBOT_REACH) {
        if (wall) {
          for (let j = 0; j < 14; j++) emit(a.fx, a.fy, (Math.random() - 0.5) * 220, (Math.random() - 0.5) * 220, 0.35, j % 2 ? ROBOT_ORANGE : WHITE, 0.6, 3);
          for (const o of ships) if (o.active && Math.hypot(o.x - a.fx, o.y - a.fy) < 400) addShake(o, 0.5);
        }
        a.mode = 'back';
      }
    }
  }
  // Bumping into its body hurts.
  const boxes = [[-112, 228, 112, 404], [-64, ROBOT_HIP - 6, 64, ROBOT_HIP + 36], [-54, ROBOT_HIP + 212, 54, ROBOT_HIP + 292], [-78, 0, 78, ROBOT_HIP]];
  for (const o of ships) {
    if (!o.active || !o.alive) continue;
    const r = SHIP_RADIUS * P.shipSize * 0.8, lx = o.x - RB.x, ly = o.y - RB.y - RB.bob;
    for (const [x0, y0, x1, y1] of boxes) {
      if (lx < x0 - r || lx > x1 + r || ly < y0 - r || ly > y1 + r) continue;
      const pen = [[lx - (x0 - r), -1, 0], [(x1 + r) - lx, 1, 0], [ly - (y0 - r), 0, -1], [(y1 + r) - ly, 0, 1]].sort((p, q) => p[0] - q[0])[0];
      o.x += pen[1] * pen[0]; o.y += pen[2] * pen[0];
      o.vx += pen[1] * 140; o.vy += pen[2] * 140;
      o.landed = false;
      if (!(o.robotCd > 0)) { o.robotCd = 0.6; damage(o, 10); }
      break;
    }
  }
}
function startPunch(a, angry, quick) {
  a.mode = 'wind';
  a.t = quick ? 0.16 + Math.random() * 0.12 : (angry ? 0.25 : 0.35) + Math.random() * (angry ? 0.35 : 0.55);
  a.lead = Math.random() * 0.35;
  a.off = (Math.random() - 0.5) * 120; a.offY = (Math.random() - 0.5) * 90;
  a.speed = 1300 + Math.random() * 700;
}
// The more it is hurt, the more sparks, smoke and fire come out of it.
function robotDamageFx(h) {
  const st = RB.stage, at = (lx, ly) => rbLocal(lx * RB.dir, ly + RB.bob);
  for (const a of RB.arms) {   // a hand-less arm sparks at the end; a badly hit one smokes
    if (a.lost && Math.random() < h * 14) for (let j = 0; j < 3; j++) emit(a.fx, a.fy, (Math.random() - 0.5) * 160, Math.random() * 120, 0.35, j % 2 ? EMBER : WHITE, 0.8, 2 + Math.random() * 2);
    else if (!a.lost && a.hits >= 3 && P.smoke && Math.random() < h * 4) emitSmoke(a.fx, a.fy, 0, 20, 0.9, 5);
  }
  if (st >= 1 && Math.random() < h * st * 2.5) {
    const [px, py] = at((Math.random() - 0.5) * 180, 240 + Math.random() * 220);
    for (let j = 0; j < 6; j++) emit(px, py, (Math.random() - 0.5) * 200, Math.random() * 160, 0.4, j % 2 ? EMBER : WHITE, 0.8, 2 + Math.random() * 2);
  }
  if (P.smoke && st >= 2 && Math.random() < h * st * 0.9) {
    const [px, py] = at((Math.random() - 0.5) * 160, 300 + Math.random() * 120);
    emitSmoke(px, py, (Math.random() - 0.5) * 30, 30 + Math.random() * 30, 1.4, 7 + Math.random() * 5);
  }
  if (RB.mesh) for (const f of RB.mesh.dmg.fires) {
    if (st < f.st || Math.random() > h * 10) continue;
    const [px, py] = at(f.lx, f.ly);
    emit(px + (Math.random() - 0.5) * 20, py, (Math.random() - 0.5) * 30, 60 + Math.random() * 80, 0.5, Math.random() < 0.5 ? FIRE : EMBER, -0.3, 3 + Math.random() * 4);
  }
}
// The end: it staggers, sparks and burns, topples over with a huge crash, its eye fades out... You beat the robot!
function stepRobotDeath(h) {
  RB.ct += h;
  const t = RB.ct, at = (lx, ly) => rbLocal(lx * RB.dir, ly);
  if (!RB.down) {
    if (t < 1.8) {
      RB.rot = Math.sin(t * 9) * 0.035 * (1 + t) - RB.fd * 0.04 * t;
      RB.kneel = Math.min(0.5, t * 0.35);
      if (Math.random() < h * 7) { const [x, y] = at((Math.random() - 0.5) * 200, 120 + Math.random() * 380); robotBoom(x, y, false); }
    } else {
      RB.rotV += (2.8 * Math.sin(Math.abs(RB.rot)) + 0.5) * h;
      RB.rot -= RB.fd * RB.rotV * h;
      RB.kneel = approach(RB.kneel, 0.2, h);
      if (Math.random() < h * 4) { const [x, y] = at((Math.random() - 0.5) * 200, 150 + Math.random() * 300); robotBoom(x, y, false); }
      if (Math.abs(RB.rot) >= Math.PI / 2) {
        RB.rot = -RB.fd * Math.PI / 2; RB.down = true; RB.downT = 0;
        const [cx, cy] = at(0, 260);
        for (const s of ships) if (s.active) addShake(s, 2.4);
        for (let k = 0; k < 90; k++) {
          const x = cx + (Math.random() - 0.5) * 620;
          emit(x, 62, (x - cx) * 1.6 + (Math.random() - 0.5) * 80, 30 + Math.random() * 140, 0.8 + Math.random() * 0.6, k % 3 ? ROBOT_DUST : WHITE, 0.6, 4 + Math.random() * 6);
        }
        if (P.smoke) for (let k = 0; k < 18; k++) emitSmoke(cx + (Math.random() - 0.5) * 560, 80, (Math.random() - 0.5) * 160, 20 + Math.random() * 60, 2 + Math.random() * 1.5, 12 + Math.random() * 10);
        robotBoom(cx, cy, true);
        const [hx, hy] = at(0, 460); robotBoom(hx, hy, true);
        for (let i = 0; i < 12; i++) { const s = 6 + Math.random() * 12; spawnDebris([[-s, -s * 0.6], [s, -s * 0.4], [0, s]], Math.random() < 0.5 ? RB.mesh.M.plate : RB.mesh.M.steel, cx + (Math.random() - 0.5) * 400, 90, (Math.random() - 0.5) * 500, 200 + Math.random() * 300); }
      }
    }
  } else {
    RB.downT += h;
    const b = RB.downT < 0.45 ? Math.sin(RB.downT / 0.45 * Math.PI) * 0.07 : 0;   // a little bounce on impact
    RB.rot = -RB.fd * (Math.PI / 2 - b);
    if (RB.downT < 1.6 && Math.random() < h * 3) { const [x, y] = at((Math.random() - 0.5) * 200, 150 + Math.random() * 300); robotBoom(x, y, false); }
    if (P.smoke && Math.random() < h * 5) { const [x, y] = at((Math.random() - 0.5) * 180, 100 + Math.random() * 380); emitSmoke(x, y, (Math.random() - 0.5) * 20, 30 + Math.random() * 30, 2, 9 + Math.random() * 6); }
    if (RB.downT > 2.4 && !RB.titleShown) { RB.titleShown = true; showCutTitle(); }
    if (RB.downT > 6 && !RB.finished) { RB.finished = true; finishRun(); }
  }
  // Arms go limp: the fists drop and drag on the floor.
  for (const a of RB.arms) {
    const [sx, sy] = rbShoulder(a.side);
    const tx = sx + a.side * 20, ty = Math.max(84, sy - 160);
    a.fx += (tx - a.fx) * Math.min(1, h * 4); a.fy += (ty - a.fy) * Math.min(1, h * 4);
  }
  robotDamageFx(h * 0.6);
}
// Cutscene overlay: black bars slide in, then the big title.
const cutUI = (() => {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:30;display:none;';
  const bar = (top) => {
    const b = document.createElement('div');
    b.style.cssText = `position:absolute;left:0;right:0;${top ? 'top' : 'bottom'}:0;height:0;background:#000;transition:height 0.8s ease;`;
    wrap.appendChild(b);
    return b;
  };
  const top = bar(true), bot = bar(false);
  const title = document.createElement('div');
  title.textContent = 'You beat the robot!';
  title.style.cssText = 'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%) scale(0.5);text-align:center;font:900 clamp(34px,7vw,88px)/1.1 system-ui,-apple-system,"Segoe UI",sans-serif;color:#ffd23f;letter-spacing:0.02em;text-shadow:0 0 28px rgba(255,140,40,0.85),0 5px 0 #7a3a00;opacity:0;transition:opacity 0.6s ease,transform 0.9s cubic-bezier(.2,1.6,.4,1);padding:0 16px;';
  wrap.appendChild(title);
  stage.appendChild(wrap);
  return { wrap, top, bot, title };
})();
export function cutscene(on) {
  RB.cut = on;
  cutUI.wrap.style.display = on ? 'block' : 'none';
  cutUI.title.style.opacity = '0';
  cutUI.title.style.transform = 'translateY(-50%) scale(0.5)';
  cutUI.top.style.height = cutUI.bot.style.height = '0';
  if (on) requestAnimationFrame(() => requestAnimationFrame(() => { cutUI.top.style.height = cutUI.bot.style.height = '11%'; }));
}
function showCutTitle() { cutUI.title.style.opacity = '1'; cutUI.title.style.transform = 'translateY(-50%) scale(1)'; }
export function robotText() {
  if (SH.state === 'between') return 'Something big is coming...';
  if (SH.state === 'done') return 'Robot destroyed!';
  if (RB.state === 'drop') return 'GIANT ROBOT!';
  if (RB.state === 'dying' || RB.state === 'gone') return RB.down ? 'You beat the robot!' : 'The robot is going down!';
  const hurt = ['', ' · cracked', ' · damaged', ' · badly damaged', ' · falling apart', ' · almost broken'][RB.stage || 0];
  const bots = SH.enemies.length;
  return `GIANT ROBOT${robotAngry() ? ' (angry!)' : ''}${hurt}${bots ? ` · ${bots} small robot${bots > 1 ? 's' : ''}` : ''}`;
}
export function drawRobot(now) {
  const R = RB.mesh;
  if (!R) return;
  const vis = RB.on && RB.state !== 'off' && RB.state !== 'gone';
  R.g.visible = vis;
  for (const a of R.arms) a.g.visible = vis;
  if (RB.roofMesh) { RB.roofMesh.hl.position.x = -75 - RB.roof * 150; RB.roofMesh.hr.position.x = 75 + RB.roof * 150; }
  if (!vis) return;
  const dying = RB.state === 'dying', px = (RB.fd || 1) * 112;
  drawDebris();
  R.g.position.set(RB.x + px + (dying && !RB.down ? (Math.random() - 0.5) * 5 : 0), RB.y, 0.9);
  R.g.rotation.z = RB.rot || 0;
  R.body.scale.x = RB.dir;
  R.body.position.set(-px, RB.bob, 0);
  R.head.rotation.z = dying ? -0.3 : RB.stage >= 4 ? -0.2 : 0;
  const D = R.dmg, st = RB.stage || 0;
  D.cracks.forEach((m, i) => { m.visible = st >= i + 1; });
  D.visorCrack.visible = st >= 2;
  for (const f of D.scorch) f.m.visible = st >= f.st;
  for (const f of D.fires) { f.m.visible = st >= f.st; if (f.m.visible) { f.m.material.opacity = 0.5 + Math.random() * 0.4; f.m.scale.set(0.85 + Math.random() * 0.3, 0.8 + Math.random() * 0.5, 1); } }
  for (const L of R.legs) {
    const sw = Math.sin(RB.phase + (L.side > 0 ? Math.PI : 0));
    L.hip.rotation.z = dying ? RB.kneel * 0.5 : sw * 0.32;
    L.knee.rotation.z = dying ? -RB.kneel * 1.1 : -Math.max(0, -sw) * 0.5;
    L.foot.rotation.z = -L.hip.rotation.z - L.knee.rotation.z;
    L.flame.visible = RB.state === 'drop';
    if (L.flame.visible) L.flame.scale.y = 0.7 + Math.random() * 0.5;
  }
  R.doorL.position.x = -19 - RB.hatch * 36; R.doorR.position.x = 19 + RB.hatch * 36;
  R.hatchGlow.material.opacity = 0.15 + 0.6 * RB.hatch;
  const L = RB.laser, warn = L && L.phase === 'warn';
  const locked = !!(L && warn && L.locked), booting = RB.state === 'fight' && RB.boot > 0;
  let eo = L ? (warn ? (locked ? 1 : 0.6 + 0.4 * Math.sin(now / 35)) : 1) : 0.35 + 0.1 * Math.sin(now / 300);
  if (booting) eo = RB.boot > 0.5 ? 0.05 : (Math.sin(now / 25) > 0 ? 0.95 : 0.1);
  if (RB.state === 'drop') eo = 0.05;
  if (st >= 4 && !dying && Math.random() < 0.1) eo *= 0.15;   // a damaged, flickering eye
  if (dying) eo = !RB.down ? (Math.random() < 0.3 ? 0.1 : 0.9) : RB.downT < 1.8 ? (Math.sin(now / 45) > 0.2 ? 0.7 * (1 - RB.downT / 1.8) : 0.03) : 0;
  R.eyeGlow.material.opacity = eo;
  R.eyeGlow.scale.setScalar(L && !warn ? 1.9 : locked ? 1.4 : 1);
  R.scan.position.x = Math.sin(now / 260) * 36;
  R.scan.material.opacity = eo > 0.2 ? 0.85 : 0;
  const angryNow = robotAngry();
  R.M.energy.color.copy(angryNow ? ENEMY_RED : ROBOT_ORANGE);
  R.M.energy.opacity = RB.state === 'drop' || booting ? 0.15 : 0.3 + 0.22 * Math.sin(now / (angryNow ? 70 : 220));
  for (const ex of R.exhaust) { ex.material.opacity = (RB.state === 'drop' ? 0.9 : 0.3) + Math.random() * 0.3; ex.scale.y = RB.state === 'drop' ? 1.8 : 1; }
  R.tips.forEach((t, i) => { t.visible = !D.tipGone[i] && !(dying && RB.down) && Math.sin(now / 180 + i * 2.5) > -0.3; });
  if (dying && RB.down) { R.M.energy.opacity = Math.max(0, 0.5 - RB.downT * 0.25); R.scan.material.opacity = 0; }
  R.coreGlow.material.opacity = (robotAngry() ? 0.6 + 0.4 * Math.sin(now / 90) : 0.45 + 0.15 * Math.sin(now / 400));
  const white = RB.flash > 0 || (dying && !RB.down && Math.sin(now / 50) > 0.6);
  R.M.steel.color.copy(white ? WHITE : R.base.steel);
  R.M.plate.color.copy(white ? WHITE : R.base.plate);
  RB.arms.forEach((a, i) => {
    const A = R.arms[i], [sx, sy] = rbShoulder(a.side);
    const dx = a.fx - sx, dy = a.fy - sy, len = Math.max(1, Math.hypot(dx, dy)), ang = Math.atan2(dy, dx);
    for (const [m, l, w] of [[A.rod, len, 20], [A.coil, len, 6], [A.piston, Math.min(len, 150), 40], [A.band, Math.min(len, 150) * 0.2, 42]]) {
      m.position.set(sx, sy, m.position.z); m.rotation.z = ang; m.scale.set(Math.max(1, l), w, 1);
    }
    A.band.position.set(sx + Math.cos(ang) * Math.min(len, 150) * 0.6, sy + Math.sin(ang) * Math.min(len, 150) * 0.6, A.band.position.z);
    A.shoulder.position.set(sx, sy, A.shoulder.position.z);
    A.pad.position.set(sx, sy + 6, A.pad.position.z);
    A.pad.scale.x = a.side;
    A.pad.rotation.z = RB.rot || 0;
    A.fist.position.set(a.fx, a.fy, A.fist.position.z);
    A.fist.visible = !a.lost;
    if (a.hitFlash > 0) a.hitFlash -= 1 / 60;
    A.fist.rotation.z = ang;
    A.fistGlow.material.opacity = a.mode === 'wind' ? 0.5 + 0.4 * Math.sin(now / 30) : a.mode === 'punch' ? 0.8 : 0;
  });
}
