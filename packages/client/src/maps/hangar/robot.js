import * as THREE from 'three';
import { P } from '@rocket-duel/shared/config.js';
import { solidAt } from '@rocket-duel/shared/level/mask.js';
import { onSim } from '@rocket-duel/shared/events.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { addShake } from '@rocket-duel/shared/ships/physics.js';
import { SH } from '@rocket-duel/shared/maps/starship.js';
import { RB, rbLocal, rbShoulder, robotAngry, robotEye, ROBOT_HIP } from '@rocket-duel/shared/maps/hangar.js';
import { stage } from '../../render/scene.js';
import { shapeGeo } from '../../ships/view.js';
import { EMBER, FIRE, WHITE } from '../../fx/pools.js';
import { emit } from '../../fx/particles.js';
import { emitSmoke } from '../../fx/smoke.js';
import { showToast } from '../floors/floors.js';
import { ENEMY_RED } from '../starship/constants.js';
import { SHIP_GROUP } from '../starship/starship.js';
import { ROBOT_DUST, ROBOT_ORANGE, RV } from './hangar.js';

// The hangar's giant robot, as the browser shows it: breaking apart, sparks and smoke, the cutscene and
// drawing. What it does runs in the shared rules (RB, shared maps/hangar.js).
const robotOn = () => SH.state !== 'off' && SH.spec && SH.spec.mode === 'robot';
export function resetRobotLooks() {
  clearDebris();
  cutscene(false);
  dieT = 0;
  const R = RV.mesh;
  if (R) { R.g.rotation.z = 0; R.head.rotation.z = 0; }
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
const sparks = (x, y, n, sp, life, col, grav, size) => { for (let j = 0; j < n; j++) emit(x, y, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, life, j % 2 ? col : WHITE, grav, size); };

// What the shared rules report (online, replayed from the server's events).
onSim('robotComing', () => showToast('Robot hangar', 'Something big is coming... Work together!'));
onSim('robotDrop', () => showToast('GIANT ROBOT!', 'It shoots lasers from both eyes, punches and sends small robots. Work together, and aim for the head!'));
onSim('robotLanded', (x) => {
  for (const fx of [-50, 50]) for (let i = 0; i < 25; i++) emit(x + fx, 60, (Math.random() - 0.5) * 300, Math.random() * 160, 0.6 + Math.random() * 0.5, Math.random() < 0.5 ? WHITE : ROBOT_ORANGE, 1, 3 + Math.random() * 5);
  if (P.smoke) for (let i = 0; i < 10; i++) emitSmoke(x + (Math.random() - 0.5) * 160, 70, (Math.random() - 0.5) * 120, 20 + Math.random() * 40, 1.6 + Math.random(), 10 + Math.random() * 8);
});
onSim('robotAwake', (x, y) => {
  emit(x, y, 0, 0, 0.35, ENEMY_RED, 0, 110);
  for (let j = 0; j < 24; j++) { const a = Math.random() * Math.PI * 2; emit(x, y, Math.cos(a) * 220, Math.sin(a) * 220, 0.4, j % 2 ? ENEMY_RED : WHITE, 0, 3); }
});
onSim('robotLocked', (x, y) => {
  emit(x, y, 0, 0, 0.2, WHITE, 0, 60);
  for (let j = 0; j < 10; j++) { const a = Math.random() * Math.PI * 2; emit(x, y, Math.cos(a) * 160, Math.sin(a) * 160, 0.25, j % 2 ? ENEMY_RED : WHITE, 0, 3); }
});
onSim('robotStep', (fx) => {
  for (let i = 0; i < 10; i++) emit(fx + (Math.random() - 0.5) * 50, 60, (Math.random() - 0.5) * 160, 30 + Math.random() * 80, 0.5, i % 3 ? ROBOT_DUST : WHITE, 1, 3 + Math.random() * 3);
});
onSim('robotPunched', (x, y) => sparks(x, y, 16, 260, 0.35, ROBOT_ORANGE, 0.2, 4));
onSim('robotPunchWall', (x, y) => sparks(x, y, 14, 220, 0.35, ROBOT_ORANGE, 0.6, 3));
onSim('robotArmHit', (x, y, counts) => {
  if (counts) for (let j = 0; j < 10; j++) emit(x, y, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, 0.35, j % 2 ? FIRE : WHITE, 0.4, 3 + Math.random() * 3);
  else sparks(x, y, 4, 160, 0.2, ROBOT_ORANGE, 0.3, 2.5);
});
onSim('robotArmor', (x, y) => sparks(x, y, 4, 160, 0.2, ROBOT_ORANGE, 0.3, 2.5));
onSim('robotHurt', (x, y) => sparks(x, y, 5, 160, 0.25, ENEMY_RED, 0.2, 3));
onSim('robotHandLost', (i, x, y) => {
  const R = RV.mesh, side = i ? 1 : -1;
  if (R) spawnDebris([[-29, -27], [29, -27], [29, 27], [-29, 27]], R.M.plate, x, y, side * (150 + Math.random() * 150), 280);
  robotBoom(x, y, false);
  showToast('Hand blown off!', 'That arm can’t punch any more.');
});
// One more step of breaking: a small blast and a piece flies off. (Which pieces are gone follows RB.stage in drawRobot.)
onSim('robotBroke', (n) => {
  const R = RV.mesh;
  if (!R) return;
  const M = R.M;
  const at = (lx, ly) => rbLocal(lx * RB.dir, ly + RB.bob);
  const fling = () => [(Math.random() - 0.5) * 380, 180 + Math.random() * 260];
  const shards = (lx, ly, k) => {
    const [x, y] = at(lx, ly);
    for (let i = 0; i < k; i++) { const s = 6 + Math.random() * 10, [vx, vy] = fling(); spawnDebris([[-s, -s * 0.6], [s, -s * 0.4], [0, s]], Math.random() < 0.5 ? M.plate : M.steel, x, y, vx, vy); }
  };
  const boom = (lx, ly) => { const [x, y] = at(lx, ly); robotBoom(x, y, false); };
  const piece = (pts, mat, lx, ly) => { const [x, y] = at(lx, ly), [vx, vy] = fling(); spawnDebris(pts, mat, x, y, vx, vy); };
  const HY = ROBOT_HIP + 250;
  if (n === 1) { boom(-50, 340); shards(-50, 340, 5); }
  if (n === 2) {
    piece([[-2, -11], [2, -11], [2, 11], [-2, 11]], M.joint, 32, HY + 46);
    boom(20, HY + 10); shards(20, HY, 3);
  }
  if (n === 3) {
    const sh = rbShoulder(-1);
    spawnDebris([[-38, -8], [38, -8], [30, 28], [-30, 32]], M.plate, sh[0], sh[1] + 10, -200 + Math.random() * 100, 260);
    robotBoom(sh[0], sh[1], false);
    piece([[-7, -12], [7, -12], [6, 12], [-6, 12]], M.silver, 0, HY - 28);
  }
  if (n === 4) {
    const [x, y] = at(0, 316);
    spawnDebris([[-61, -74], [0, -74], [0, 76], [-70, 76]], M.plate, x - 23, y, -260 - Math.random() * 120, 300);
    spawnDebris([[0, -74], [61, -74], [70, 76], [0, 76]], M.plate, x + 23, y, 260 + Math.random() * 120, 320);
    boom(0, 320); boom(-40, 280); shards(0, 320, 6);
  }
  if (n === 5) {
    const sh = rbShoulder(1);
    spawnDebris([[-38, -8], [38, -8], [30, 28], [-30, 32]], M.plate, sh[0], sh[1] + 10, 200 - Math.random() * 100, 260);
    robotBoom(sh[0], sh[1], false);
    piece([[9, 14], [9, -32], [-10, -4], [-8, 24]], M.dark, -62, HY);
    piece([[-2, -15], [2, -15], [2, 15], [-2, 15]], M.joint, -32, HY + 50);
    boom(0, HY); shards(0, HY, 4);
  }
  for (const s of ships) if (s.active) addShake(s, 0.7);
});
// It hits the floor: a cloud of dust, two huge blasts and a shower of pieces.
onSim('robotCrash', (cx, cy, hx, hy) => {
  for (let k = 0; k < 90; k++) {
    const x = cx + (Math.random() - 0.5) * 620;
    emit(x, 62, (x - cx) * 1.6 + (Math.random() - 0.5) * 80, 30 + Math.random() * 140, 0.8 + Math.random() * 0.6, k % 3 ? ROBOT_DUST : WHITE, 0.6, 4 + Math.random() * 6);
  }
  if (P.smoke) for (let k = 0; k < 18; k++) emitSmoke(cx + (Math.random() - 0.5) * 560, 80, (Math.random() - 0.5) * 160, 20 + Math.random() * 60, 2 + Math.random() * 1.5, 12 + Math.random() * 10);
  robotBoom(cx, cy, true);
  robotBoom(hx, hy, true);
  const R = RV.mesh;
  if (R) for (let i = 0; i < 12; i++) { const s = 6 + Math.random() * 12; spawnDebris([[-s, -s * 0.6], [s, -s * 0.4], [0, s]], Math.random() < 0.5 ? R.M.plate : R.M.steel, cx + (Math.random() - 0.5) * 400, 90, (Math.random() - 0.5) * 500, 200 + Math.random() * 300); }
});

// Looks every step: pieces tumbling, energy gathering into the eye, and the more it is hurt, the more
// sparks, smoke and fire come out of it; in its death throes, blasts all over it.
let dieT = 0;
export function robotLooks(h) {
  if (!robotOn()) return;
  stepDebris(h);
  dieT = RB.state === 'dying' ? dieT + h : 0;
  if (RB.state === 'fight' && !(RB.boot > 0)) {
    const L = RB.laser;
    if (L && L.phase === 'warn' && !L.locked && Math.random() < h * 45) {
      const [ex, ey] = robotEye(Math.random() < 0.5 ? 1 : -1), a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 30;
      emit(ex + Math.cos(a) * r, ey + Math.sin(a) * r, -Math.cos(a) * r * 3.2, -Math.sin(a) * r * 3.2, 0.3, Math.random() < 0.6 ? ENEMY_RED : WHITE, 0, 3 + Math.random() * 2);
    }
    if (P.smoke && Math.random() < h * 1.5) emitSmoke(RB.x + (Math.random() < 0.5 ? -64 : 64), RB.y + 470 + RB.bob, (Math.random() - 0.5) * 20, 40, 1.2, 6);
    damageLooks(h);
  } else if (RB.state === 'dying') {
    const at = (lx, ly) => rbLocal(lx * RB.dir, ly);
    if (!RB.down) {
      if (Math.random() < h * (dieT < 1.8 ? 7 : 4)) { const [x, y] = dieT < 1.8 ? at((Math.random() - 0.5) * 200, 120 + Math.random() * 380) : at((Math.random() - 0.5) * 200, 150 + Math.random() * 300); robotBoom(x, y, false); }
    } else {
      if (RB.downT < 1.6 && Math.random() < h * 3) { const [x, y] = at((Math.random() - 0.5) * 200, 150 + Math.random() * 300); robotBoom(x, y, false); }
      if (P.smoke && Math.random() < h * 5) { const [x, y] = at((Math.random() - 0.5) * 180, 100 + Math.random() * 380); emitSmoke(x, y, (Math.random() - 0.5) * 20, 30 + Math.random() * 30, 2, 9 + Math.random() * 6); }
    }
    damageLooks(h * 0.6);
  }
}
function damageLooks(h) {
  const st = RB.stage, at = (lx, ly) => rbLocal(lx * RB.dir, ly + RB.bob);
  for (const a of RB.arms) {   // a hand-less arm sparks at the end; a badly hit one smokes
    if (a.lost && Math.random() < h * 14) for (let j = 0; j < 3; j++) emit(a.fx, a.fy, (Math.random() - 0.5) * 160, Math.random() * 120, 0.35, j % 2 ? EMBER : WHITE, 0.8, 2 + Math.random() * 2);
    else if (!a.lost && a.hits >= 3 && P.smoke && Math.random() < h * 4) emitSmoke(a.fx, a.fy, 0, 20, 0.9, 5);
  }
  if (st >= 1 && Math.random() < h * st * 2.5) {
    const [px, py] = at((Math.random() - 0.5) * 140, 240 + Math.random() * 220);
    for (let j = 0; j < 6; j++) emit(px, py, (Math.random() - 0.5) * 200, Math.random() * 160, 0.4, j % 2 ? EMBER : WHITE, 0.8, 2 + Math.random() * 2);
  }
  if (P.smoke && st >= 2 && Math.random() < h * st * 0.9) {
    const [px, py] = at((Math.random() - 0.5) * 160, 300 + Math.random() * 120);
    emitSmoke(px, py, (Math.random() - 0.5) * 30, 30 + Math.random() * 30, 1.4, 7 + Math.random() * 5);
  }
  if (RV.mesh) for (const f of RV.mesh.dmg.fires) {
    if (st < f.st || Math.random() > h * 10) continue;
    const [px, py] = at(f.lx, f.ly);
    emit(px + (Math.random() - 0.5) * 20, py, (Math.random() - 0.5) * 30, 60 + Math.random() * 80, 0.5, Math.random() < 0.5 ? FIRE : EMBER, -0.3, 3 + Math.random() * 4);
  }
}

// Cutscene overlay: black bars slide in, then the big title. It follows RB.cut and RB.titleShown.
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
  return { wrap, top, bot, title, on: false, titled: false };
})();
export function cutscene(on) {
  cutUI.on = on; cutUI.titled = false;
  cutUI.wrap.style.display = on ? 'block' : 'none';
  cutUI.title.style.opacity = '0';
  cutUI.title.style.transform = 'translateY(-50%) scale(0.5)';
  cutUI.top.style.height = cutUI.bot.style.height = '0';
  if (on) requestAnimationFrame(() => requestAnimationFrame(() => { cutUI.top.style.height = cutUI.bot.style.height = '11%'; }));
}
function showCutTitle() { cutUI.titled = true; cutUI.title.style.opacity = '1'; cutUI.title.style.transform = 'translateY(-50%) scale(1)'; }
export function robotText() {
  if (SH.state === 'between') return 'Something big is coming...';
  if (SH.state === 'done') return 'Robot destroyed!';
  if (RB.state === 'drop') return 'GIANT ROBOT!';
  if (RB.state === 'dying' || RB.state === 'gone') return RB.down ? 'You beat the robot!' : 'The robot is going down!';
  const hurt = ['', ' · cracked', ' · damaged', ' · badly damaged', ' · falling apart', ' · almost broken'][RB.stage || 0];
  const bots = SH.enemies.length;
  return `GIANT ROBOT${robotAngry() ? ' (angry!)' : ''}${hurt}${bots ? ` · ${bots} small robot${bots > 1 ? 's' : ''}` : ''}`;
}
export function drawRobot(now, alpha) {
  if (RB.cut !== cutUI.on) cutscene(RB.cut);
  if (RB.cut && RB.titleShown && !cutUI.titled) showCutTitle();
  const R = RV.mesh;
  if (!R) return;
  const vis = RB.on && RB.state !== 'off' && RB.state !== 'gone';
  R.g.visible = vis;
  for (const a of R.arms) a.g.visible = vis;
  if (RV.roofMesh) { RV.roofMesh.hl.position.x = -75 - RB.roof * 150; RV.roofMesh.hr.position.x = 75 + RB.roof * 150; }
  if (!vis) return;
  const dying = RB.state === 'dying', px = (RB.fd || 1) * 112;
  drawDebris();
  R.g.position.set(RB.x + px + (dying && !RB.down ? (Math.random() - 0.5) * 5 : 0), RB.y, 0.9);
  R.g.rotation.z = RB.rot || 0;
  R.body.scale.x = RB.dir;
  R.body.position.set(-px, RB.bob, 0);
  R.head.rotation.z = dying ? -0.3 : RB.stage >= 4 ? -0.2 : 0;
  const D = R.dmg, st = RB.stage || 0;
  // The pieces that flew off at each stage of breaking (see robotBroke).
  D.ant2.visible = st < 2; D.crest.visible = st < 3; R.arms[0].pad.visible = st < 3; D.chestPlate.visible = st < 4;
  R.arms[1].pad.visible = D.finL.visible = D.ant1.visible = st < 5;
  D.tipGone = [st >= 5, st >= 2];
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
  R.doorL.position.x = -11.5 - RB.hatch * 24; R.doorR.position.x = 11.5 + RB.hatch * 24;
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
  R.eyeGlow2.scale.copy(R.eyeGlow.scale);
  R.scan.position.x = Math.sin(now / 260) * 24;
  R.scan.material.opacity = eo > 0.2 ? 0.85 : 0;
  const angryNow = robotAngry();
  R.M.energy.color.copy(angryNow ? ENEMY_RED : ROBOT_ORANGE);
  R.M.energy.opacity = RB.state === 'drop' || booting ? 0.15 : 0.3 + 0.22 * Math.sin(now / (angryNow ? 70 : 220));
  for (const ex of R.exhaust) { ex.material.opacity = RB.state === 'drop' ? 0.9 + Math.random() * 0.3 : 0; ex.scale.y = RB.state === 'drop' ? 1.8 : 1; }
  R.tips.forEach((t, i) => { t.visible = !D.tipGone[i] && !(dying && RB.down) && Math.sin(now / 180 + i * 2.5) > -0.3; });
  if (dying && RB.down) { R.M.energy.opacity = Math.max(0, 0.5 - RB.downT * 0.25); R.scan.material.opacity = 0; }
  R.coreGlow.material.opacity = (angryNow ? 0.6 + 0.4 * Math.sin(now / 90) : 0.45 + 0.15 * Math.sin(now / 400));
  const white = RB.flash > 0 || (dying && !RB.down && Math.sin(now / 50) > 0.6);
  R.M.steel.color.copy(white ? WHITE : R.base.steel);
  R.M.plate.color.copy(white ? WHITE : R.base.plate);
  RB.arms.forEach((a, i) => {
    const A = R.arms[i], [sx, sy] = rbShoulder(a.side);
    const fx = a.pfx + (a.fx - a.pfx) * alpha, fy = a.pfy + (a.fy - a.pfy) * alpha;   // between steps (online: between snapshots)
    const dx = fx - sx, dy = fy - sy, len = Math.max(1, Math.hypot(dx, dy)), ang = Math.atan2(dy, dx);
    const up = Math.min(len, 150), cx = Math.cos(ang), cy = Math.sin(ang);
    for (const [m, l, w] of [[A.rod, len, 14], [A.coil, len, 2], [A.piston, up, 24], [A.band, 9, 28], [A.cuff, 7, 18]]) {
      m.position.set(sx, sy, m.position.z); m.rotation.z = ang; m.scale.set(Math.max(1, l), w, 1);
    }
    // Silver rings at the elbow and near the wrist.
    A.band.position.set(sx + cx * (up - 9), sy + cy * (up - 9), A.band.position.z);
    const wr = Math.max(up + 6, len - 40);
    A.cuff.position.set(sx + cx * wr, sy + cy * wr, A.cuff.position.z);
    A.shoulder.position.set(sx, sy, A.shoulder.position.z);
    A.pad.position.set(sx, sy + 6, A.pad.position.z);
    A.pad.scale.x = a.side;
    A.pad.rotation.z = RB.rot || 0;
    A.fist.position.set(fx, fy, A.fist.position.z);
    A.fist.visible = !a.lost;
    A.fist.rotation.z = ang;
    A.fistGlow.material.opacity = a.mode === 'wind' ? 0.5 + 0.4 * Math.sin(now / 30) : a.mode === 'punch' ? 0.8 : 0;
  });
}
