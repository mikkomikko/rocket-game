import * as THREE from 'three';
import { game } from '@rocket-duel/shared/state.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { onSim } from '@rocket-duel/shared/events.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { scene } from './scene.js';
import { drawPos } from '../net/online.js';

/* ------------------------------------------------------------------ *
 * Missile sight: when a player fires a missile, a blinking crosshair in that player's own view shows whether
 * it will reach the other ship (missileReach at launch, which assumes the other ship stays put): green on the
 * other ship when it will, red where the missile will stop (rock, or out of fuel) when not. It shows until
 * about when the missile gets there.
 * ------------------------------------------------------------------ */
const GREEN = new THREE.Color('#5dff8a'), RED = new THREE.Color('#ff4d4d');
const R = 15;

function makeSight(id) {
  const mat = new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.9, depthWrite: false });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.RingGeometry(R - 1.6, R, 40), mat));
  for (let k = 0; k < 4; k++) {   // ticks from outside the ring in towards the centre
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 8), mat), a = k * Math.PI / 2;
    tick.position.set(Math.cos(a) * (R + 1), Math.sin(a) * (R + 1), 0);
    tick.rotation.z = a + Math.PI / 2;
    g.add(tick);
  }
  g.add(new THREE.Mesh(new THREE.CircleGeometry(1.6, 12), mat));
  g.position.z = 2.2;
  g.visible = false;
  g.traverse((o) => o.layers.set(id + 1));   // only this player's camera sees it
  scene.add(g);
  return { g, mat };
}
const sights = [makeSight(0), makeSight(1)];

const shown = [null, null];   // per ship: { reach, until }
onSim('fired', (s, id, nose, ang, reach) => {
  if (id === 'missile' && reach) shown[s.id] = { reach, until: game.time + clamp(reach.t + 0.25, 0.8, 2.5) };
});
onSim('bulletsCleared', () => { shown[0] = shown[1] = null; });

export function drawMissileSights(alpha) {
  for (const s of ships) {
    const { g, mat } = sights[s.id], sh = shown[s.id], target = ships[1 - s.id];
    if (sh && (game.time > sh.until || (sh.reach.hit && !target.alive))) shown[s.id] = null;
    const reach = shown[s.id]?.reach;
    g.visible = !!reach && Math.sin(game.time * 14) > -0.3;
    if (!reach) continue;
    // A hit sits on the other ship where it's drawn; a miss marks the spot where the missile will stop.
    const p = reach.hit ? drawPos(target, alpha) : reach;
    g.position.x = p.x; g.position.y = p.y;
    g.rotation.z = reach.hit ? game.time * 1.5 : Math.PI / 4;   // a hit spins; a miss shows as an ×
    mat.color.copy(reach.hit ? GREEN : RED);
  }
}
