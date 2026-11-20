import * as THREE from 'three';
import { P } from '@rocket-duel/shared/config.js';
import { H, level, W } from '@rocket-duel/shared/level/mask.js';
import { glowMat, scene } from '../../render/scene.js';
import { shapeGeo, ships } from '../../ships/ship.js';
import { WHITE } from '../../fx/pools.js';
import { emit } from '../../fx/particles.js';
import { topBelow } from './plants.js';
import { showToast } from '../floors/floors.js';

// The minigun pickup: floats on the middle island. Fly into it for 30 s of very fast fire.
export const MINIGUN_TIME = 30, MINIGUN_RATE = 4, MINIGUN_BACK = 20;
const PU = { active: false, x: 0, y: 0, respawn: 0 };
const puGroup = new THREE.Group();
puGroup.visible = false;
scene.add(puGroup);
{
  const flat = (color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), glowMat(new THREE.Color('#ffcf4a'), 0.45));
  const ring = new THREE.Mesh(new THREE.RingGeometry(17, 19.5, 40, 1, 0, Math.PI * 1.6), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  const gun = new THREE.Group();
  gun.add(new THREE.Mesh(shapeGeo([[-7, -4], [-3, -4], [-5, -10], [-9, -10]]), flat('#2a2d3e')));
  gun.add(new THREE.Mesh(shapeGeo([[-4, -4], [0, -4], [-1, -9], [-3, -9]]), flat('#d9a43a')));
  const body = new THREE.Mesh(shapeGeo([[-10, -4], [4, -4], [6, -2], [6, 4], [-10, 4]]), flat('#3b3f55'));
  body.position.z = 0.01;
  const band = new THREE.Mesh(shapeGeo([[-1, -4.5], [2, -4.5], [2, 4.5], [-1, 4.5]]), flat('#ffcc33'));
  band.position.z = 0.02;
  gun.add(body, band);
  for (const y of [-2.6, 0, 2.6]) {
    const b = new THREE.Mesh(shapeGeo([[6, y - 0.9], [17, y - 0.9], [17, y + 0.9], [6, y + 0.9]]), flat('#b6bcd4'));
    b.position.z = 0.015;
    gun.add(b);
  }
  gun.scale.setScalar(1.25);
  gun.position.x = -3;
  glow.position.z = -0.02;
  ring.position.z = -0.01;
  puGroup.add(glow, ring, gun);
  PU.ring = ring;
  PU.gun = gun;
}
// Three little barrels on a ship's nose while it has the minigun.
for (const s of ships) {
  const g = new THREE.Group();
  for (const x of [-2.2, 0, 2.2]) {
    const b = new THREE.Mesh(shapeGeo([[x - 0.7, 6], [x + 0.7, 6], [x + 0.7, 18], [x - 0.7, 18]]), new THREE.MeshBasicMaterial({ color: '#c3c8dc', transparent: true }));
    g.add(b);
  }
  g.position.z = 0.05;
  g.visible = false;
  s.group.add(g);
  s.gunMesh = g;
}
const PU_SPARK = new THREE.Color('#ffe066');
export function resetPickup() {
  PU.active = level.theme === 'forest';
  PU.respawn = 0;
  if (PU.active) { PU.x = W / 2; PU.y = topBelow(W / 2, H - 60) + 22; }
}
export function stepPickup(h) {
  if (!PU.active) {
    if (PU.respawn > 0) {
      PU.respawn -= h;
      if (PU.respawn <= 0) {
        PU.active = true;
        for (let i = 0; i < 20; i++) { const a = Math.random() * Math.PI * 2; emit(PU.x, PU.y, Math.cos(a) * 90, Math.sin(a) * 90, 0.5, PU_SPARK, 0, 4); }
      }
    }
    return;
  }
  for (const s of ships) {
    if (!s.active || !s.alive || Math.hypot(s.x - PU.x, s.y - PU.y) > 26 * Math.max(1, P.shipSize)) continue;
    s.minigunT = MINIGUN_TIME;
    PU.active = false;
    PU.respawn = MINIGUN_BACK;
    for (let i = 0; i < 36; i++) { const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160; emit(PU.x, PU.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.4 + Math.random() * 0.4, i % 2 ? PU_SPARK : WHITE, 0, 3 + Math.random() * 4); }
    showToast(`${s.id === 0 ? 'Player 1' : 'Player 2'} got the minigun!`, '30 seconds of super-fast shooting.');
    break;
  }
}
export function drawPickup(now) {
  puGroup.visible = PU.active && level.theme === 'forest';
  if (puGroup.visible) {
    puGroup.position.set(PU.x, PU.y + Math.sin(now / 400) * 3, 1.2);
    PU.ring.rotation.z = now / 500;
    PU.ring.material.opacity = 0.55 + 0.3 * Math.sin(now / 200);
    PU.gun.rotation.z = Math.sin(now / 700) * 0.15;
  }
  for (const s of ships) s.gunMesh.visible = s.alive && s.minigunT > 0;
}
