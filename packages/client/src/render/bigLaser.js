import * as THREE from 'three';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { BIG } from '@rocket-duel/shared/ships/bigLaser.js';
import { glowMat, scene } from './scene.js';
import { views } from '../ships/view.js';

// The Big laser's beam and charging orb, one set per ship.
const pbeams = views.map((v) => {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0.5, 0, 0);
  const add = (mat, z) => { const m = new THREE.Mesh(geo, mat); m.position.z = z; m.frustumCulled = false; m.visible = false; scene.add(m); return m; };
  const glow = add(new THREE.MeshBasicMaterial({ color: v.hex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 2.5);
  const core = add(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 2.55);
  const orb = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat(v.color, 0.95));
  orb.position.z = 2.6; orb.frustumCulled = false; orb.visible = false;
  scene.add(orb);
  return { glow, core, orb };
});
export function drawBigLasers(now) {
  ships.forEach((s, i) => {
    const pb = pbeams[i], b = s.alive ? s.beam : null;
    pb.orb.visible = !!b;
    pb.glow.visible = pb.core.visible = !!b && b.phase === 'fire';
    if (!b) return;
    const k = b.phase === 'charge' ? 1 - b.t / BIG.charge : 1;
    pb.orb.position.set(b.ox, b.oy, 2.6);
    pb.orb.scale.setScalar(b.phase === 'charge' ? 14 + 50 * k : 70 + 10 * Math.sin(now / 30));
    if (b.phase !== 'fire') return;
    const fade = Math.min(1, b.t / 0.15);
    for (const [m, w, op] of [[pb.glow, BIG.width + 26, 0.6], [pb.core, BIG.width * 0.42, 1]]) {
      m.position.set(b.ox, b.oy, m.position.z);
      m.rotation.z = b.ang;
      m.scale.set(Math.max(1, b.len), w * (0.85 + 0.15 * Math.sin(now / 25)) * fade, 1);
      m.material.opacity = op;
    }
  });
}
