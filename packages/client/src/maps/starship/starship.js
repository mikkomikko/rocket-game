import * as THREE from 'three';
import { wrapAngle } from '@rocket-duel/shared/math.js';
import { H, level } from '@rocket-duel/shared/level/mask.js';
import { onSim } from '@rocket-duel/shared/events.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { RG, SH } from '@rocket-duel/shared/maps/starship.js';
import { RB, ROBOT_MAXHP } from '@rocket-duel/shared/maps/hangar.js';
import { glowMat, LAVA_VS, scene } from '../../render/scene.js';
import { shapeGeo } from '../../ships/view.js';
import { FIRE, WHITE } from '../../fx/pools.js';
import { emit } from '../../fx/particles.js';
import { emitSmoke } from '../../fx/smoke.js';
import { canvasTex, girderMat, showToast, stripedPlane } from '../floors/floors.js';
import { EKIND, ENEMY_RED, WAVES } from './constants.js';
import { buildSupplies, drawSupplies } from './supplies.js';
import { buildHangar } from '../hangar/hangar.js';
import { cutscene, drawRobot, robotText } from '../hangar/robot.js';
import { rebuildCave } from '../../game/modes.js';
import { mapAction } from '../../net/online.js';

/* ------------------------------------------------------------------ *
 * Starship looks: the hull, cargo, raygun, door, red robot ships and big lasers, the wave bar and the
 * level and finish panels. The fight itself runs in the shared rules (shared maps/starship.js).
 * ------------------------------------------------------------------ */

export const SHIP_GROUP = new THREE.Group();
scene.add(SHIP_GROUP);
const RGV = { barrel: null, light: null }, DOOR = { mesh: null, sign: null };
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
  SHIP_GROUP.add(g);
  let bar = null;
  if (K.hp > 30) {
    const w = kind === 'boss' ? 140 : 56;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(w, 5), new THREE.MeshBasicMaterial({ color: '#2a0f18' }));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(w, 5), new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
    bg.position.z = 1.3; fg.position.z = 1.31;
    SHIP_GROUP.add(bg, fg);
    bar = { bg, fg, w };
  }
  return { g, hull, flame, bar };
}
// Each enemy in the shared state gets a mesh, kept by the enemy object; gone enemies lose theirs.
const meshes = new Map();
function removeEnemyMesh(m) {
  for (const o of [m.g, m.bar && m.bar.bg, m.bar && m.bar.fg]) if (o) { SHIP_GROUP.remove(o); disposeTree(o); }
}
function syncEnemyMeshes() {
  const live = new Set(SH.enemies);
  for (const [e, m] of meshes) if (!live.has(e)) { removeEnemyMesh(m); meshes.delete(e); }
  for (const e of SH.enemies) if (!meshes.has(e)) meshes.set(e, makeEnemyMesh(e.kind));
}
function clearEnemyMeshes() { for (const m of meshes.values()) removeEnemyMesh(m); meshes.clear(); }

// What the shared rules report (online, replayed from the server's events).
onSim('enemySpawned', (x, y, r) => {
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2, R = r * 2.2;
    emit(x + Math.cos(a) * R, y + Math.sin(a) * R, -Math.cos(a) * R * 2, -Math.sin(a) * R * 2, 0.45, i % 2 ? ENEMY_RED : WHITE, 0, 4);
  }
});
onSim('enemyKilled', (x, y, vx, vy, scale) => {
  const n = Math.round(30 * Math.sqrt(scale));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 220 * Math.sqrt(scale);
    emit(x, y, vx * 0.3 + Math.cos(a) * sp, vy * 0.3 + Math.sin(a) * sp, 0.5 + Math.random() * 0.9, i % 3 ? ENEMY_RED : i % 2 ? FIRE : WHITE, 0.4, 3 + Math.random() * 5 * Math.sqrt(scale));
  }
  emit(x, y, 0, 0, 0.3, ENEMY_RED, 0, 40 * Math.sqrt(scale));
  for (let i = 0; i < 4 * scale; i++) emitSmoke(x, y, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 1.5 + Math.random(), 8 + Math.random() * 6 * scale);
});
onSim('enemyHit', (x, y) => {
  for (let j = 0; j < 5; j++) emit(x, y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.25, j % 2 ? ENEMY_RED : WHITE, 0.2, 3);
});
onSim('enemyFired', (x, y) => emit(x, y, 0, 0, 0.09, ENEMY_RED, 0, 12));
onSim('laserHit', (x, y) => {
  for (let j = 0; j < 14; j++) emit(x, y, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, 0.35, j % 2 ? ENEMY_RED : WHITE, 0.2, 4);
});
onSim('shipLevel', (n) => showToast(`Level ${n}`, 'Defend the starship! Work together!'));
onSim('shipEscape', () => showToast('The boss is down! The door is open!', 'Fly out through the door on the right to escape.'));
onSim('shipWave', (i) => {
  const w = WAVES[i];
  if (w.boss) showToast('BOSS!', 'A giant red ship. Watch out for its big laser every 5 seconds!');
  else showToast(`Level ${i + 1} of ${WAVES.length - 1}`, w.juggs
    ? `${w.bots} robots and ${w.juggs} juggernauts with big lasers${w.raygun ? '. The raygun on the roof is ON!' : '!'}`
    : `${w.bots} red robot ship${w.bots > 1 ? 's' : ''}`);
});
onSim('shipCleared', (i) => {
  const w = WAVES[i], nw = WAVES[i + 1];
  showToast(w.raygun ? 'Level cleared! The raygun stopped.' : 'Level cleared!', nw.boss ? 'Get ready for the boss...' : `Level ${i + 2} is coming...`);
});

// Sparks where the big lasers burn into the walls (looks, every step).
export function starshipLooks() {
  for (const L of SH.lasers) {
    if (L.phase !== 'fire' || Math.random() >= 0.5) continue;
    emit(L.ox + Math.cos(L.ang) * L.len, L.oy + Math.sin(L.ang) * L.len, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.3, Math.random() < 0.5 ? ENEMY_RED : WHITE, 0.3, 4);
  }
}

// The level chooser's buttons and keys; online the server runs the choice.
export function pickLevel(n) {
  if (SH.state !== 'choose') return;
  mapAction({ level: n });
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
export function askRestart() { if (SH.state === 'done') mapAction({ restart: true }); }
// On its own, a browser restarts by rebuilding the whole map.
export function restartStarship() {
  for (const s of ships) s.score = 0;
  rebuildCave();
}
function showFinish() {
  document.getElementById('finishTime').textContent = fmtTime(SH.time);
  const robo = SH.spec && SH.spec.mode === 'robot';
  document.getElementById('finishTitle').textContent = robo ? 'You beat the robot!' : 'You escaped the starship!';
  document.getElementById('finishSub').textContent = robo
    ? `Score (the giant robot counts 5): Player 1 ${ships[0].score}, Player 2 ${ships[1].score} · Times blown up: ${SH.deaths}`
    : `Started at level ${SH.startLevel} · Robots destroyed: Player 1 ${ships[0].score}, Player 2 ${ships[1].score} · Times blown up: ${SH.deaths}`;
  document.getElementById('finishPanel').hidden = false;
}
// The panels follow the shared state, so a browser online shows them when the server's run gets there.
function drawPanels() {
  const fin = document.getElementById('finishPanel'), lvl = document.getElementById('levelPanel');
  if (SH.state === 'done' && fin.hidden) showFinish();
  else if (SH.state !== 'done' && !fin.hidden) fin.hidden = true;
  if (lvl.hidden !== (SH.state !== 'choose')) lvl.hidden = SH.state !== 'choose';
}

export function clearStarship() {
  clearEnemyMeshes();
  for (const o of [...SHIP_GROUP.children]) { SHIP_GROUP.remove(o); disposeTree(o); }
  RGV.barrel = RGV.light = null;
  DOOR.mesh = DOOR.sign = null;
  cutscene(false);
  document.getElementById('levelPanel').hidden = true;
  document.getElementById('finishPanel').hidden = true;
}
// Builds the meshes for the map just built (the shared rules' start() has already run).
export function buildStarship() {
  clearStarship();
  const sp = level.spec;
  if (sp.mode === 'robot') { buildHangar(); buildSupplies(); return; }
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
  buildSupplies();
  const [dx0, dy0, dx1, dy1] = sp.door;   // the exit door, striped, with a light above it
  const door = new THREE.Mesh(stripedPlane(dy1 - dy0, dx1 - dx0, 2 * (dx1 - dx0)), girderMat);
  door.rotation.z = Math.PI / 2;
  door.position.set((dx0 + dx1) / 2, (dy0 + dy1) / 2, 0.32);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), glowMat(new THREE.Color('#ff3040'), 0.8));
  sign.position.set((dx0 + dx1) / 2, dy1 + 22, 0.33);
  SHIP_GROUP.add(door, sign);
  DOOR.mesh = door; DOOR.sign = sign;
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
  RGV.barrel = barrel; RGV.light = light;
}
let lastText = '';
export function drawStarship(now, alpha) {
  const on = level.theme === 'ship' && SH.state !== 'off';
  const bar = document.getElementById('waveBar');
  bar.hidden = !on;
  let bi = 0;
  if (on) {
    backWallMat.uniforms.uTime.value = now / 1000;
    drawPanels();
    if (SH.spec.mode === 'robot') drawRobot(now, alpha);
    syncEnemyMeshes();
    for (const e of SH.enemies) {
      const m = meshes.get(e), x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha;
      m.g.position.x = x; m.g.position.y = y;
      m.g.rotation.z = e.pa + wrapAngle(e.a - e.pa) * alpha;
      m.flame.visible = e.thrust > 0.1;
      m.flame.scale.set(1, e.thrust * (0.8 + Math.random() * 0.4), 1);
      m.hull.color.set(e.flash > 0 ? '#ffffff' : '#ff4d5e');
      if (m.bar) {
        const by = y + e.K.r + 14, f = Math.max(0, e.hp / e.K.hp);
        m.bar.bg.position.set(x, by, 1.3);
        m.bar.fg.scale.x = Math.max(0.001, f);
        m.bar.fg.position.set(x - m.bar.w * (1 - f) / 2, by, 1.31);
      }
    }
    drawSupplies(now);
    if (RGV.barrel) {
      RGV.barrel.rotation.z = RG.ang;
      const charging = RG.laser && RG.laser.phase === 'warn';
      RGV.light.material.opacity = RG.active ? (charging ? 0.6 + 0.4 * Math.sin(now / 40) : 0.35 + 0.15 * Math.sin(now / 300)) : 0;
    }
    if (DOOR.mesh) {
      const [, dy0, , dy1] = SH.spec.door, hgt = dy1 - dy0, k = Math.max(0.001, 1 - SH.door);
      DOOR.mesh.scale.x = k;
      DOOR.mesh.position.y = dy1 - hgt * k / 2;
      DOOR.sign.material.color.set(SH.doorOpen ? '#3dff7a' : '#ff3040');
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
    if (text !== lastText) { document.getElementById('waveText').textContent = text; lastText = text; }
    const track = document.getElementById('bossTrack');
    const robo = SH.spec.mode === 'robot' && RB.on && RB.state !== 'drop';
    track.hidden = !boss && !robo;
    if (robo) document.getElementById('bossFill').style.transform = `scaleX(${Math.max(0, RB.hp / ROBOT_MAXHP).toFixed(3)})`;
    else if (boss) document.getElementById('bossFill').style.transform = `scaleX(${Math.max(0, boss.hp / boss.K.hp).toFixed(3)})`;
  }
  for (; bi < beams.length; bi++) { beams[bi].glow.visible = false; beams[bi].core.visible = false; }
}
