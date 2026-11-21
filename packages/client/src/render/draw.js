import * as THREE from 'three';
import { P, WEAPONS } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { solidAt } from '@rocket-duel/shared/level/mask.js';
import { hullWorld } from '@rocket-duel/shared/ships/ship.js';
import { TRAJ_MAX, views } from '../ships/view.js';
import { shipMass } from '@rocket-duel/shared/ships/physics.js';
import { bulletGeo, uploadUsed } from '../fx/pools.js';
import { B, BULLET_SLOTS } from '@rocket-duel/shared/bullets.js';
import { bulletColor, MAXT, TR, trailGeo, trailQuad } from '../fx/trails.js';
import { drawTerrainBits } from '../fx/debris.js';
import { MAXP, partGeo, PT } from '../fx/particles.js';
import { MAXS, SM, smokeGeo } from '../fx/smoke.js';

// Per-frame drawing of the particle pools, and the debug overlays.
export function drawPools() {
  const bp = bulletGeo.attributes.position.array, bc = bulletGeo.attributes.tint.array, bs = bulletGeo.attributes.size.array;
  const tp = trailGeo.attributes.position.array, tc = trailGeo.attributes.color.array;
  let n = 0, tn = 0;
  const now = game.time;
  for (let k = 0; k < MAXT; k++) {
    const L = TR.life[k];
    if (L <= 0) continue;
    const f1 = 1 - (now - TR.t1[k]) / L;
    if (f1 <= 0) { TR.life[k] = 0; continue; }
    const f0 = Math.max(0, 1 - (now - TR.t0[k]) / L);
    tn = trailQuad(tp, tc, tn, TR.x0[k], TR.y0[k], f0, TR.x1[k], TR.y1[k], Math.min(1, f1), TR.w[k], TR.r[k], TR.g[k], TR.b[k]);
  }
  for (let i = 0; i < BULLET_SLOTS; i++) {
    if (!B.on[i]) continue;
    const kind = B.kind[i], wp = WEAPONS[kind];
    const col = bulletColor(i);
    bp[n * 3] = B.x[i]; bp[n * 3 + 1] = B.y[i]; bp[n * 3 + 2] = 0;
    bc[n * 3] = col.r; bc[n * 3 + 1] = col.g; bc[n * 3 + 2] = col.b;
    bs[n] = wp.frag ? wp.size * (0.85 + 0.3 * Math.abs(Math.sin(game.time * 18 + i))) : kind === 1 ? wp.size * (0.9 + 0.15 * Math.sin(game.time * 30 + i)) : wp.homing ? wp.size * (0.8 + 0.3 * Math.random()) : wp.size;
    // Live piece from the last dropped trail point up to the bullet itself.
    tn = trailQuad(tp, tc, tn, B.tx[i], B.ty[i], Math.max(0, 1 - (now - B.tt[i]) / wp.tLife), B.x[i], B.y[i], 1, wp.tWidth, col.r, col.g, col.b);
    n++;
  }
  bulletGeo.setDrawRange(0, n);
  uploadUsed(bulletGeo, n, 'position', 'tint', 'size');
  trailGeo.setDrawRange(0, tn * 6);
  uploadUsed(trailGeo, tn * 6, 'position', 'color');

  const pp = partGeo.attributes.position.array, pc = partGeo.attributes.tint.array, ps = partGeo.attributes.size.array;
  n = 0;
  for (let i = 0; i < MAXP; i++) {
    if (!PT.on[i]) continue;
    const f = PT.life[i] / PT.max[i];
    pp[n * 3] = PT.x[i]; pp[n * 3 + 1] = PT.y[i]; pp[n * 3 + 2] = 0;
    pc[n * 3] = PT.r[i] * f; pc[n * 3 + 1] = PT.gr[i] * f; pc[n * 3 + 2] = PT.b[i] * f;
    ps[n] = PT.sz[i] * (0.35 + 0.65 * f);
    n++;
  }
  partGeo.setDrawRange(0, n);
  uploadUsed(partGeo, n, 'position', 'tint', 'size');
  drawTerrainBits();

  const sp = smokeGeo.attributes.position.array, ss = smokeGeo.attributes.size.array, sa = smokeGeo.attributes.alpha.array, sd = smokeGeo.attributes.dark.array;
  n = 0;
  for (let i = 0; i < MAXS; i++) {
    if (!SM.on[i]) continue;
    const f = SM.life[i] / SM.max[i], age = 1 - f;
    sp[n * 3] = SM.x[i]; sp[n * 3 + 1] = SM.y[i]; sp[n * 3 + 2] = 0;
    ss[n] = SM.sz[i] * (1 + 2.5 * age);
    sa[n] = 0.32 * f * Math.min(1, age * 12);
    sd[n] = SM.dark[i];
    n++;
  }
  smokeGeo.setDrawRange(0, n);
  uploadUsed(smokeGeo, n, 'position', 'size', 'alpha', 'dark');
}

export function drawDebug(s, alpha) {
  const v = views[s.id];
  // Trajectory: where the ship goes if the pilot keeps doing exactly what they're doing now.
  if (P.showTrajectory && s.alive) {
    const pos = v.traj.geometry.attributes.position.array;
    let x = s.x, y = s.y, vx = s.vx, vy = s.vy;
    const m = shipMass(s), acc = P.thrustForce * s.thrust / m;
    const ax = -Math.sin(s.a) * acc, ay = Math.cos(s.a) * acc;
    const dt = 1 / 60, steps = Math.min(TRAJ_MAX - 1, Math.round(P.trajectorySeconds * 60));
    const drag = Math.exp(-P.linearDrag * dt);
    pos[0] = x; pos[1] = y; pos[2] = 4;
    let n = 1;
    if (!(s.landed && ay <= P.gravity)) {
      for (let i = 0; i < steps; i++) {
        vx += ax * dt; vy += (ay - P.gravity) * dt;
        vx *= drag; vy *= drag;
        const sp = Math.hypot(vx, vy);
        if (sp > P.maxSpeed) { vx *= P.maxSpeed / sp; vy *= P.maxSpeed / sp; }
        x += vx * dt; y += vy * dt;
        pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = 4;
        n++;
        if (solidAt(x, y)) break;
      }
    }
    v.traj.geometry.setDrawRange(0, n);
    v.traj.geometry.attributes.position.needsUpdate = true;
    v.traj.visible = true;
  } else v.traj.visible = false;

  if (P.showHull && s.alive) {
    const pts = hullWorld(s);
    const arr = v.hullPts.geometry.attributes.position.array;
    pts.forEach((p, i) => { arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = 4; });
    v.hullPts.geometry.attributes.position.needsUpdate = true;
    v.hullPts.visible = true;
  } else v.hullPts.visible = false;

  const sp = Math.hypot(s.vx, s.vy);
  if (P.showVelocity && s.alive && sp > 1) {
    v.arrow.position.set(s.x, s.y, 4);
    v.arrow.setDirection(new THREE.Vector3(s.vx / sp, s.vy / sp, 0));
    v.arrow.setLength(Math.max(12, sp * 0.3), 8, 6);
    v.arrow.visible = true;
  } else v.arrow.visible = false;
}
