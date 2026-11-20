import * as THREE from 'three';
import { P1HEX, P2HEX } from '../config.js';
import { BALL_COLOR, BALL_R, FREEZE_COLOR, P } from '@rocket-duel/shared/config.js';
import { H, solidAt, W } from '@rocket-duel/shared/level/mask.js';
import { glowMat, scene } from '../render/scene.js';

/* ------------------------------------------------------------------ *
 * Ships
 * ------------------------------------------------------------------ */
// Hull sample points in ship-local units (nose points along +y). Collision samples these.
const HULL = [[0, 12], [8, -8], [-8, -8], [4.5, 2], [-4.5, 2], [0, -4.5]];
export const SHIP_RADIUS = 10;

export function shapeGeo(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

function makeShip(id) {
  const hex = id === 0 ? P1HEX : P2HEX;
  const col = new THREE.Color(hex);
  const group = new THREE.Group();
  group.position.z = 1;
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), glowMat(col, 0.2));
  aura.position.z = -0.05;
  const hullMat = new THREE.MeshBasicMaterial({ color: hex, transparent: true });
  const shadeMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.45), transparent: true });
  const left = new THREE.Mesh(shapeGeo([[0, 12], [-8, -8], [-3, -4.5], [0, -4.5]]), hullMat);
  const right = new THREE.Mesh(shapeGeo([[0, 12], [0, -4.5], [3, -4.5], [8, -8]]), shadeMat);
  const cockpit = new THREE.Mesh(shapeGeo([[0, 7], [2.6, 0.5], [-2.6, 0.5]]), new THREE.MeshBasicMaterial({ color: '#1b1640', transparent: true }));
  cockpit.position.z = 0.01;
  const glint = new THREE.Mesh(shapeGeo([[0, 6.2], [-1.9, 1.2], [-0.9, 1.2]]), new THREE.MeshBasicMaterial({ color: '#b9b0ff', transparent: true, opacity: 0.7 }));
  glint.position.z = 0.02;
  const flame = new THREE.Group();
  flame.position.set(0, -4.5, -0.01);
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
  // Bouncer ball: a see-through bubble with stripes (they spin as it rolls) and a fixed highlight.
  const ball = new THREE.Group();
  const ballMat = (op) => new THREE.MeshBasicMaterial({ color: BALL_COLOR, transparent: true, opacity: op, depthWrite: false });
  const ballFill = new THREE.Mesh(new THREE.CircleGeometry(BALL_R, 40), ballMat(0.2));
  const ballRim = new THREE.Mesh(new THREE.RingGeometry(BALL_R - 1.6, BALL_R, 48), ballMat(0.85));
  const ballStripes = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const st = new THREE.Mesh(new THREE.PlaneGeometry(BALL_R * 1.9, 1.4), ballMat(0.45));
    st.rotation.z = k * Math.PI / 3;
    ballStripes.add(st);
  }
  const ballShine = new THREE.Mesh(new THREE.CircleGeometry(3.2, 16), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false }));
  const ballShinePivot = new THREE.Group();
  ballShine.position.set(-BALL_R * 0.45, BALL_R * 0.5, 0.01);
  ballShinePivot.add(ballShine);
  ballFill.position.z = 0.06; ballStripes.position.z = 0.07; ballRim.position.z = 0.08; ballShinePivot.position.z = 0.09;
  ball.add(ballFill, ballStripes, ballRim, ballShinePivot);
  ball.visible = false;
  ball.userData = { fill: ballFill, rim: ballRim, stripes: ballStripes, shine: ballShinePivot, mats: [ballFill.material, ballRim.material, ...ballStripes.children.map((c) => c.material), ballShine.material] };
  ball.userData.base = ball.userData.mats.map((m) => m.opacity);
  group.add(aura, flame, left, right, cockpit, glint, shield, ice, ball);

  // Aim guide: a faint line from the nose out to a small crosshair. Seen only in this player's own view.
  const aim = new THREE.Group();
  const AIM_FROM = 15, AIM_TO = 84, AIM_R = 4.2;
  const lineLen = AIM_TO - AIM_R - 2 - AIM_FROM;
  const lineGeo = new THREE.PlaneGeometry(0.9, lineLen);
  const lc = [];
  for (let i = 0; i < lineGeo.attributes.position.count; i++) {
    const top = lineGeo.attributes.position.getY(i) > 0;
    lc.push(col.r, col.g, col.b, top ? 0.06 : 0.38);   // fades out towards the crosshair
  }
  lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lc, 4));
  const aimLine = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  aimLine.position.y = AIM_FROM + lineLen / 2;
  const crossMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  const cross = new THREE.Group();
  cross.position.y = AIM_TO;
  cross.add(new THREE.Mesh(new THREE.RingGeometry(AIM_R - 0.7, AIM_R, 32), crossMat));
  for (let k = 0; k < 4; k++) {
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.6), crossMat);
    const ang = k * Math.PI / 2;
    tick.position.set(-Math.sin(ang) * (AIM_R + 2), Math.cos(ang) * (AIM_R + 2), 0);
    tick.rotation.z = ang;
    cross.add(tick);
  }
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), crossMat);
  cross.add(dot);
  aim.add(aimLine, cross);
  aim.position.z = 0.06;
  aim.traverse((o) => o.layers.set(id + 1));
  group.add(aim);
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

  return {
    id, hex, color: new THREE.Color(hex), group, flame, hullMat, shadeMat, crossMat, aimGeo: lineGeo, aura, shield, traj, hullPts, arrow,
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, a: 0, pa: 0, av: 0, thrust: 0,
    hp: 100, ammo: P.ammoMax, landed: false, onPad: false, alive: true,
    respawnT: 0, invulnT: 0, fireCd: 0, score: 0, deathX: 0, deathY: 0, active: true, lastImpact: 0, smokeAcc: 0,
    weapon: 0, frozenT: 0, crossT: 0, ice, aim, ballT: 0, ball,
    input: { turn: 0, thrust: 0, fire: false },
    cam: { x: W / 2, y: H / 2, shake: 0 },
  };
}
export const TRAJ_MAX = 600;
export const ships = [makeShip(0), makeShip(1)];

const HW = HULL.map(() => [0, 0]);
export function hullWorld(s, dx = 0, dy = 0) {
  const c = Math.cos(s.a), sn = Math.sin(s.a), k = P.shipSize;
  for (let i = 0; i < HULL.length; i++) {
    const lx = HULL[i][0] * k, ly = HULL[i][1] * k;
    HW[i][0] = s.x + dx + lx * c - ly * sn;
    HW[i][1] = s.y + dy + lx * sn + ly * c;
  }
  return HW;
}
export function hullSolid(s, dx = 0, dy = 0) {
  const pts = hullWorld(s, dx, dy);
  for (const p of pts) if (solidAt(p[0], p[1])) return true;
  return false;
}
export function localToWorld(s, lx, ly) {
  const c = Math.cos(s.a), sn = Math.sin(s.a), k = P.shipSize;
  return { x: s.x + (lx * c - ly * sn) * k, y: s.y + (lx * sn + ly * c) * k };
}
