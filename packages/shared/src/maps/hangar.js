import { P } from '../config.js';
import { approach, clamp, segDist, wrapAngle } from '../math.js';
import { H, solidAt, W } from '../level/mask.js';
import { simEvent } from '../events.js';
import { random } from '../random.js';
import { SHIP_RADIUS, ships } from '../ships/ship.js';
import { addShake, damage, shipMass } from '../ships/physics.js';
import { dropLaser, finishRun, killEnemy, laserLength, nearestPlayer, r1, r2, r3, SH, spawnEnemy, startLaser } from './starship.js';

/* ------------------------------------------------------------------ *
 * Robot hangar rules: the giant robot that drops in from the roof. It shoots lasers from both eyes (they meet at one spot),
 * punches with stretchy piston arms and sends out small robots (Starship enemies, starship.js).
 * State only; the client draws it (client maps/hangar) and hears:
 *   robotComing()                   the hangar match started: something big is on its way
 *   robotDrop()                     it drops through the roof
 *   robotLanded(x)                  it hit the deck
 *   robotAwake(x, y)                an eye lit up at (x, y) (once per eye): the fight is on
 *   robotLocked(x, y)               its eye lasers locked on (once per eye; it fires a moment later)
 *   robotStep(x)                    a foot came down at x
 *   robotPunched(x, y)              a fist hit a ship there; robotPunchWall(x, y): it hit a wall
 *   robotArmHit(x, y, counts)       a shot hit an arm (counts: a Cannon hit toward blowing the hand off)
 *   robotArmor(x, y)                a shot pinged off armour (legs, fists, shoulders)
 *   robotHurt(x, y)                 a shot hurt it (body or head)
 *   robotHandLost(i, x, y)          arm i's hand was blown off
 *   robotBroke(n)                   it broke a bit more (stage n of 5)
 *   robotCrash(x, y, hx, hy)        it toppled to the floor: (x, y) its middle, (hx, hy) its head
 * Its death throes (sparks, booms) are looks; the browser adds them from RB.state 'dying'.
 * ------------------------------------------------------------------ */
export const ROBOT_MAXHP = 1400, ROBOT_REACH = 480, ROBOT_XMIN = 1150, ROBOT_HIP = 200;
const ARM = (side) => ({ side, fx: 0, fy: 0, pfx: 0, pfy: 0, mode: 'rest', t: 0, ux: 0, uy: -1, hit: false, hits: 0, lost: false });
export const RB = { on: false, state: 'off', x: 1450, y: 56, vy: 0, dir: -1, hp: ROBOT_MAXHP, flash: 0, phase: 0, bob: 0, laserCd: 3, punchCd: 2, spawnCd: 6, spawning: 0, hatch: 0, roof: 0, t: 0, laser: null, aim: 0, dead: false, beamW: 13, cut: false,
  arms: [ARM(-1), ARM(1)] };
// Robot-local point to world, including the tilt when it falls over (it pivots on the edge it falls toward).
export function rbLocal(lx, ly) {
  const px = (RB.fd || 1) * 112, c = Math.cos(RB.rot || 0), sn = Math.sin(RB.rot || 0), dx = lx - px;
  return [RB.x + px + dx * c - ly * sn, RB.y + dx * sn + ly * c];
}
export const rbShoulder = (side) => rbLocal(side * 90, 385 + RB.bob);
export const rbRest = (side) => { const [sx, sy] = rbShoulder(side); return [sx + side * 28, sy - 165 + 4 * Math.sin(RB.phase * 0.5 + side)]; };
// Its eyes: side 1 the front eye, -1 the back one; side 0 the point between them, where it aims from.
export const ROBOT_EYE_X = 17;
export function robotEye(side = 1) { return rbLocal(RB.dir * side * ROBOT_EYE_X, ROBOT_HIP + 251 + RB.bob); }
// Where both eye lasers meet: along its aim (RB.aim) from between the eyes, on the first wall.
export function robotFocus() {
  const [mx, my] = robotEye(0), len = laserLength(mx, my, RB.aim);
  return [mx + Math.cos(RB.aim) * len, my + Math.sin(RB.aim) * len];
}
// It breaks a bit more at 80 %, 60 %, 45 %, 30 % and 15 % health.
const ROBOT_STAGES = [0.8, 0.6, 0.45, 0.3, 0.15];
export const robotStage = () => ROBOT_STAGES.filter((f) => RB.hp < ROBOT_MAXHP * f).length;
export const robotAngry = () => RB.hp < ROBOT_MAXHP * 0.5;

export function resetRobot() {
  RB.cut = false;
  RB.stage = 0; RB.rot = 0; RB.rotV = 0; RB.fd = 1; RB.kneel = 0; RB.down = false; RB.ct = 0; RB.downT = 0; RB.titleShown = false; RB.finished = false; RB.combo = null; RB.turnT = 0;
  RB.on = false; RB.state = 'off'; RB.dead = false; RB.hp = ROBOT_MAXHP; RB.flash = 0; RB.x = 1450; RB.y = H + 40; RB.vy = 0; RB.dir = -1;
  RB.laser = null; RB.hatch = 0; RB.spawning = 0; RB.roof = 0; RB.bob = 0; RB.phase = 0;
  RB.laserCd = 3; RB.punchCd = 2; RB.spawnCd = 7; RB.boot = 0; RB.lastStep = 0;
  for (const a of RB.arms) { a.mode = 'rest'; a.hits = 0; a.lost = false; [a.fx, a.fy] = rbRest(a.side); a.pfx = a.fx; a.pfy = a.fy; }
}
function robotDrop() {
  RB.on = true; RB.state = 'drop'; RB.y = H + 40; RB.vy = -60;
  for (const a of RB.arms) [a.fx, a.fy] = rbRest(a.side);
  simEvent('robotDrop');
}
// Where a shot lands on the robot: 'head' (extra damage), 'body', or 'armor' (legs and fists: no damage).
function robotPart(x, y) {
  if (!RB.on || RB.dead || RB.state === 'off') return null;
  const lx = x - RB.x, ly = y - RB.y - RB.bob;
  if (Math.abs(lx) < 54 && ly > ROBOT_HIP + 212 && ly < ROBOT_HIP + 292) return 'head';
  if (ly > 228 && ly < 404 && Math.abs(lx) < 72 + (ly - 228) * 0.08) return 'body';
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
  const a = RB.arms[i];
  a.lost = true; a.mode = 'back';
  simEvent('robotHandLost', i, a.fx, a.fy);
}
// A shot from ship `by` (null: nobody's) of kind `kind` at (x, y): true when it hit the robot.
export function robotShot(x, y, dmg, by, kind = 0) {
  if (RB.on && !RB.dead && RB.state !== 'off') {
    const i = robotArmAt(x, y);
    if (i >= 0) {
      const a = RB.arms[i], counts = kind === 1 && !a.lost;
      simEvent('robotArmHit', x, y, counts);
      if (counts && ++a.hits >= 5) loseHand(i);
      return true;
    }
  }
  const part = robotPart(x, y);
  if (!part) return false;
  if (part === 'armor') { simEvent('robotArmor', x, y); return true; }
  hurtRobot(dmg * (part === 'head' ? 1.5 : 1), by);
  simEvent('robotHurt', x, y);
  return true;
}
export function hurtRobot(dmg, by) {
  if (!RB.on || RB.dead) return;
  RB.hp -= dmg;
  RB.flash = 0.08;
  if (RB.hp > 0) { const st = robotStage(); while (RB.stage < st) simEvent('robotBroke', ++RB.stage); }
  if (RB.hp <= 0) {
    RB.hp = 0; RB.dead = true; RB.state = 'dying';
    RB.ct = 0; RB.rot = 0; RB.rotV = 0; RB.kneel = 0; RB.down = false; RB.downT = 0; RB.combo = null;
    RB.fd = (W - 40 - RB.x) >= (RB.x - 905) ? 1 : -1;   // fall toward the side with more room
    if (by) by.score += 5;
    dropLaser(RB);
    for (const e of SH.enemies) killEnemy(e, null);
    for (const a of RB.arms) a.mode = 'rest';
    RB.cut = true;   // the death cutscene: no ship can be hurt, every camera watches it fall
  }
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
  for (const a of RB.arms) { a.pfx = a.fx; a.pfy = a.fy; }
  for (const s of ships) s.robotCd = Math.max(0, (s.robotCd || 0) - h);
  RB.flash = Math.max(0, RB.flash - h);
  RB.roof = approach(RB.roof, RB.state === 'drop' ? 1 : 0, h * 1.5);
  if (RB.state === 'drop') {
    RB.vy -= 700 * h;
    RB.y += RB.vy * h;
    if (RB.y <= 56) {
      RB.y = 56; RB.vy = 0; RB.state = 'fight'; RB.boot = 1.2;
      simEvent('robotLanded', RB.x);
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
      for (const e of [1, -1]) simEvent('robotAwake', ...robotEye(e));
      for (const s of ships) if (s.active) addShake(s, 0.9);
    }
    return;
  }
  const angry = robotAngry(), k = angry ? 0.7 : 1;
  const [ex, ey] = robotEye(0);
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
        const e = spawnEnemy('bot', [RB.x, RB.y + 305 + RB.bob]);
        e.vx = RB.dir * (120 + random() * 120) + (random() - 0.5) * 120; e.vy = 120 + random() * 120;
      }
    }
    if (RB.spawning < 0) RB.spawning = 0;
  }
  RB.hatch = approach(RB.hatch, RB.spawning > 0.25 ? 1 : 0, h * 3);
  // Eye lasers, one from each eye, both aimed at the same spot: they aim while they charge, then sweep after you.
  // It aims, then LOCKS (the lines go thick and steady) and waits a moment before firing: that's your chance to dodge.
  if (s && !RB.laser && RB.laserCd <= 0 && !punching && (s.x - RB.x) * RB.dir >= 0) {   // its eyes only see forward
    RB.aim = Math.atan2(s.y - ey, s.x - ex);
    const L = startLaser(RB, RB.aim);
    L.t = 1.3; L.fireT = 0.8;
    RB.laserCd = (angry ? 4.5 : 6.5) + random();
  }
  if (RB.laser) {
    const L = RB.laser;
    if (L.phase === 'warn' && L.t > 0.45) {
      if (s) RB.aim += clamp(wrapAngle(Math.atan2(s.y - ey, s.x - ex) - RB.aim), -2.6 * h, 2.6 * h);
    } else if (L.phase === 'warn' && !L.locked) {
      L.locked = true;
      for (const e of [1, -1]) simEvent('robotLocked', ...robotEye(e));
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
    simEvent('robotStep', RB.x + stepSign * 45);
    for (const o of ships) if (o.active && Math.abs(o.x - RB.x) < 700) addShake(o, 0.25);
  }
  RB.lastStep = stepSign;
  // Punches: its right hand (on the screen's left) punches when you're in front of it; its LEFT hand (on the screen's right)
  // punches only when you're behind it. Random wind-up, aimed ahead of you or off to one side, sometimes a quick second jab.
  if (s && RB.punchCd <= 0 && !firing) {
    const behind = (s.x - RB.x) * RB.dir < 0;
    const side = behind ? 1 : -1;
    const a = RB.arms[side < 0 ? 0 : 1], [sx, sy] = rbShoulder(side);
    if (!a.lost && a.mode === 'rest' && Math.hypot(s.x - sx, s.y - sy) < ROBOT_REACH + 40) {
      startPunch(a, angry, false);
      RB.punchCd = (angry ? 0.5 : 0.9) + random() * (angry ? 1.8 : 2.8);
      if (random() < (angry ? 0.4 : 0.22)) RB.combo = { side, t: 0.25 + random() * 0.35, wait: 2 };
    } else RB.punchCd = 0.2 + random() * 0.5;
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
          simEvent('robotPunched', a.fx, a.fy);
        }
      }
      const wall = solidAt(a.fx + a.ux * 28, a.fy + a.uy * 28);
      if (wall || Math.hypot(a.fx - sx, a.fy - sy) > ROBOT_REACH) {
        if (wall) {
          simEvent('robotPunchWall', a.fx, a.fy);
          for (const o of ships) if (o.active && Math.hypot(o.x - a.fx, o.y - a.fy) < 400) addShake(o, 0.5);
        }
        a.mode = 'back';
      }
    }
  }
  // Bumping into its body hurts.
  const boxes = [[-86, 228, 86, 404], [-64, ROBOT_HIP - 6, 64, ROBOT_HIP + 36], [-54, ROBOT_HIP + 212, 54, ROBOT_HIP + 292], [-78, 0, 78, ROBOT_HIP]];
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
  a.t = quick ? 0.16 + random() * 0.12 : (angry ? 0.25 : 0.35) + random() * (angry ? 0.35 : 0.55);
  a.lead = random() * 0.35;
  a.off = (random() - 0.5) * 120; a.offY = (random() - 0.5) * 90;
  a.speed = 1300 + random() * 700;
}
// The end: it staggers, topples over with a huge crash, lies there a while... You beat the robot!
function stepRobotDeath(h) {
  RB.ct += h;
  const t = RB.ct;
  if (!RB.down) {
    if (t < 1.8) {
      RB.rot = Math.sin(t * 9) * 0.035 * (1 + t) - RB.fd * 0.04 * t;
      RB.kneel = Math.min(0.5, t * 0.35);
    } else {
      RB.rotV += (2.8 * Math.sin(Math.abs(RB.rot)) + 0.5) * h;
      RB.rot -= RB.fd * RB.rotV * h;
      RB.kneel = approach(RB.kneel, 0.2, h);
      if (Math.abs(RB.rot) >= Math.PI / 2) {
        RB.rot = -RB.fd * Math.PI / 2; RB.down = true; RB.downT = 0;
        const at = (lx, ly) => rbLocal(lx * RB.dir, ly);
        simEvent('robotCrash', ...at(0, 260), ...at(0, 460));
        for (const s of ships) if (s.active) addShake(s, 2.4);
      }
    }
  } else {
    RB.downT += h;
    const b = RB.downT < 0.45 ? Math.sin(RB.downT / 0.45 * Math.PI) * 0.07 : 0;   // a little bounce on impact
    RB.rot = -RB.fd * (Math.PI / 2 - b);
    if (RB.downT > 2.4) RB.titleShown = true;   // the browser shows the big title
    if (RB.downT > 6 && !RB.finished) { RB.finished = true; finishRun(); }
  }
  // Arms go limp: the fists drop and drag on the floor.
  for (const a of RB.arms) {
    const [sx, sy] = rbShoulder(a.side);
    const tx = sx + a.side * 20, ty = Math.max(84, sy - 160);
    a.fx += (tx - a.fx) * Math.min(1, h * 4); a.fy += (ty - a.fy) * Math.min(1, h * 4);
  }
}

// Online: [state, x, y, dir, hp, flash, phase, bob, hatch, roof, boot, stage, rot, fd, kneel, down, downT, cut,
// titleShown, then per arm: fx, fy, mode, lost, hits]  (state: index in RSTATES, mode: index in AMODES)
const RSTATES = ['off', 'drop', 'fight', 'dying', 'gone'], AMODES = ['rest', 'back', 'wind', 'punch'];
export function encodeRobot() {
  const out = [RSTATES.indexOf(RB.state), r1(RB.x), r1(RB.y), RB.dir, Math.ceil(RB.hp), RB.flash > 0 ? 1 : 0, r2(RB.phase), r1(RB.bob), r2(RB.hatch), r2(RB.roof), r2(RB.boot),
    RB.stage, r3(RB.rot), RB.fd, r2(RB.kneel), RB.down ? 1 : 0, r2(RB.downT), RB.cut ? 1 : 0, RB.titleShown ? 1 : 0];
  for (const a of RB.arms) out.push(r1(a.fx), r1(a.fy), AMODES.indexOf(a.mode), a.lost ? 1 : 0, a.hits);
  return out;
}
export function applyRobot(d) {
  let st, flash, down, cut, title;
  [st, RB.x, RB.y, RB.dir, RB.hp, flash, RB.phase, RB.bob, RB.hatch, RB.roof, RB.boot, RB.stage, RB.rot, RB.fd, RB.kneel, down, RB.downT, cut, title] = d;
  RB.state = RSTATES[st]; RB.flash = flash; RB.down = !!down; RB.cut = !!cut; RB.titleShown = !!title;
  RB.on = RB.state !== 'off'; RB.dead = RB.state === 'dying' || RB.state === 'gone';
  RB.arms.forEach((a, i) => {
    const k = 19 + i * 5;
    a.pfx = a.fx; a.pfy = a.fy;   // where the fist was, to draw it moving toward the new spot
    [a.fx, a.fy] = [d[k], d[k + 1]];
    a.mode = AMODES[d[k + 2]]; a.lost = !!d[k + 3]; a.hits = d[k + 4];
  });
}
