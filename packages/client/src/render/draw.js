import * as THREE from 'three';
import { P, WEAPONS } from '../config.js';
import { game } from '../state.js';
import { solidAt } from '../level/mask.js';
import { hullWorld, TRAJ_MAX } from '../ships/ship.js';
import { shipMass } from '../ships/physics.js';
import { B, bulletGeo, MAXB } from '../fx/pools.js';
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
  for (let i = 0; i < MAXB; i++) {
    if (!B.on[i]) continue;
    const kind = B.kind[i], wp = WEAPONS[kind];
    const col = bulletColor(i);
    bp[n * 3] = B.x[i]; bp[n * 3 + 1] = B.y[i]; bp[n * 3 + 2] = 0;
    bc[n * 3] = col.r; bc[n * 3 + 1] = col.g; bc[n * 3 + 2] = col.b;
    bs[n] = kind === 1 ? wp.size * (0.9 + 0.15 * Math.sin(game.time * 30 + i)) : wp.size;
    // Live piece from the last dropped trail point up to the bullet itself.
    tn = trailQuad(tp, tc, tn, B.tx[i], B.ty[i], Math.max(0, 1 - (now - B.tt[i]) / wp.tLife), B.x[i], B.y[i], 1, wp.tWidth, col.r, col.g, col.b);
    n++;
  }
  bulletGeo.setDrawRange(0, n);
  bulletGeo.attributes.position.needsUpdate = true;
  bulletGeo.attributes.tint.needsUpdate = true;
  bulletGeo.attributes.size.needsUpdate = true;
  trailGeo.setDrawRange(0, tn * 6);
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;

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
  partGeo.attributes.position.needsUpdate = true;
  partGeo.attributes.tint.needsUpdate = true;
  partGeo.attributes.size.needsUpdate = true;
  drawTerrainBits();

  const sp = smokeGeo.attributes.position.array, ss = smokeGeo.attributes.size.array, sa = smokeGeo.attributes.alpha.array;
  n = 0;
  for (let i = 0; i < MAXS; i++) {
    if (!SM.on[i]) continue;
    const f = SM.life[i] / SM.max[i], age = 1 - f;
    sp[n * 3] = SM.x[i]; sp[n * 3 + 1] = SM.y[i]; sp[n * 3 + 2] = 0;
    ss[n] = SM.sz[i] * (1 + 2.5 * age);
    sa[n] = 0.32 * f * Math.min(1, age * 12);
    n++;
  }
  smokeGeo.setDrawRange(0, n);
  smokeGeo.attributes.position.needsUpdate = true;
  smokeGeo.attributes.size.needsUpdate = true;
  smokeGeo.attributes.alpha.needsUpdate = true;
}

export function drawDebug(s, alpha) {
  // Trajectory: where the ship goes if the pilot keeps doing exactly what they're doing now.
  if (P.showTrajectory && s.alive) {
    const pos = s.traj.geometry.attributes.position.array;
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
    s.traj.geometry.setDrawRange(0, n);
    s.traj.geometry.attributes.position.needsUpdate = true;
    s.traj.visible = true;
  } else s.traj.visible = false;

  if (P.showHull && s.alive) {
    const pts = hullWorld(s);
    const arr = s.hullPts.geometry.attributes.position.array;
    pts.forEach((p, i) => { arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = 4; });
    s.hullPts.geometry.attributes.position.needsUpdate = true;
    s.hullPts.visible = true;
  } else s.hullPts.visible = false;

  const sp = Math.hypot(s.vx, s.vy);
  if (P.showVelocity && s.alive && sp > 1) {
    s.arrow.position.set(s.x, s.y, 4);
    s.arrow.setDirection(new THREE.Vector3(s.vx / sp, s.vy / sp, 0));
    s.arrow.setLength(Math.max(12, sp * 0.3), 8, 6);
    s.arrow.visible = true;
  } else s.arrow.visible = false;
}
