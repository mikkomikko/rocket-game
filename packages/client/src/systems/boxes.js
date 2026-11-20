import * as THREE from 'three';
import { isPractice, isSolo, P, PR } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { H, level, solidAt, W } from '@rocket-duel/shared/level/mask.js';
import { glowMat, scene } from '../render/scene.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { WHITE } from '../fx/pools.js';
import { emit } from '../fx/particles.js';
import { canvasTex } from '../maps/floors/floors.js';
import { activeMap } from '../maps/index.js';

/* ------------------------------------------------------------------ *
 * Floating supply boxes on every map: ammo, health (+50) and crosshair (30 s).
 * They hang in open air that both players can reach, bob gently, and come back at a new spot
 * a while after they are taken. If a player runs dry, or every ammo box is gone, new ammo boxes appear right away.
 * ------------------------------------------------------------------ */
const CROSS_TIME = 30, HEALTH_GAIN = 50;
const BOX_KINDS = {
  ammo: { n: 3, back: 12, glow: '#ffcc33' },
  health: { n: 2, back: 20, glow: '#5dff8a' },
  cross: { n: 1, back: 25, glow: '#6ee7ff' },
};
const boxTex = {
  ammo: canvasTex(64, 64, (g) => {
    g.fillStyle = '#4f5d3a'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#2c3520'; g.lineWidth = 6; g.strokeRect(3, 3, 58, 58);
    g.fillStyle = '#ffcc33';
    for (const x of [16, 28, 40]) { g.fillRect(x, 26, 8, 22); g.beginPath(); g.arc(x + 4, 26, 4, Math.PI, 0); g.fill(); }
    g.fillStyle = '#c98a1e';
    for (const x of [16, 28, 40]) g.fillRect(x, 44, 8, 4);
  }),
  health: canvasTex(64, 64, (g) => {
    g.fillStyle = '#2f9c55'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#f7f8fb'; g.fillRect(5, 5, 54, 54);
    g.fillStyle = '#e8283c'; g.fillRect(25, 12, 14, 40); g.fillRect(12, 25, 40, 14);
  }),
  cross: canvasTex(64, 64, (g) => {
    g.fillStyle = '#1b2a4a'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#3d5d8f'; g.lineWidth = 6; g.strokeRect(3, 3, 58, 58);
    g.strokeStyle = '#6ee7ff'; g.lineWidth = 4;
    g.beginPath(); g.arc(32, 32, 13, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(32, 10); g.lineTo(32, 22); g.moveTo(32, 42); g.lineTo(32, 54);
    g.moveTo(10, 32); g.lineTo(22, 32); g.moveTo(42, 32); g.lineTo(54, 32); g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(32, 32, 3, 0, Math.PI * 2); g.fill();
  }),
};
const BOX_GROUP = new THREE.Group();
scene.add(BOX_GROUP);
let BX = [], boxSpots = [];

// Open-air spots: points with clear space all round that a ship can fly to from a spawn.
function findBoxSpots() {
  const C = 8, gw = Math.ceil(W / C), gh = Math.ceil(H / C);
  const free = new Uint8Array(gw * gh), seen = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = i * C + C / 2, y = j * C + C / 2;
    free[j * gw + i] = (!solidAt(x, y) && !solidAt(x - 9, y) && !solidAt(x + 9, y) && !solidAt(x, y - 9) && !solidAt(x, y + 9)) ? 1 : 0;
  }
  // Flood from each spawn, so boxes never sit in sealed-off pockets.
  const q = [];
  for (const sp of level.spawns) {
    for (const dy of [20, 34, 50]) {
      const i = Math.floor(sp.x / C), j = Math.floor((sp.y + dy) / C);
      if (i >= 0 && j >= 0 && i < gw && j < gh && free[j * gw + i] && !seen[j * gw + i]) { seen[j * gw + i] = 1; q.push(j * gw + i); break; }
    }
  }
  for (let k = 0; k < q.length; k++) {
    const c = q[k], i = c % gw, j = (c / gw) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
      const n = nj * gw + ni;
      if (free[n] && !seen[n]) { seen[n] = 1; q.push(n); }
    }
  }
  // Floors: the orange blocks seal each hallway until they are shot, so the whole hallway counts.
  if (activeMap().sealedHalls) seen.set(free);
  const clear = (x, y, R) => {
    for (const r of [R * 0.35, R * 0.7, R]) for (let a = 0; a < 12; a++) {
      if (solidAt(x + Math.cos(a * Math.PI / 6) * r, y + Math.sin(a * Math.PI / 6) * r)) return false;
    }
    return !solidAt(x, y);
  };
  const farFromSpawns = (x, y) => level.spawns.every((sp) => Math.hypot(x - sp.x, y - sp.y) > 140);
  for (const R of [52, 38, 26]) {
    const out = [];
    for (let j = 1; j < gh - 1; j += 2) for (let i = 1; i < gw - 1; i += 2) {
      if (!seen[j * gw + i]) continue;
      const x = i * C + C / 2, y = j * C + C / 2;
      if (farFromSpawns(x, y) && clear(x, y, R)) out.push([x, y]);
    }
    if (out.length >= 30 || R === 26) return out;
  }
  return [];
}
function pickBoxSpot(near) {
  const taken = BX.filter((b) => b.on || b.placing);
  let ok = boxSpots.filter(([x, y]) =>
    taken.every((b) => Math.hypot(b.x - x, b.y - y) > 130) &&
    ships.every((s) => !s.active || !s.alive || Math.hypot(s.x - x, s.y - y) > 90));
  if (!ok.length) ok = boxSpots;
  if (!ok.length) return null;
  if (near) {   // someone ran dry: drop it in their part of the map
    ok = ok.slice().sort((a, b) => Math.hypot(a[0] - near.x, a[1] - near.y) - Math.hypot(b[0] - near.x, b[1] - near.y));
    ok = ok.slice(0, Math.max(1, Math.ceil(ok.length * 0.2)));
  }
  return ok[Math.floor(Math.random() * ok.length)];
}
function placeBox(b, near, sparkle) {
  b.placing = true;
  const p = pickBoxSpot(near);
  b.placing = false;
  if (!p) { b.on = false; b.t = 5; return; }
  b.x = p[0]; b.y = p[1]; b.on = true; b.t = 0; b.phase = Math.random() * 6.28;
  if (sparkle) for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2; emit(b.x, b.y, Math.cos(a) * 80, Math.sin(a) * 80, 0.45, b.spark, 0, 3.5); }
}
function makeBoxMesh(kind) {
  const K = BOX_KINDS[kind];
  const g = new THREE.Group();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), glowMat(new THREE.Color(K.glow), 0.4));
  const ring = new THREE.Mesh(new THREE.RingGeometry(19, 20.5, 40), new THREE.MeshBasicMaterial({ color: K.glow, transparent: true, opacity: 0.5, depthWrite: false }));
  ring.position.z = 0.005;
  const box = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ map: boxTex[kind] }));
  box.position.z = 0.01;
  g.add(glow, ring, box);
  g.visible = false;
  BOX_GROUP.add(g);
  return { g, ring, box };
}
// Takes every box off the map (online play has no boxes yet).
export function removeBoxes() {
  for (const b of BX) { b.g.removeFromParent(); b.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  BX = [];
}
export function resetBoxes() {
  for (const b of BX) { b.g.removeFromParent(); b.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  BX = [];
  boxSpots = findBoxSpots();
  const scale = Math.max(1, Math.round((W * H) / (1800 * 1100)));
  for (const kind of Object.keys(BOX_KINDS)) {
    for (let i = 0; i < BOX_KINDS[kind].n * scale; i++) {
      const m = makeBoxMesh(kind);
      const b = { kind, ...m, x: 0, y: 0, on: false, t: 0, phase: 0, spark: new THREE.Color(BOX_KINDS[kind].glow) };
      BX.push(b);
      placeBox(b, null, false);
    }
  }
  for (const s of ships) s.crossT = 0;
}
const shipName = (s) => (isSolo() ? 'You' : s.id === 0 ? 'Player 1' : 'Player 2');
export function stepBoxes(h) {
  for (const s of ships) if (s.crossT > 0) s.crossT = Math.max(0, s.crossT - h);
  for (const b of BX) {
    if (!b.on) { b.t -= h; if (b.t <= 0) placeBox(b, null, true); continue; }
    for (const s of ships) {
      if (!s.active || !s.alive) continue;
      if (Math.hypot(s.x - b.x, s.y - b.y) > 24 * Math.max(1, P.shipSize)) continue;
      if (b.kind === 'ammo') {
        if (s.ammo >= P.ammoMax - 0.5) continue;
        s.ammo = P.ammoMax; s.msg = 'Ammo refilled!';
      } else if (b.kind === 'health') {
        if (s.hp >= 99.5) continue;
        s.hp = Math.min(100, s.hp + HEALTH_GAIN); s.msg = `+${HEALTH_GAIN} health!`;
      } else {
        s.crossT = CROSS_TIME; s.msg = `Crosshair for ${CROSS_TIME} s!`;
      }
      s.msgUntil = game.time + 1.5;
      b.on = false; b.t = BOX_KINDS[b.kind].back;
      for (let i = 0; i < 22; i++) { const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 130; emit(b.x, b.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.45, i % 2 ? b.spark : WHITE, 0, 3 + Math.random() * 3); }
      break;
    }
  }
  // Never leave the map without ammo: if every ammo box is gone, or a player has run dry, bring new ones in now.
  const ammo = BX.filter((b) => b.kind === 'ammo');
  if (!ammo.length) return;
  const dry = ships.find((s) => s.active && s.alive && s.ammo < 1 && !(s.minigunT > 0) && !(isPractice() && PR.infiniteAmmo));
  const noneLeft = ammo.every((b) => !b.on);
  if (dry || noneLeft) {
    for (const b of ammo) if (!b.on) placeBox(b, dry || null, true);
  }
}
export function drawBoxes(now) {
  for (const b of BX) {
    b.g.visible = b.on;
    if (!b.on) continue;
    const t = now / 1000 + b.phase;
    b.g.position.set(b.x, b.y + Math.sin(t * 2.2) * 4, 1.15);
    b.box.rotation.z = Math.sin(t * 1.3) * 0.18;
    b.ring.scale.setScalar(1 + 0.08 * Math.sin(t * 4));
    b.ring.material.opacity = 0.35 + 0.25 * Math.sin(t * 4);
  }
}
