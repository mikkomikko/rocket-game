import * as THREE from 'three';
import { game } from '@rocket-duel/shared/state.js';
import { onSim } from '@rocket-duel/shared/events.js';
import { AM, MK } from '@rocket-duel/shared/maps/starship.js';
import { glowMat } from '../../render/scene.js';
import { WHITE } from '../../fx/pools.js';
import { emit } from '../../fx/particles.js';
import { canvasTex } from '../floors/floors.js';
import { SHIP_GROUP } from './starship.js';

// Ammo boxes and medkits: their meshes. Taking them and their coming back run in the shared rules (AM, MK).
const ammoTex = canvasTex(32, 24, (g) => {
  g.fillStyle = '#4f5d3a'; g.fillRect(0, 0, 32, 24);
  g.strokeStyle = '#2c3520'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 29, 21);
  g.fillStyle = '#ffcc33';
  for (const x of [8, 14, 20]) { g.fillRect(x, 9, 4, 9); g.beginPath(); g.arc(x + 2, 9, 2, Math.PI, 0); g.fill(); }
  g.fillStyle = '#c98a1e';
  for (const x of [8, 14, 20]) g.fillRect(x, 16, 4, 2);
});
const medTex = canvasTex(32, 32, (g) => {
  g.fillStyle = '#c9ced9'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#f7f8fb'; g.fillRect(2, 2, 28, 28);
  g.fillStyle = '#e8283c'; g.fillRect(12, 6, 8, 20); g.fillRect(6, 12, 20, 8);
});
const AMMO_SPARK = new THREE.Color('#ffcc33'), MED_SPARK = new THREE.Color('#5dff8a');
let ammoMeshes = [], medMeshes = [];
function supplyMesh(a, glowSize, boxW, boxH, tex, spark) {
  const g = new THREE.Group();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(glowSize, glowSize), glowMat(spark, 0.35));
  const box = new THREE.Mesh(new THREE.PlaneGeometry(boxW, boxH), new THREE.MeshBasicMaterial({ map: tex }));
  box.position.z = 0.01;
  g.add(glow, box);
  g.position.set(a.x, a.y, 1.1);
  SHIP_GROUP.add(g);
  return g;
}
export function buildSupplies() {
  ammoMeshes = AM.map((a) => supplyMesh(a, 56, 26, 19, ammoTex, AMMO_SPARK));
  medMeshes = MK.map((k) => supplyMesh(k, 60, 22, 22, medTex, MED_SPARK));
}
export function drawSupplies(now) {
  AM.forEach((a, i) => { const g = ammoMeshes[i]; if (g) { g.visible = a.on; g.position.y = a.y + Math.sin(now / 350 + a.x) * 2.5; } });
  MK.forEach((k, i) => { const g = medMeshes[i]; if (g) { g.visible = k.on; g.position.y = k.y + Math.sin(now / 420 + k.x) * 2.5; } });
}
onSim('supplyTaken', (s, kind, x, y) => {
  const ammo = kind === 'ammo';
  s.msg = ammo ? 'Ammo refilled!' : 'Healed!';
  s.msgUntil = game.time + 1.5;
  for (let i = 0; i < (ammo ? 18 : 22); i++) {
    const ang = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 120;
    emit(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, ammo ? 0.4 : 0.5, i % 2 ? (ammo ? AMMO_SPARK : MED_SPARK) : WHITE, ammo ? 0.3 : -0.2, 3 + Math.random() * 3);
  }
});
