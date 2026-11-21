import * as THREE from 'three';
import { game } from '@rocket-duel/shared/state.js';
import { onSim } from '@rocket-duel/shared/events.js';
import { boxes, HEALTH_GAIN } from '@rocket-duel/shared/boxes.js';
import { glowMat, scene } from '../render/scene.js';
import { WHITE } from '../fx/pools.js';
import { emit } from '../fx/particles.js';
import { canvasTex } from '../maps/floors/floors.js';

/* ------------------------------------------------------------------ *
 * Supply boxes as the player sees them: a glowing crate per box in @rocket-duel/shared/boxes.js
 * (which runs them), bobbing gently, with sparkles when one appears or is taken.
 * ------------------------------------------------------------------ */
const GLOW = { ammo: '#ffcc33', health: '#5dff8a' };
const SPARK = Object.fromEntries(Object.entries(GLOW).map(([k, hex]) => [k, new THREE.Color(hex)]));
const TAKEN_TEXT = { ammo: 'Ammo refilled!', health: `+${HEALTH_GAIN} health!` };
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
};
const BOX_GROUP = new THREE.Group();
scene.add(BOX_GROUP);
const meshes = [];   // one per box, made when a box of a new kind needs it

function makeBoxMesh(kind) {
  const g = new THREE.Group();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), glowMat(new THREE.Color(GLOW[kind]), 0.4));
  const ring = new THREE.Mesh(new THREE.RingGeometry(19, 20.5, 40), new THREE.MeshBasicMaterial({ color: GLOW[kind], transparent: true, opacity: 0.5, depthWrite: false }));
  ring.position.z = 0.005;
  const box = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ map: boxTex[kind] }));
  box.position.z = 0.01;
  g.add(glow, ring, box);
  g.visible = false;
  BOX_GROUP.add(g);
  return { kind, g, ring, box };
}
const dispose = (m) => { m.g.removeFromParent(); m.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); };
function dropMeshes() { meshes.forEach(dispose); meshes.length = 0; }
onSim('boxesReset', dropMeshes);
onSim('boxPlaced', (i, sparkle) => {
  const b = boxes[i];
  if (sparkle) for (let k = 0; k < 16; k++) { const a = Math.random() * Math.PI * 2; emit(b.x, b.y, Math.cos(a) * 80, Math.sin(a) * 80, 0.45, SPARK[b.kind], 0, 3.5); }
});
onSim('boxTaken', (s, kind, x, y) => {
  s.msg = TAKEN_TEXT[kind];
  s.msgUntil = game.time + 1.5;
  for (let k = 0; k < 22; k++) { const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 130; emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.45, k % 2 ? SPARK[kind] : WHITE, 0, 3 + Math.random() * 3); }
});

export function drawBoxes(now) {
  boxes.forEach((b, i) => {
    if (meshes[i]?.kind !== b.kind) {
      if (meshes[i]) dispose(meshes[i]);
      meshes[i] = makeBoxMesh(b.kind);
    }
    const m = meshes[i];
    m.g.visible = b.on;
    if (!b.on) return;
    const t = now / 1000 + i * 2.4;   // each box bobs out of step with the others
    m.g.position.set(b.x, b.y + Math.sin(t * 2.2) * 4, 1.15);
    m.box.rotation.z = Math.sin(t * 1.3) * 0.18;
    m.ring.scale.setScalar(1 + 0.08 * Math.sin(t * 4));
    m.ring.material.opacity = 0.35 + 0.25 * Math.sin(t * 4);
  });
  for (let i = boxes.length; i < meshes.length; i++) meshes[i].g.visible = false;
}
