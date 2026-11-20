import * as THREE from 'three';
import { P } from '@rocket-duel/shared/config.js';
import { clamp, segDist, wrapAngle } from '@rocket-duel/shared/math.js';
import { H, level, repaint, solidAt, W } from '@rocket-duel/shared/level/mask.js';
import { glowMat, LAVA_VS, scene } from '../../render/scene.js';
import { shapeGeo, SHIP_RADIUS, ships } from '../../ships/ship.js';
import { addShake, damage } from '../../ships/physics.js';
import { FIRE, WHITE } from '../../fx/pools.js';
import { spawnBullet } from '../../fx/bullets.js';
import { emit } from '../../fx/particles.js';
import { emitSmoke } from '../../fx/smoke.js';
import { canvasTex, girderMat, showToast, stripedPlane } from '../floors/floors.js';
import { EKIND, ENEMY_RED, LASER_DAMAGE, LASER_FIRE, LASER_WARN, WAVES } from './constants.js';
import { AM, buildAmmo, buildMedkits, MK, stepAmmo, stepMedkits } from './supplies.js';
import { buildHangar, RB, ROBOT_MAXHP, robotEye } from '../hangar/hangar.js';
import { cutscene, drawRobot, resetRobot, robotShot, robotText, stepRobotFight } from '../hangar/robot.js';
import { rebuildCave } from '../../game/modes.js';

/* ------------------------------------------------------------------ *
 * Starship: co-op waves of red robot ships, the raygun on the roof, the boss and the escape
 * ------------------------------------------------------------------ */

export const SH = { spec: null, wave: -1, state: 'off', timer: 0, pending: [], spawnT: 0, spawnIdx: 0, enemies: [], lasers: [], time: 0, deaths: 0, door: 0, doorOpen: false, lastText: '' };
const RG = { x: 900, y: 0, ang: -Math.PI / 2, active: false, cd: 3, laser: null, barrel: null, light: null };
export const SHIP_GROUP = new THREE.Group();
scene.add(SHIP_GROUP);
const cargoTex = canvasTex(64, 64, (g) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#c9cfdb'; for (let x = 8; x < 60; x += 9) g.fillRect(x, 4, 4, 56);
  g.strokeStyle = '#59606f'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, 59, 59);
  g.fillStyle = '#ffcc33'; g.fillRect(5, 5, 10, 4); g.fillRect(49, 55, 10, 4);
});

export const backWallMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: LAVA_VS,
  fragmentShader: `uniform float uTime; varying vec2 vW;
void main() {
  vec2 q = abs(fract(vW / vec2(120.0, 80.0)) - 0.5) * vec2(120.0, 80.0);
  float seam = clamp(smoothstep(57.0, 59.0, q.x) + smoothstep(37.0, 39.0, q.y), 0.0, 1.0);
  vec3 col = vec3(0.075, 0.075, 0.125) * (1.0 - 0.35 * seam);
  float strip = smoothstep(3.0, 0.0, abs(mod(vW.y, 320.0) - 160.0));
  col += vec3(0.25, 0.45, 0.8) * strip * (0.35 + 0.15 * sin(uTime * 2.0 + vW.x * 0.01));
  gl_FragColor = vec4(col, 1.0);
}`,
});
// Big lasers: a thin flickering warning line first, then a thick beam that hurts.
export const beamGeo = new THREE.PlaneGeometry(1, 1);
beamGeo.translate(0.5, 0, 0);
const beams = Array.from({ length: 10 }, () => {
  const add = (color, z) => {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.z = z; m.frustumCulled = false; m.visible = false;
    scene.add(m);
    return m;
  };
  return { glow: add('#ff2b3d', 2.4), core: add('#fff1f1', 2.45) };
});
const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
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
function disposeTree(o) {
  o.traverse((c) => {
    if (c.geometry && c.geometry !== beamGeo) c.geometry.dispose();
    if (c.material && !c.material.userData.shared) c.material.dispose();
  });
}

// The red robot ships. Juggernauts and the boss get armour, extra wings and a health bar.
function makeEnemyMesh(kind) {
  const g = new THREE.Group(), K = EKIND[kind];
  const hull = new THREE.MeshBasicMaterial({ color: '#ff4d5e', side: THREE.DoubleSide });
  const dark = new THREE.MeshBasicMaterial({ color: '#a8233a', side: THREE.DoubleSide });
  const armor = new THREE.MeshBasicMaterial({ color: '#6e1626', side: THREE.DoubleSide });
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), glowMat(ENEMY_RED, 0.22));
  aura.position.z = -0.05;
  const flame = new THREE.Group();
  flame.position.set(0, -4.5, -0.01);
  const fo = new THREE.Mesh(new THREE.PlaneGeometry(10, 26), glowMat(new THREE.Color('#ff5a2e'), 0.9));
  fo.position.y = -9;
  flame.add(fo);
  g.add(aura, flame);
  if (kind !== 'bot') {
    const wing = kind === 'boss' ? [[7, -6], [22, -1], [25, -15], [9, -11]] : [[7, -6], [14, -3], [13, -12], [6, -10]];
    g.add(new THREE.Mesh(shapeGeo(wing), armor), new THREE.Mesh(shapeGeo(wing.map(([x, y]) => [-x, y])), armor));
    for (const sx of [1, -1]) {
      const gx = (kind === 'boss' ? 18 : 11) * sx;
      const gun = new THREE.Mesh(shapeGeo([[gx - 1, -4], [gx + 1, -4], [gx + 1, 7], [gx - 1, 7]]), dark);
      gun.position.z = 0.01;
      g.add(gun);
    }
    if (kind === 'boss') {
      g.add(new THREE.Mesh(shapeGeo([[0, 4], [5, -2], [0, 20], [-5, -2]]), armor));
      for (const sx of [1, -1]) g.add(new THREE.Mesh(shapeGeo([[sx * 24, -4], [sx * 30, -10], [sx * 24, -13]]), dark));
    }
  }
  const left = new THREE.Mesh(shapeGeo([[0, 12], [-8, -8], [-3, -4.5], [0, -4.5]]), hull);
  const right = new THREE.Mesh(shapeGeo([[0, 12], [0, -4.5], [3, -4.5], [8, -8]]), dark);
  left.position.z = right.position.z = 0.02;
  const cockpit = new THREE.Mesh(shapeGeo([[0, 7], [2.6, 0.5], [-2.6, 0.5]]), new THREE.MeshBasicMaterial({ color: '#1b0f1f' }));
  cockpit.position.z = 0.03;
  const eye = new THREE.Mesh(new THREE.CircleGeometry(1.3, 12), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
  eye.position.set(0, 3.2, 0.04);
  g.add(left, right, cockpit, eye);
  g.scale.setScalar(K.scale);
  g.position.z = 1.05;
  return { g, hull, flame };
}
export function spawnEnemy(kind, at) {
  const K = EKIND[kind], sp = at || (kind === 'boss' ? SH.spec.bossSpawn : SH.spec.spawnPts[SH.spawnIdx++ % SH.spec.spawnPts.length]);
  const mesh = makeEnemyMesh(kind);
  SHIP_GROUP.add(mesh.g);
  let bar = null;
  if (K.hp > 30) {
    const w = kind === 'boss' ? 140 : 56;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(w, 5), new THREE.MeshBasicMaterial({ color: '#2a0f18' }));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(w, 5), new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
    bg.position.z = 1.3; fg.position.z = 1.31;
    SHIP_GROUP.add(bg, fg);
    bar = { bg, fg, w };
  }
  const e = { kind, K, x: sp[0], y: sp[1], px: sp[0], py: sp[1], vx: 0, vy: 0, a: Math.PI, hp: K.hp, fireCd: 1 + Math.random(), laserCd: K.laser ? 2.5 + Math.random() : 0, laser: null, orbit: Math.random() < 0.5 ? 1 : -1, flash: 0, thrust: 0, mesh, bar, dead: false };
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2, r = K.r * 2.2;
    emit(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, -Math.cos(a) * r * 2, -Math.sin(a) * r * 2, 0.45, i % 2 ? ENEMY_RED : WHITE, 0, 4);
  }
  SH.enemies.push(e);
}
function removeEnemyMesh(e) {
  for (const o of [e.mesh.g, e.bar && e.bar.bg, e.bar && e.bar.fg]) if (o) { SHIP_GROUP.remove(o); disposeTree(o); }
}
export function killEnemy(e, by) {
  if (e.dead) return;
  e.dead = true;
  const n = Math.round(30 * Math.sqrt(e.K.scale));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 220 * Math.sqrt(e.K.scale);
    emit(e.x, e.y, e.vx * 0.3 + Math.cos(a) * sp, e.vy * 0.3 + Math.sin(a) * sp, 0.5 + Math.random() * 0.9, i % 3 ? ENEMY_RED : i % 2 ? FIRE : WHITE, 0.4, 3 + Math.random() * 5 * Math.sqrt(e.K.scale));
  }
  emit(e.x, e.y, 0, 0, 0.3, ENEMY_RED, 0, 40 * Math.sqrt(e.K.scale));
  for (let i = 0; i < 4 * e.K.scale; i++) emitSmoke(e.x, e.y, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 1.5 + Math.random(), 8 + Math.random() * 6 * e.K.scale);
  for (const s of ships) if (s.active && Math.hypot(s.x - e.x, s.y - e.y) < 500) addShake(s, 0.3 * e.K.scale);
  if (by) by.score++;
  if (e.laser) { SH.lasers = SH.lasers.filter((L) => L !== e.laser); e.laser = null; }
  removeEnemyMesh(e);
}
export function bulletHitsEnemy(owner, x, y, dmg = P.bulletDamage, kind = 0) {
  if (SH.spec && SH.spec.mode === 'robot' && robotShot(x, y, dmg, ships[owner], kind)) return true;
  for (const e of SH.enemies) {
    if (e.dead) continue;
    const r = e.K.r + 2;
    if ((x - e.x) ** 2 + (y - e.y) ** 2 > r * r) continue;
    e.hp -= dmg;
    e.flash = 0.08;
    for (let j = 0; j < 5; j++) emit(x, y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.25, j % 2 ? ENEMY_RED : WHITE, 0.2, 3);
    if (e.hp <= 0) killEnemy(e, ships[owner]);
    return true;
  }
  return false;
}
function laserOrigin(L) {
  if (L.owner === RG) return [RG.x + Math.cos(L.ang) * 56, RG.y + Math.sin(L.ang) * 56];
  if (L.owner === RB) return robotEye();
  const e = L.owner;
  return [e.x + Math.cos(L.ang) * e.K.r, e.y + Math.sin(L.ang) * e.K.r];
}
export function startLaser(owner, ang) {
  const L = { owner, ang, phase: 'warn', t: LASER_WARN, hit: new Set(), width: owner === RG ? 30 : owner === RB ? RB.beamW : owner.kind === 'boss' ? 36 : 26, ox: 0, oy: 0, len: 0 };
  owner.laser = L;
  SH.lasers.push(L);
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
        for (let j = 0; j < 14; j++) emit(s.x, s.y, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, 0.35, j % 2 ? ENEMY_RED : WHITE, 0.2, 4);
      }
    }
    if (Math.random() < 0.5) emit(L.ox + Math.cos(L.ang) * L.len, L.oy + Math.sin(L.ang) * L.len, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.3, Math.random() < 0.5 ? ENEMY_RED : WHITE, 0.3, 4);
    if (L.t <= 0) L.done = true;
  }
  for (const L of SH.lasers) if (L.done && L.owner.laser === L) L.owner.laser = null;
  SH.lasers = SH.lasers.filter((L) => !L.done);
}
function stepEnemy(e, h) {
  const K = e.K, s = nearestPlayer(e.x, e.y);
  e.px = e.x; e.py = e.y;
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
    e.fireCd = K.fire[0] + Math.random() * (K.fire[1] - K.fire[0]);
    const base = Math.atan2(s.y - e.y, s.x - e.x);
    for (let i = 0; i < K.shots; i++) {
      const ang = base + (i - (K.shots - 1) / 2) * 0.14 + (Math.random() - 0.5) * 0.12;
      spawnBullet(2, e.x + Math.cos(base) * K.r, e.y + Math.sin(base) * K.r, Math.cos(ang) * 470, Math.sin(ang) * 470, 2.2);
    }
    emit(e.x + Math.cos(base) * K.r, e.y + Math.sin(base) * K.r, 0, 0, 0.09, ENEMY_RED, 0, 12);
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
  if (!on && RG.laser) { SH.lasers = SH.lasers.filter((L) => L !== RG.laser); RG.laser = null; }
}
function setDoor(open) {
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
    showToast('The boss is down! The door is open!', 'Fly out through the door on the right to escape.');
    return;
  }
  const w = WAVES[i];
  SH.pending = [...Array(w.bots || 0).fill('bot'), ...Array(w.juggs || 0).fill('jugg'), ...(w.boss ? ['boss'] : [])];
  SH.state = 'fight';
  SH.spawnT = 0.3;
  setRaygun(!!w.raygun);
  if (w.boss) showToast('BOSS!', 'A giant red ship. Watch out for its big laser every 5 seconds!');
  else showToast(`Level ${i + 1} of ${WAVES.length - 1}`, w.juggs
    ? `${w.bots} robots and ${w.juggs} juggernauts with big lasers${w.raygun ? '. The raygun on the roof is ON!' : '!'}`
    : `${w.bots} red robot ship${w.bots > 1 ? 's' : ''}`);
}
function waveCleared() {
  const w = WAVES[SH.wave];
  if (w.raygun) setRaygun(false);
  if (w.boss) { startWave(SH.wave + 1); return; }
  SH.state = 'between';
  SH.timer = 3;
  const nw = WAVES[SH.wave + 1];
  showToast(w.raygun ? 'Level cleared! The raygun stopped.' : 'Level cleared!', nw.boss ? 'Get ready for the boss...' : `Level ${SH.wave + 2} is coming...`);
}
export function finishRun() {
  SH.state = 'done';
  document.getElementById('finishTime').textContent = fmtTime(SH.time);
  const robo = SH.spec && SH.spec.mode === 'robot';
  document.getElementById('finishTitle').textContent = robo ? 'You beat the robot!' : 'You escaped the starship!';
  if (robo) cutscene(false);
  document.getElementById('finishSub').textContent = robo
    ? `Score (the giant robot counts 5): Player 1 ${ships[0].score}, Player 2 ${ships[1].score} · Times blown up: ${SH.deaths}`
    : `Started at level ${SH.startLevel} · Robots destroyed: Player 1 ${ships[0].score}, Player 2 ${ships[1].score} · Times blown up: ${SH.deaths}`;
  document.getElementById('finishPanel').hidden = false;
}
export function resetStarship() {
  for (const e of SH.enemies) removeEnemyMesh(e);
  SH.enemies = [];
  SH.lasers = [];
  SH.pending = [];
  SH.wave = -1;
  SH.spawnIdx = 0;
  SH.time = 0;
  SH.deaths = 0;
  SH.door = 0;
  setRaygun(false);
  RG.ang = -Math.PI / 2;
  for (const a of AM) { a.on = true; a.t = 0; }
  for (const k of MK) { k.on = true; k.t = 0; }
  setDoor(false);
  document.getElementById('finishPanel').hidden = true;
  SH.state = level.theme === 'ship' ? 'choose' : 'off';
  SH.timer = 3;
  if (level.theme === 'ship' && SH.spec && SH.spec.mode === 'robot') {
    SH.state = 'between';
    resetRobot();
    showToast('Robot hangar', 'Something big is coming... Work together!');
  }
  document.getElementById('levelPanel').hidden = SH.state !== 'choose';
}
// The level chooser: start at level 1 to 5. The timer starts when you pick.
export function chooseLevel(n) {
  if (SH.state !== 'choose') return;
  document.getElementById('levelPanel').hidden = true;
  SH.startLevel = n;
  SH.wave = n - 2;
  SH.state = 'between';
  SH.timer = 2;
  SH.time = 0;
  showToast(`Level ${n}`, 'Defend the starship! Work together!');
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
export function restartStarship() {
  for (const s of ships) s.score = 0;
  rebuildCave();
}
export function clearStarship() {
  for (const e of SH.enemies) removeEnemyMesh(e);
  SH.enemies = [];
  SH.lasers = [];
  for (const o of [...SHIP_GROUP.children]) { SHIP_GROUP.remove(o); disposeTree(o); }
  AM.length = 0;
  MK.length = 0;
  RG.barrel = RG.light = null;
  RG.active = false;
  cutscene(false);
  SH.state = 'off';
  SH.doorOpen = false;
  document.getElementById('levelPanel').hidden = true;
  document.getElementById('finishPanel').hidden = true;
}
export function buildStarship() {
  clearStarship();
  const sp = SH.spec;
  SH.doorOpen = false;
  if (sp.mode === 'robot') { buildHangar(); return; }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(sp.hullX - 40, H - 112), backWallMat);
  back.position.set(40 + (sp.hullX - 40) / 2, H / 2, -0.7);
  SHIP_GROUP.add(back);
  const tints = ['#7a8aa6', '#a07a52', '#6f8f6a', '#9a5f5f', '#8a7fb0'];
  sp.boxes.forEach((b, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b[2] - b[0], b[3] - b[1]), new THREE.MeshBasicMaterial({ map: cargoTex, color: tints[i % tints.length] }));
    m.position.set((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0.3);
    SHIP_GROUP.add(m);
  });
  for (const c of sp.catwalks) {
    const m = new THREE.Mesh(stripedPlane(c[2] - c[0], c[3] - c[1], 2 * (c[3] - c[1])), girderMat);
    m.position.set((c[0] + c[2]) / 2, (c[1] + c[3]) / 2, 0.3);
    SHIP_GROUP.add(m);
  }
  buildAmmo();
  buildMedkits();
  const [dx0, dy0, dx1, dy1] = sp.door;   // the exit door, striped, with a light above it
  const door = new THREE.Mesh(stripedPlane(dy1 - dy0, dx1 - dx0, 2 * (dx1 - dx0)), girderMat);
  door.rotation.z = Math.PI / 2;
  door.position.set((dx0 + dx1) / 2, (dy0 + dy1) / 2, 0.32);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), glowMat(new THREE.Color('#ff3040'), 0.8));
  sign.position.set((dx0 + dx1) / 2, dy1 + 22, 0.33);
  SHIP_GROUP.add(door, sign);
  SH.doorMesh = door; SH.doorSign = sign;
  RG.y = H - 84;   // the raygun hangs from the roof
  const base = new THREE.Mesh(shapeGeo([[-46, 0], [46, 0], [30, -28], [-30, -28]]), new THREE.MeshBasicMaterial({ color: '#3a3f55' }));
  base.position.set(RG.x, H - 56, 0.4);
  const barrel = new THREE.Group();
  barrel.add(new THREE.Mesh(shapeGeo([[0, -8], [50, -6], [50, 6], [0, 8]]), new THREE.MeshBasicMaterial({ color: '#6b7290' })));
  const tip = new THREE.Mesh(shapeGeo([[48, -8], [58, -8], [58, 8], [48, 8]]), new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
  tip.position.z = 0.01;
  barrel.add(tip);
  barrel.position.set(RG.x, RG.y, 0.38);
  const light = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), glowMat(new THREE.Color('#ff2b3d'), 0));
  light.position.set(RG.x, RG.y, 0.41);
  const hub = new THREE.Mesh(new THREE.CircleGeometry(11, 20), new THREE.MeshBasicMaterial({ color: '#2a2e40' }));
  hub.position.set(RG.x, RG.y, 0.42);
  SHIP_GROUP.add(base, barrel, light, hub);
  RG.barrel = barrel; RG.light = light;
  resetStarship();
}
export function stepStarship(h) {
  if (SH.state === 'off') return;
  if (SH.state !== 'done' && SH.state !== 'choose') SH.time += h;
  if (SH.spec.mode === 'robot') stepRobotFight(h);
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
  stepAmmo(h);
  stepMedkits(h);
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
export function drawStarship(now) {
  const on = level.theme === 'ship' && SH.state !== 'off';
  const bar = document.getElementById('waveBar');
  bar.hidden = !on;
  let bi = 0;
  if (on) {
    backWallMat.uniforms.uTime.value = now / 1000;
    if (SH.spec.mode === 'robot') drawRobot(now);
    for (const e of SH.enemies) {
      const g = e.mesh.g;
      g.position.x = e.x; g.position.y = e.y;
      g.rotation.z = e.a;
      e.mesh.flame.visible = e.thrust > 0.1;
      e.mesh.flame.scale.set(1, e.thrust * (0.8 + Math.random() * 0.4), 1);
      e.mesh.hull.color.set(e.flash > 0 ? '#ffffff' : '#ff4d5e');
      if (e.bar) {
        const y = e.y + e.K.r + 14, f = Math.max(0, e.hp / e.K.hp);
        e.bar.bg.position.set(e.x, y, 1.3);
        e.bar.fg.scale.x = Math.max(0.001, f);
        e.bar.fg.position.set(e.x - e.bar.w * (1 - f) / 2, y, 1.31);
      }
    }
    for (const a of AM) { a.g.visible = a.on; a.g.position.y = a.y + Math.sin(now / 350 + a.x) * 2.5; }
    for (const k of MK) { k.g.visible = k.on; k.g.position.y = k.y + Math.sin(now / 420 + k.x) * 2.5; }
    if (RG.barrel) {
      RG.barrel.rotation.z = RG.ang;
      const charging = RG.laser && RG.laser.phase === 'warn';
      RG.light.material.opacity = RG.active ? (charging ? 0.6 + 0.4 * Math.sin(now / 40) : 0.35 + 0.15 * Math.sin(now / 300)) : 0;
    }
    if (SH.doorMesh) {
      const [, dy0, , dy1] = SH.spec.door, hgt = dy1 - dy0, k = Math.max(0.001, 1 - SH.door);
      SH.doorMesh.scale.x = k;
      SH.doorMesh.position.y = dy1 - hgt * k / 2;
      SH.doorSign.material.color.set(SH.doorOpen ? '#3dff7a' : '#ff3040');
    }
    for (const L of SH.lasers) {
      const b = beams[bi++];
      if (!b) break;
      const warn = L.phase === 'warn';
      b.glow.visible = true;
      b.glow.position.set(L.ox, L.oy, 2.4);
      b.glow.rotation.z = L.ang;
      b.glow.scale.set(Math.max(1, L.len), warn ? (L.locked ? 6 + 2 * Math.sin(now / 20) : 3) : L.width + 14, 1);
      b.glow.material.opacity = warn ? (L.locked ? 0.95 : 0.35 + 0.35 * Math.sin(now / 35)) : 0.6;
      b.core.visible = !warn;
      if (!warn) {
        b.core.position.set(L.ox, L.oy, 2.45);
        b.core.rotation.z = L.ang;
        b.core.scale.set(Math.max(1, L.len), L.width * 0.35, 1);
      }
    }
    const left = SH.enemies.length + SH.pending.length;
    const boss = SH.enemies.find((e) => e.kind === 'boss');
    let text;
    if (SH.spec.mode === 'robot') text = robotText();
    else if (SH.state === 'choose') text = 'Choose a level: 1 to 5';
    else if (SH.state === 'between') text = SH.wave < 0 ? 'Get ready!' : WAVES[SH.wave + 1].boss ? 'Boss coming...' : `Level ${SH.wave + 2} coming...`;
    else if (SH.state === 'fight') text = WAVES[SH.wave].boss ? 'BOSS' : `Level ${SH.wave + 1} of ${WAVES.length - 1} · ${left} left`;
    else if (SH.state === 'escape') text = 'The door is open! Fly out on the right →';
    else text = 'Escaped!';
    text += `  ·  Time ${fmtTime(SH.time)}`;
    if (text !== SH.lastText) { document.getElementById('waveText').textContent = text; SH.lastText = text; }
    const track = document.getElementById('bossTrack');
    const robo = SH.spec.mode === 'robot' && RB.on && RB.state !== 'drop';
    track.hidden = !boss && !robo;
    if (robo) document.getElementById('bossFill').style.transform = `scaleX(${Math.max(0, RB.hp / ROBOT_MAXHP).toFixed(3)})`;
    else if (boss) document.getElementById('bossFill').style.transform = `scaleX(${Math.max(0, boss.hp / boss.K.hp).toFixed(3)})`;
  }
  for (; bi < beams.length; bi++) { beams[bi].glow.visible = false; beams[bi].core.visible = false; }
}
