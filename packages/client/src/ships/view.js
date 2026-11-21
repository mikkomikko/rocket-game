import * as THREE from 'three';
import { P1HEX, P2HEX } from '../config.js';
import { FREEZE_COLOR } from '@rocket-duel/shared/config.js';
import { H, W } from '@rocket-duel/shared/level/mask.js';
import { HULL } from '@rocket-duel/shared/ships/ship.js';
import { glowMat, scene } from '../render/scene.js';
import { designOf } from './designs.js';

/* ------------------------------------------------------------------ *
 * Ship views: everything the client draws for a ship (meshes, colours, its camera), kept apart from the
 * ship's state in the shared package. views[s.id] belongs to ships[s.id].
 * ------------------------------------------------------------------ */
export function shapeGeo(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

function makeView(id) {
  const hex = id === 0 ? P1HEX : P2HEX;
  const col = new THREE.Color(hex);
  const group = new THREE.Group();
  group.position.z = 1;
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), glowMat(col, 0.2));
  aura.position.z = -0.05;
  // The hull itself comes from the chosen design (ships/designs.js); setDesign() swaps it.
  const hull = new THREE.Group();
  const flame = new THREE.Group();
  flame.position.z = -0.01;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(10, 28), glowMat(new THREE.Color('#ff7a2e'), 0.95));
  outer.position.y = -10;
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(5, 13), glowMat(new THREE.Color('#fff1c2'), 1));
  inner.position.set(0, -4.5, 0.005);
  flame.add(outer, inner);
  const shield = new THREE.Mesh(new THREE.RingGeometry(15, 16.4, 56), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  shield.position.z = 0.03;
  shield.visible = false;
  // Frozen look: a frosty shell over the hull plus a cold ring.
  const ice = new THREE.Group();
  const iceShell = new THREE.Mesh(shapeGeo([[0, 14.5], [10, -10], [0, -6], [-10, -10]]), new THREE.MeshBasicMaterial({ color: '#cdf4ff', transparent: true, opacity: 0.55, depthWrite: false }));
  const iceRing = new THREE.Mesh(new THREE.RingGeometry(14, 17, 6), new THREE.MeshBasicMaterial({ color: FREEZE_COLOR, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  iceShell.position.z = 0.04; iceRing.position.z = 0.05;
  ice.add(iceShell, iceRing);
  ice.visible = false;
  ice.userData = { shell: iceShell, ring: iceRing };
  group.add(aura, flame, hull, shield, ice);

  scene.add(group);

  // Debug helpers
  const trajGeo = new THREE.BufferGeometry();
  trajGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAJ_MAX * 3), 3));
  const traj = new THREE.Line(trajGeo, new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.55 }));
  traj.frustumCulled = false; traj.visible = false;
  scene.add(traj);
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HULL.length * 3), 3));
  const hullPts = new THREE.Points(hullGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 4, sizeAttenuation: false }));
  hullPts.frustumCulled = false; hullPts.visible = false;
  scene.add(hullPts);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 10, hex, 8, 6);
  arrow.position.z = 4; arrow.visible = false;
  scene.add(arrow);

  const v = {
    hex, color: new THREE.Color(hex), group, flame, hull, aura, shield, traj, hullPts, arrow,
    ice,
    design: null, nozzles: null,
    smokeAcc: 0,
    cam: { x: W / 2, y: H / 2, shake: 0 },
  };
  setDesign(v, null);
  return v;
}
// Builds the ship's hull from a design (ships/designs.js) in the ship's current colour.
export function setDesign(v, id) {
  const d = designOf(id);
  if (v.design === d.id) return;
  v.hull.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } });
  v.hull.clear();
  v.hull.add(d.build(v.hex));
  v.design = d.id;
  v.nozzles = d.nozzles;
  v.flame.position.y = d.flameY;
}
// Recolours the hull to a player colour.
export function setHullColor(v, hex) { v.hull.children[0]?.userData.setColor(hex); }
export const TRAJ_MAX = 600;
export const views = [makeView(0), makeView(1)];
