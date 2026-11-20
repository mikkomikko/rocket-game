import * as THREE from 'three';
import { mulberry32 } from '@rocket-duel/shared/math.js';
import { H, W } from '@rocket-duel/shared/level/mask.js';
import { glowMat } from '../../render/scene.js';
import { shapeGeo } from '../../ships/view.js';
import { canvasTex, girderMat, stripedPlane } from '../floors/floors.js';
import { backWallMat, resetStarship, SH, SHIP_GROUP } from '../starship/starship.js';
import { buildAmmo, buildMedkits } from '../starship/supplies.js';
import { makeRobotMesh } from './robotMesh.js';
import { resetRobot } from './robot.js';
import { HANGAR_SHIPS } from '@rocket-duel/shared/level/terrain.js';

/* ------------------------------------------------------------------ *
 * Robot hangar: parked starships, and a giant robot that drops in from the roof.
 * It shoots a laser from its eye, punches with stretchy piston arms and sends out small robots.
 * ------------------------------------------------------------------ */
export const ROBOT_MAXHP = 1400, ROBOT_REACH = 480, ROBOT_XMIN = 1150, ROBOT_HIP = 200;
export const RB = { on: false, state: 'off', x: 1450, y: 56, vy: 0, dir: -1, hp: ROBOT_MAXHP, flash: 0, phase: 0, bob: 0, laserCd: 3, punchCd: 2, spawnCd: 6, spawning: 0, hatch: 0, roof: 0, t: 0, laser: null, dead: false, beamW: 34, mesh: null, roofMesh: null,
  arms: [{ side: -1, fx: 0, fy: 0, mode: 'rest', t: 0, ux: 0, uy: -1, hit: false }, { side: 1, fx: 0, fy: 0, mode: 'rest', t: 0, ux: 0, uy: -1, hit: false }] };
export const ROBOT_ORANGE = new THREE.Color('#ffb020'), ROBOT_DUST = new THREE.Color('#9aa0b4');
// Robot-local point to world, including the tilt when it falls over (it pivots on the edge it falls toward).
export function rbLocal(lx, ly) {
  const px = (RB.fd || 1) * 112, c = Math.cos(RB.rot || 0), sn = Math.sin(RB.rot || 0), dx = lx - px;
  return [RB.x + px + dx * c - ly * sn, RB.y + dx * sn + ly * c];
}
export const rbShoulder = (side) => rbLocal(side * 118, 385 + RB.bob);
export const rbRest = (side) => { const [sx, sy] = rbShoulder(side); return [sx + side * 28, sy - 165 + 4 * Math.sin(RB.phase * 0.5 + side)]; };
export function robotEye() { return rbLocal(RB.dir * 14, ROBOT_HIP + 252 + RB.bob); }
// It breaks a bit more at 80 %, 60 %, 45 %, 30 % and 15 % health.
const ROBOT_STAGES = [0.8, 0.6, 0.45, 0.3, 0.15];
export const robotStage = () => ROBOT_STAGES.filter((f) => RB.hp < ROBOT_MAXHP * f).length;
export const robotAngry = () => RB.hp < ROBOT_MAXHP * 0.5;


const signTex = canvasTex(256, 64, (g) => {
  g.fillStyle = '#1a1d2e'; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#ffb020'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 56);
  g.fillStyle = '#ffb020'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('HANGAR 7', 128, 34);
});
export function hPlane(w, h, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  return m;
}
export function hPoly(pts, mat, z, dx = 0, dy = 0) {
  const m = new THREE.Mesh(shapeGeo(pts), mat);
  m.position.set(dx, dy, z);
  return m;
}
export const bmat = (hex) => new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide });
// Weathering for the droid, drawn once: grime streaks running down, rust specks and light scratches.
export const grimeTex = canvasTex(128, 128, (g) => {
  const r = mulberry32(77);
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(22,17,10,${(0.05 + r() * 0.13).toFixed(3)})`; g.fillRect(r() * 128, r() * 128, 2 + r() * 7, 10 + r() * 44); }
  for (let i = 0; i < 45; i++) { g.fillStyle = `rgba(125,62,28,${(0.12 + r() * 0.22).toFixed(3)})`; g.beginPath(); g.arc(r() * 128, r() * 128, 0.8 + r() * 2.6, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(255,248,230,0.2)'; g.lineWidth = 1;
  for (let i = 0; i < 28; i++) { const x = r() * 128, y = r() * 128; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 22, y + (r() - 0.5) * 8); g.stroke(); }
});
export const stencilTex = canvasTex(128, 40, (g) => {
  g.fillStyle = 'rgba(30,26,20,0.75)'; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('KR-07', 64, 22);
});
export const rivetGeo = new THREE.CircleGeometry(2.2, 8);

export function buildHangar() {
  const sp = SH.spec;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 80, H - 112), backWallMat);
  back.position.set(W / 2, H / 2, -0.7);
  SHIP_GROUP.add(back);
  // Big ships parked far back in the hangar, as dark shapes with little lights.
  const sil = bmat('#20243a'), silLight = glowMat(new THREE.Color('#6ee7ff'), 0.7);
  for (const [dx, dy, s] of [[120, 330, 1.2], [980, 470, 0.9]]) {
    const pts = [[0, 0], [520, 0], [620, 50], [520, 120], [80, 130], [0, 90]].map(([x, y]) => [dx + x * s, dy + y * s]);
    SHIP_GROUP.add(hPoly(pts, sil, -0.66));
    SHIP_GROUP.add(hPoly([[0, 90], [80, 130], [50, 210], [10, 200]].map(([x, y]) => [dx + x * s, dy + y * s]), sil, -0.66));
    for (let k = 0; k < 7; k++) SHIP_GROUP.add(hPlane(16, 16, silLight, dx + (120 + k * 55) * s, dy + 70 * s, -0.65));
  }
  SHIP_GROUP.add(hPlane(256, 64, new THREE.MeshBasicMaterial({ map: signTex }), 760, 900, -0.64));
  for (let x = 200; x < W - 100; x += 200) {
    SHIP_GROUP.add(hPlane(60, 10, bmat('#3a3f55'), x, H - 61, 0.35));
    SHIP_GROUP.add(hPlane(120, 60, glowMat(new THREE.Color('#fff1c2'), 0.35), x, H - 70, 0.34));
  }
  // The parked starships you can land on and hide behind.
  for (const sh of HANGAR_SHIPS) {
    const hull = bmat(sh.col), under = bmat(sh.under), stripe = bmat(sh.stripe);
    for (const p of sh.posts) SHIP_GROUP.add(hPlane(p[2] - p[0], p[3] - p[1], bmat('#4a5068'), (p[0] + p[2]) / 2, (p[1] + p[3]) / 2, 0.29));
    if (sh.fin) SHIP_GROUP.add(hPoly(sh.fin, under, 0.3));
    SHIP_GROUP.add(hPoly(sh.hull, hull, 0.31));
    const ys = sh.hull.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const xs = sh.hull.map((p) => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
    SHIP_GROUP.add(hPlane((x1 - x0) * 0.82, (y1 - y0) * 0.22, under, x0 + (x1 - x0) * 0.47, y0 + (y1 - y0) * 0.11, 0.315));
    SHIP_GROUP.add(hPlane((x1 - x0) * 0.6, 6, stripe, x0 + (x1 - x0) * 0.42, y0 + (y1 - y0) * 0.5, 0.32));
    for (const [wx, wy] of sh.win) {
      const w = new THREE.Mesh(new THREE.CircleGeometry(7, 14), bmat('#1b2a4a')); w.position.set(wx, wy, 0.325); SHIP_GROUP.add(w);
      const gl = new THREE.Mesh(new THREE.CircleGeometry(3, 10), bmat('#6ee7ff')); gl.position.set(wx - 2, wy + 2, 0.33); SHIP_GROUP.add(gl);
    }
    const [nx, ny, nr] = sh.nozzle;
    SHIP_GROUP.add(hPlane(14, nr, bmat('#2a2e40'), nx, ny, 0.305));
    SHIP_GROUP.add(hPlane(nr * 2, nr * 2, glowMat(new THREE.Color('#6ee7ff'), 0.35), nx - 6, ny, 0.3));
  }
  for (const c of sp.catwalks) {
    const m = new THREE.Mesh(stripedPlane(c[2] - c[0], c[3] - c[1], 2 * (c[3] - c[1])), girderMat);
    m.position.set((c[0] + c[2]) / 2, (c[1] + c[3]) / 2, 0.3);
    SHIP_GROUP.add(m);
  }
  // The roof hatch the robot drops through.
  const roof = new THREE.Group();
  const hl = new THREE.Mesh(stripedPlane(150, 18, 36), girderMat), hr = new THREE.Mesh(stripedPlane(150, 18, 36), girderMat);
  hl.position.set(-75, 0, 0); hr.position.set(75, 0, 0);
  roof.add(hl, hr);
  roof.position.set(1450, H - 47, 0.36);
  SHIP_GROUP.add(roof);
  RB.roofMesh = { hl, hr };
  buildAmmo();
  buildMedkits();
  SH.doorMesh = null; SH.doorSign = null;
  RB.mesh = makeRobotMesh();
  SHIP_GROUP.add(RB.mesh.g, ...RB.mesh.arms.map((a) => a.g));
  resetRobot();
  resetStarship();
}
