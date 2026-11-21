import * as THREE from 'three';
import { mulberry32 } from '@rocket-duel/shared/math.js';
import { glowMat } from '../../render/scene.js';
import { canvasTex } from '../floors/floors.js';
import { beamGeo } from '../starship/starship.js';
import { ROBOT_EYE_X } from '@rocket-duel/shared/maps/hangar.js';
import { bmat, hPlane, hPoly, ROBOT_HIP, ROBOT_ORANGE } from './hangar.js';

// How much the chest is squeezed sideways: under 1 makes the robot slimmer. Shared maps/hangar.js puts the
// shoulders (rbShoulder) and the body's hit areas at the slim width.
const CHEST = 0.76;

// Fine glitter in the black paint, drawn once.
const sparkleTex = canvasTex(128, 128, (g) => {
  const r = mulberry32(31);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(235,240,255,${(0.08 + r() * 0.35).toFixed(3)})`; g.fillRect(r() * 128, r() * 128, 1, 1); }
});

// The giant robot's mesh, built from flat shapes: a tall, lanky droid in glossy black, with a domed head,
// two round eyes (each shoots a laser), a slim chest over a thin waist, a V-shaped hip plate, long thin limbs and silver joint rings.
// The hit areas are set in shared maps/hangar.js; the shapes here stay inside them.
export function makeRobotMesh() {
  const M = { steel: bmat('#2c2d35'), plate: bmat('#3a3c46'), dark: bmat('#1b1c22'), joint: bmat('#0d0d10'), glass: bmat('#0a0b0e'),
    stripe: bmat('#c9a227'), silver: bmat('#b4b8c2'), sheen: bmat('#5d606d'), eye: bmat('#ff2b3d'), white: bmat('#e9ecf2'),
    energy: new THREE.MeshBasicMaterial({ color: '#ffb020', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    scan: new THREE.MeshBasicMaterial({ color: '#ff7a7a', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }) };
  const base = { steel: new THREE.Color('#2c2d35'), plate: new THREE.Color('#3a3c46') };
  const glitterMat = new THREE.MeshBasicMaterial({ map: sparkleTex, transparent: true, depthWrite: false });
  const glitter = (w, h, x, y, z) => hPlane(w, h, glitterMat, x, y, z);
  const disc = (r, mat, x, y, z, sy = 1) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), mat); m.position.set(x, y, z); m.scale.y = sy; return m; };
  const g = new THREE.Group();
  g.position.z = 0.9;
  const body = new THREE.Group();
  g.add(body);

  // Long, thin legs: a tapered thigh, a silver knee, a thin shin with rings and a small flat foot.
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 44, ROBOT_HIP, side < 0 ? -0.02 : 0.02);
    hip.add(hPoly([[-15, 8], [15, 8], [10, -86], [-10, -86]], M.steel, 0));
    hip.add(hPlane(4, 74, M.sheen, -8, -38, 0.001), glitter(30, 94, 0, -39, 0.0012));
    hip.add(hPlane(2, 40, M.joint, 5, -56, 0.0011), hPlane(12, 1.5, M.joint, 0, -66, 0.0011));   // panel lines
    const knee = new THREE.Group();
    knee.position.set(0, -90, 0.003);
    knee.add(hPoly([[-11, -12], [11, -12], [8, -90], [-8, -90]], M.steel, 0));
    knee.add(hPlane(3, 62, M.sheen, -4, -52, 0.001), glitter(22, 80, 0, -50, 0.0011));
    knee.add(hPlane(26, 6, M.dark, 0, -16, 0.0012), hPlane(26, 3, M.silver, 0, -21, 0.0013), hPlane(24, 3, M.silver, 0, -28, 0.0013));   // ring cuffs under the knee
    knee.add(hPlane(22, 18, M.silver, 0, 0, 0.0014), hPlane(22, 2, M.joint, 0, 3, 0.0015), hPlane(22, 2, M.joint, 0, -4, 0.0015));   // silver knee joint
    knee.add(disc(5, M.joint, 0, 0, 0.0016));
    const foot = new THREE.Group();
    foot.position.set(0, -90, 0.004);
    foot.add(hPlane(16, 10, M.silver, 0, -2, 0.001), hPlane(16, 2, M.joint, 0, -1, 0.0012));   // ankle ring
    foot.add(hPoly([[-16, -6], [12, -6], [32, -14], [32, -20], [-20, -20], [-20, -12]], M.dark, 0));
    foot.add(hPlane(40, 2, M.sheen, 6, -10, 0.001));
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(36, 90), glowMat(new THREE.Color('#ff8a3d'), 0.9));
    flame.position.set(6, -60, -0.01);
    foot.add(flame);
    knee.add(foot);
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee, foot, flame, side });
  }

  const torso = new THREE.Group();
  body.add(torso);
  // Yellow-trimmed hip joints peeking out from under the V-shaped hip plate.
  for (const sx of [-1, 1]) torso.add(disc(22, M.stripe, sx * 50, 216, 0.026), disc(18, M.dark, sx * 50, 216, 0.027));
  const pelvis = hPoly([[-74, 252], [-42, 252], [0, 226], [42, 252], [74, 252], [30, 186], [-30, 186]], M.steel, 0.03);
  torso.add(pelvis);
  pelvis.add(hPlane(48, 2, M.joint, 0, 198, 0.0005), hPoly([[-66, 248], [-48, 248], [-20, 205], [-28, 200]], M.sheen, 0.0004), glitter(150, 70, 0, 218, 0.0006));
  pelvis.add(hPlane(10, 12, M.dark, 44, 236, 0.0007), hPlane(6, 1.5, M.joint, 44, 238, 0.0008));
  // A thin, ribbed waist between the hips and the chest, with the hatch the small robots come out of.
  torso.add(hPoly([[-30, 232], [30, 232], [42, 330], [-42, 330]], M.dark, 0.032));
  for (const x of [-26, -16, 16, 26]) torso.add(hPlane(2, 80, M.joint, x, 274, 0.033));
  for (let k = 0; k < 4; k++) torso.add(hPlane(64 - k * 4, 2, M.sheen, 0, 318 - k * 4, 0.033));
  torso.add(hPlane(46, 44, M.glass, 0, 296, 0.05));
  const hatchGlow = hPlane(80, 80, glowMat(new THREE.Color('#ff2b3d'), 0.5), 0, 296, 0.052);
  torso.add(hatchGlow);
  const doorL = hPlane(23, 44, M.plate, -11.5, 296, 0.055), doorR = hPlane(23, 44, M.plate, 11.5, 296, 0.055);
  for (const d of [doorL, doorR]) for (let k = 0; k < 3; k++) d.add(hPlane(15, 1.5, M.joint, 0, -10 + k * 10, 0.0005));
  torso.add(doorL, doorR);
  // The chest: a dark back shell with yellow seams at the shoulders, and the glossy chest plate in front.
  // It is drawn wide and squeezed sideways by CHEST, which keeps the robot slim rather than buff.
  const chest = new THREE.Group();
  chest.scale.x = CHEST;
  torso.add(chest);
  chest.add(hPoly([[-76, 410], [76, 410], [108, 394], [112, 350], [96, 326], [40, 308], [-40, 308], [-96, 326], [-112, 350], [-108, 394]], M.steel, 0.04));
  // Under the chest plate: a dark cavity full of wires (you only see it once the plate is blown off).
  chest.add(hPoly([[-66, 400], [66, 400], [92, 386], [94, 356], [82, 338], [30, 322], [-30, 322], [-82, 338], [-94, 356], [-92, 386]], bmat('#161a28'), 0.042));
  const wireCols = ['#ff4d5e', '#ffd23f', '#3d7bff', '#5dff8a'];
  for (let k = 0; k < 7; k++) {
    const x0 = -60 + k * 20, pts = [];
    for (let i = 0; i <= 6; i++) pts.push([x0 + Math.sin(i * 1.3 + k) * 12, 330 + i * 11]);
    const mat = bmat(wireCols[k % 4]);
    for (let i = 0; i < 6; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], m = new THREE.Mesh(beamGeo, mat);
      m.position.set(ax, ay, 0.043); m.rotation.z = Math.atan2(by - ay, bx - ax); m.scale.set(Math.hypot(bx - ax, by - ay) + 1, 4, 1);
      chest.add(m);
    }
  }
  const chestPlate = hPoly([[-60, 406], [0, 410], [60, 406], [86, 400], [98, 390], [102, 356], [90, 334], [34, 316], [-34, 316], [-90, 334], [-102, 356], [-98, 390], [-86, 400]], M.plate, 0.045);
  chest.add(chestPlate);
  // A soft shine down the rounded chest, glitter, seams, the square panel and a small blue light.
  const shine = disc(30, M.sheen, -30, 372, 0.0005, 0.7);
  chestPlate.add(shine, hPoly([[-8, 400], [8, 400], [14, 352], [0, 336], [-14, 352]], M.steel, 0.0006));
  chestPlate.add(glitter(204, 90, 0, 360, 0.0012));
  chestPlate.add(hPlane(180, 1.5, M.joint, 0, 334, 0.0008));
  chestPlate.add(hPlane(24, 30, M.dark, 6, 346, 0.0009), hPlane(10, 3, M.silver, 4, 355, 0.001), hPlane(3, 16, M.silver, 0, 348, 0.001));
  for (let k = 0; k < 3; k++) chestPlate.add(hPlane(6, 1.5, M.joint, 13, 352 - k * 5, 0.001));
  chestPlate.add(hPlane(8, 14, M.joint, 44, 348, 0.0009));
  const core = disc(3, bmat('#7cc4ff'), 44, 346, 0.001);
  const coreGlow = hPlane(30, 30, glowMat(new THREE.Color('#4aa8ff'), 0.6), 44, 346, 0.0011);
  chestPlate.add(core, coreGlow);
  // Glowing seams at the chest sides and over the hip joints (they turn red when it gets angry).
  for (const sx of [-1, 1]) {
    chest.add(hPlane(4 / CHEST, 50, M.energy, sx * 105, 366, 0.041));
    torso.add(hPlane(30, 3, M.energy, sx * 52, 240, 0.031));
  }
  // Thrusters on its back, used when it drops in through the roof.
  const exhaust = [];
  for (const px of [-50, 50]) {
    torso.add(hPlane(18, 30, M.dark, px, 412, 0.02));
    const ex = hPlane(40, 56, glowMat(ROBOT_ORANGE, 0.4), px, 440, 0.019);
    torso.add(ex);
    exhaust.push(ex);
  }
  // Neck: a silver collar ring and a thin rod up to the head.
  const collar = new THREE.Mesh(new THREE.RingGeometry(18, 24, 28), M.silver);
  collar.position.set(0, 404, 0.047); collar.scale.y = 0.38;
  torso.add(collar, disc(18, M.joint, 0, 404, 0.0465, 0.38), hPlane(9, 30, M.joint, 0, 420, 0.035), hPlane(4, 28, M.silver, 0, 420, 0.036));

  // The head: a smooth dome with two round eyes, narrowing to a jaw with a silver mouth piece.
  const head = new THREE.Group();
  head.position.set(0, ROBOT_HIP + 250, 0.06);
  const finL = hPoly([[-30, 16], [-40, 10], [-40, -6], [-30, -12]], M.dark, -0.001), finR = hPoly([[30, 16], [40, 10], [40, -6], [30, -12]], M.dark, -0.001);
  head.add(finL, finR);   // ear plates
  head.add(disc(34, M.steel, 0, 14, 0));
  head.add(hPoly([[-30, 6], [30, 6], [24, -16], [12, -30], [-12, -30], [-24, -16]], M.steel, 0.0005));
  head.add(disc(14, M.sheen, -12, 32, 0.001, 0.6), glitter(68, 80, 0, 8, 0.0011));
  head.add(hPlane(56, 3, M.dark, 0, 11, 0.0015));   // brow line
  const EX = ROBOT_EYE_X;   // the lasers start here (shared maps/hangar.js robotEye)
  for (const ex of [-EX, EX]) head.add(disc(9, M.joint, ex, 1, 0.0018));
  const eye = disc(4.2, M.eye, EX, 1, 0.003);
  const eyeGlow = hPlane(80, 80, glowMat(new THREE.Color('#ff2b3d'), 0.4), EX, 1, 0.004);
  const eye2 = disc(4.2, M.eye, -EX, 1, 0.003);
  const eyeGlow2 = hPlane(80, 80, eyeGlow.material, -EX, 1, 0.004);   // shares the front eye's glow
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 7.5, 24), M.white); ring.position.set(EX, 1, 0.0025);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(4.2, 7.5, 24), M.white); ring2.position.set(-EX, 1, 0.0025);
  head.add(eye, eyeGlow, eye2, eyeGlow2, ring, ring2);
  const scan = hPlane(2, 14, M.scan, 0, 1, 0.0022);
  head.add(scan);
  // Jaw struts beside the mouth, and the silver mouth piece with its grille.
  const ant1 = hPlane(4, 24, M.joint, -18, -24, 0.0018), ant2 = hPlane(4, 24, M.joint, 18, -24, 0.0018);
  head.add(ant1, ant2);
  const crest = hPoly([[-7, -16], [7, -16], [6, -40], [-6, -40]], M.silver, 0.002);
  for (let k = 0; k < 3; k++) crest.add(hPlane(8, 1.5, M.joint, 0, -24 - k * 5, 0.0002));
  head.add(crest);
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) head.add(hPlane(8, 1.5, M.joint, sx * 21, -8 - k * 4, 0.0015));   // cheek vents
  // Two small status lights at the temples (they blink).
  const tip = disc(2.6, M.eye, -26, 24, 0.002), tip2 = disc(2.6, M.eye, 26, 24, 0.002);
  head.add(tip, tip2);

  // Damage that shows up as it gets shot: cracks, scorch marks, a cracked face and fires.
  const crackLine = (pts, w, mat, z) => {
    const g = new THREE.Group();
    g.position.z = z;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], m = new THREE.Mesh(beamGeo, mat);
      m.position.set(x0, y0, 0); m.rotation.z = Math.atan2(y1 - y0, x1 - x0); m.scale.set(Math.hypot(x1 - x0, y1 - y0) + 1, w, 1);
      g.add(m);
    }
    g.visible = false;
    return g;
  };
  const crackMat = bmat('#8c909e');
  const cracks = [
    crackLine([[-84, 388], [-64, 372], [-72, 356], [-50, 340]], 2.5, crackMat, 0.0465),
    crackLine([[74, 340], [58, 356], [74, 372], [60, 394]], 2.5, crackMat, 0.0465),
    crackLine([[-24, 330], [-10, 344], [-28, 360], [-16, 376]], 2.5, crackMat, 0.0465),
  ];
  chest.add(...cracks);
  const visorCrack = crackLine([[-28, 4], [-18, -6], [-22, -14], [-10, -24]], 2, crackMat, 0.0024);
  head.add(visorCrack);
  const scorchMat = bmat('#4a3626');
  const scorch = [[-50, 372, 12, 1], [70, 352, 10, 2], [28, 390, 13, 3], [-84, 346, 10, 4], [-16, 270, 11, 5]].map(([x, y, r, st]) => {
    const m = disc(r, scorchMat, x, y, 0.0467, 0.8); m.visible = false;
    chest.add(m);
    return { m, st };
  });
  const fires = [[-60, 362, 3], [52, 388, 4], [-90, 336, 5], [72, 346, 5]].map(([x, y, st]) => {
    const m = hPlane(70, 90, glowMat(new THREE.Color('#ff7a1a'), 0.8), x, y + 20, 0.065);
    m.visible = false;
    chest.add(m);
    return { m, st, lx: x * CHEST, ly: y };
  });
  body.add(head);

  // Long, thin arms with silver rings, in world space so the hands can fly out to where they punch.
  const arms = [];
  for (const side of [-1, 1]) {
    const a = new THREE.Group();
    a.position.z = 0.93 + (side > 0 ? 0.01 : 0);
    const rod = new THREE.Mesh(beamGeo, M.steel); rod.position.z = 0;
    const piston = new THREE.Mesh(beamGeo, M.plate); piston.position.z = 0.002;
    const band = new THREE.Mesh(beamGeo, M.silver); band.position.z = 0.003;
    const cuff = new THREE.Mesh(beamGeo, M.silver); cuff.position.z = 0.003;
    const shoulder = disc(16, M.silver, 0, 0, 0.004);
    // The hand points along the arm (+x): a silver wrist, a palm and four long fingers.
    const fist = new THREE.Group();
    fist.position.z = 0.005;
    fist.add(hPlane(14, 16, M.silver, -18, 0, 0), hPlane(2, 16, M.joint, -18, 0, 0.0005));
    fist.add(hPoly([[-11, -12], [10, -16], [14, 16], [-11, 13]], M.plate, 0.001), hPlane(16, 2, M.sheen, 0, 6, 0.0015));
    for (let k = 0; k < 4; k++) {
      const fy = -11 + k * 7.3;
      fist.add(hPlane(16, 4.6, M.dark, 21, fy, 0.001), hPlane(14, 4, M.dark, 35, fy * 0.9, 0.001), hPlane(2, 4.6, M.silver, 29, fy * 0.95, 0.0012));
    }
    fist.add(hPoly([[-4, 14], [6, 14], [18, 24], [12, 28]], M.dark, 0.0012));   // thumb
    const fistGlow = hPlane(110, 110, glowMat(ROBOT_ORANGE, 0), 0, 0, -0.001);
    fist.add(fistGlow);
    const coil = new THREE.Mesh(beamGeo, M.energy); coil.position.z = 0.001;
    // The shoulder cap: a rounded block over the top of the arm, with a yellow seam on its inner side.
    const pad = new THREE.Group();
    pad.position.z = 0.006;
    pad.add(hPoly([[-14, -30], [16, -30], [20, -12], [20, 18], [10, 28], [-14, 28]], M.steel, 0));
    pad.add(hPlane(3, 52, M.stripe, -15, -1, 0.0005), hPlane(4, 40, M.sheen, -5, 0, 0.0006), glitter(34, 58, 3, -1, 0.0007));
    for (let k = 0; k < 2; k++) pad.add(hPlane(12, 1.5, M.joint, 8, -12 - k * 8, 0.0008));
    a.add(rod, coil, piston, band, cuff, shoulder, fist, pad);
    arms.push({ g: a, rod, coil, piston, band, cuff, shoulder, fist, fistGlow, pad });
  }
  const dmg = { cracks, visorCrack, scorch, fires, chestPlate, ant1, ant2, finL, finR, crest, tipGone: [false, false] };
  return { g, body, legs, head, eyeGlow, eyeGlow2, hatchGlow, doorL, doorR, coreGlow, arms, M, base, scan, tips: [tip, tip2], exhaust, dmg };
}
