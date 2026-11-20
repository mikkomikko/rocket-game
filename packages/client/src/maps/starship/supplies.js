import * as THREE from 'three';
import { P } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { glowMat } from '../../render/scene.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { WHITE } from '../../fx/pools.js';
import { emit } from '../../fx/particles.js';
import { canvasTex } from '../floors/floors.js';
import { SH, SHIP_GROUP } from './starship.js';

// Ammo boxes: fly into one to refill your ammo; each comes back 12 seconds after it is taken.
const AMMO_BACK = 12;
const ammoTex = canvasTex(32, 24, (g) => {
  g.fillStyle = '#4f5d3a'; g.fillRect(0, 0, 32, 24);
  g.strokeStyle = '#2c3520'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 29, 21);
  g.fillStyle = '#ffcc33';
  for (const x of [8, 14, 20]) { g.fillRect(x, 9, 4, 9); g.beginPath(); g.arc(x + 2, 9, 2, Math.PI, 0); g.fill(); }
  g.fillStyle = '#c98a1e';
  for (const x of [8, 14, 20]) g.fillRect(x, 16, 4, 2);
});
const AMMO_SPARK = new THREE.Color('#ffcc33');
export let AM = [];
export function buildAmmo() {
  AM = SH.spec.ammo.map(([x, y]) => {
    const g = new THREE.Group();
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(56, 56), glowMat(AMMO_SPARK, 0.35));
    const box = new THREE.Mesh(new THREE.PlaneGeometry(26, 19), new THREE.MeshBasicMaterial({ map: ammoTex }));
    box.position.z = 0.01;
    g.add(glow, box);
    g.position.set(x, y + 16, 1.1);
    SHIP_GROUP.add(g);
    return { x, y: y + 16, g, on: true, t: 0 };
  });
}
export function stepAmmo(h) {
  for (const a of AM) {
    if (!a.on) { a.t -= h; if (a.t <= 0) a.on = true; continue; }
    for (const s of ships) {
      if (!s.active || !s.alive || s.ammo >= P.ammoMax - 0.5) continue;
      if (Math.hypot(s.x - a.x, s.y - a.y) > 24 * Math.max(1, P.shipSize)) continue;
      s.ammo = P.ammoMax;
      s.msg = 'Ammo refilled!';
      s.msgUntil = game.time + 1.5;
      a.on = false;
      a.t = AMMO_BACK;
      for (let i = 0; i < 18; i++) { const ang = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 120; emit(a.x, a.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.4, i % 2 ? AMMO_SPARK : WHITE, 0.3, 3 + Math.random() * 3); }
      break;
    }
  }
}
// Medkits: only three on the ship. Fly into one to heal to full; each comes back 25 seconds after it is taken.
const MEDKIT_BACK = 25;
const medTex = canvasTex(32, 32, (g) => {
  g.fillStyle = '#c9ced9'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#f7f8fb'; g.fillRect(2, 2, 28, 28);
  g.fillStyle = '#e8283c'; g.fillRect(12, 6, 8, 20); g.fillRect(6, 12, 20, 8);
});
const MED_SPARK = new THREE.Color('#5dff8a');
export let MK = [];
export function buildMedkits() {
  MK = SH.spec.medkits.map(([x, y]) => {
    const g = new THREE.Group();
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), glowMat(MED_SPARK, 0.35));
    const box = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: medTex }));
    box.position.z = 0.01;
    g.add(glow, box);
    g.position.set(x, y + 17, 1.1);
    SHIP_GROUP.add(g);
    return { x, y: y + 17, g, on: true, t: 0 };
  });
}
export function stepMedkits(h) {
  for (const k of MK) {
    if (!k.on) { k.t -= h; if (k.t <= 0) k.on = true; continue; }
    for (const s of ships) {
      if (!s.active || !s.alive || s.hp >= 99.5) continue;
      if (Math.hypot(s.x - k.x, s.y - k.y) > 24 * Math.max(1, P.shipSize)) continue;
      s.hp = 100;
      s.msg = 'Healed!';
      s.msgUntil = game.time + 1.5;
      k.on = false;
      k.t = MEDKIT_BACK;
      for (let i = 0; i < 22; i++) { const ang = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 120; emit(k.x, k.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.5, i % 2 ? MED_SPARK : WHITE, -0.2, 3 + Math.random() * 3); }
      break;
    }
  }
}
