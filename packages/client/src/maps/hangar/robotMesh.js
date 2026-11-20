import * as THREE from 'three';
import { glowMat } from '../../render/scene.js';
import { beamGeo } from '../starship/starship.js';
import { bmat, grimeTex, hPlane, hPoly, rivetGeo, ROBOT_HIP, ROBOT_ORANGE, stencilTex } from './hangar.js';

// The giant robot's mesh, built from flat shapes.
export function makeRobotMesh() {
  // A worn, battle-scarred look: dusty grey-tan metal, off-white plates, faded rust-orange markings.
  const M = { steel: bmat('#7d786c'), plate: bmat('#b3aa96'), dark: bmat('#3a3833'), joint: bmat('#1e1d1b'), glass: bmat('#0e0f12'), stripe: bmat('#9c4a24'), eye: bmat('#ff2b3d'),
    energy: new THREE.MeshBasicMaterial({ color: '#ffb020', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    scan: new THREE.MeshBasicMaterial({ color: '#ff7a7a', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }) };
  const base = { steel: new THREE.Color('#7d786c'), plate: new THREE.Color('#b3aa96') };
  const grimeMat = new THREE.MeshBasicMaterial({ map: grimeTex, transparent: true, depthWrite: false });
  const grime = (w, h, x, y, z) => hPlane(w, h, grimeMat, x, y, z);
  const rivets = (parent, pts, z) => { for (const [x, y] of pts) { const m = new THREE.Mesh(rivetGeo, M.joint); m.position.set(x, y, z); parent.add(m); } };
  const hose = (parent, pts, w, z) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], m = new THREE.Mesh(beamGeo, M.joint);
      m.position.set(ax, ay, z); m.rotation.z = Math.atan2(by - ay, bx - ax); m.scale.set(Math.hypot(bx - ax, by - ay) + 2, w, 1);
      parent.add(m);
    }
  };
  const g = new THREE.Group();
  g.position.z = 0.9;
  const body = new THREE.Group();
  g.add(body);
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 40, ROBOT_HIP, side < 0 ? -0.02 : 0.02);
    hip.add(hPlane(36, 90, M.dark, 0, -45, 0));
    // Hydraulic piston beside the thigh, grime and rivets.
    hip.add(hPlane(9, 74, M.steel, side * 22, -45, 0.001), hPlane(5, 40, M.plate, side * 22, -28, 0.0015), grime(36, 90, 0, -45, 0.0012));
    rivets(hip, [[-12, -8], [12, -8], [-12, -82], [12, -82]], 0.0016);
    const knee = new THREE.Group();
    knee.position.set(0, -90, 0.003);
    knee.add(hPlane(32, 90, M.steel, 0, -45, 0));
    knee.add(hPlane(8, 70, M.dark, -side * 20, -50, 0.001), hPlane(4, 36, M.plate, -side * 20, -66, 0.0012), grime(32, 90, 0, -45, 0.0011));
    knee.add(hPlane(32, 1.5, M.joint, 0, -55, 0.0013));
    rivets(knee, [[-11, -40], [11, -40], [-11, -70], [11, -70]], 0.0014);
    const kc = new THREE.Mesh(new THREE.CircleGeometry(17, 18), M.joint); kc.position.z = 0.002; knee.add(kc);
    knee.add(hPoly([[-21, 12], [21, 12], [17, -24], [-17, -24]], M.plate, 0.0025), hPlane(30, 4, M.stripe, 0, -6, 0.0028));   // knee pad
    const foot = new THREE.Group();
    foot.position.set(0, -90, 0.004);
    foot.add(hPlane(70, 22, M.dark, 10, -9, 0), hPlane(70, 5, M.stripe, 10, 0, 0.001));
    foot.add(hPoly([[45, -20], [60, -20], [45, -6]], M.joint, 0.001), hPoly([[-25, -20], [-34, -20], [-25, -8]], M.joint, 0.001));   // toe and heel claws
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(36, 90), glowMat(new THREE.Color('#ff8a3d'), 0.9));
    flame.position.set(10, -60, -0.01);
    foot.add(flame);
    knee.add(foot);
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee, foot, flame, side });
  }
  const torso = new THREE.Group();
  body.add(torso);
  torso.add(hPlane(126, 40, M.joint, 0, ROBOT_HIP + 14, 0.03));
  torso.add(hPoly([[-95, 228], [95, 228], [112, 402], [-112, 402]], M.steel, 0.04));
  const chestPlate = hPoly([[-80, 242], [80, 242], [92, 392], [-92, 392]], M.plate, 0.045);
  torso.add(chestPlate);
  // Panel seams, rivets, a stenciled unit number and grime on the chest plate (they fly off with it).
  for (const y of [300, 346]) chestPlate.add(hPlane(160, 1.6, M.joint, 0, y, 0.0012));
  chestPlate.add(hPlane(1.6, 146, M.joint, -48, 317, 0.0012), hPlane(1.6, 146, M.joint, 48, 317, 0.0012));
  chestPlate.add(hPlane(46, 14, new THREE.MeshBasicMaterial({ map: stencilTex, transparent: true, depthWrite: false }), 62, 262, 0.0014));
  chestPlate.add(grime(190, 156, 0, 317, 0.0016));
  rivets(chestPlate, [...[-70, -35, 35, 70].map((x) => [x, 250]), ...[-80, -40, 40, 80].map((x) => [x, 384])], 0.0013);
  torso.add(grime(230, 178, 0, 315, 0.041));
  rivets(torso, [...[-90, -60, -30, 30, 60, 90].map((x) => [x, 234]), ...[-104, -72, 72, 104].map((x) => [x, 397])], 0.0412);
  for (const sx of [-1, 1]) hose(torso, [[sx * 92, 402], [sx * 112, 418], [sx * 126, 406], [sx * 128, 392]], 7, 0.035);   // hoses into the shoulders
  // Under the chest plate: a dark cavity full of wires (you only see it once the plate is blown off).
  torso.add(hPoly([[-74, 248], [74, 248], [84, 386], [-84, 386]], bmat('#161a28'), 0.042));
  const wireCols = ['#ff4d5e', '#ffd23f', '#3d7bff', '#5dff8a'];
  for (let k = 0; k < 7; k++) {
    const x0 = -60 + k * 20, pts = [];
    for (let i = 0; i <= 6; i++) pts.push([x0 + Math.sin(i * 1.3 + k) * 14, 256 + i * 20]);
    const mat = bmat(wireCols[k % 4]);
    for (let i = 0; i < 6; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], m = new THREE.Mesh(beamGeo, mat);
      m.position.set(ax, ay, 0.043); m.rotation.z = Math.atan2(by - ay, bx - ax); m.scale.set(Math.hypot(bx - ax, by - ay) + 1, 4, 1);
      torso.add(m);
    }
  }
  torso.add(hPlane(190, 10, M.stripe, 0, 236, 0.05));
  torso.add(hPlane(76, 66, M.glass, 0, 305, 0.05));
  const hatchGlow = hPlane(90, 90, glowMat(new THREE.Color('#ff2b3d'), 0.5), 0, 305, 0.052);
  torso.add(hatchGlow);
  const doorL = hPlane(38, 66, M.dark, -19, 305, 0.055), doorR = hPlane(38, 66, M.dark, 19, 305, 0.055);
  torso.add(doorL, doorR);
  const core = new THREE.Mesh(new THREE.CircleGeometry(15, 20), bmat('#ffd27a')); core.position.set(0, 366, 0.055);
  const coreGlow = hPlane(70, 70, glowMat(ROBOT_ORANGE, 0.6), 0, 366, 0.056);
  torso.add(core, coreGlow);
  for (const vx of [-60, 60]) for (let k = 0; k < 3; k++) torso.add(hPlane(22, 4, M.dark, vx, 360 - k * 10, 0.05));
  // Glowing energy lines from the core, and two exhaust stacks on its back.
  for (const sx of [-1, 1]) {
    torso.add(hPlane(5, 124, M.energy, sx * 78, 312, 0.048));
    torso.add(hPlane(63, 5, M.energy, sx * 46.5, 374, 0.048));
    torso.add(hPlane(26, 5, M.energy, sx * 63, 252, 0.048));
  }
  const exhaust = [];
  for (const px of [-64, 64]) {
    torso.add(hPlane(20, 64, M.dark, px, 428, 0.02), hPlane(24, 6, M.stripe, px, 456, 0.021));
    const ex = hPlane(44, 64, glowMat(ROBOT_ORANGE, 0.4), px, 480, 0.019);
    torso.add(ex);
    exhaust.push(ex);
  }
  torso.add(hPlane(30, 20, M.joint, 0, 410, 0.035));
  const head = new THREE.Group();
  head.position.set(0, ROBOT_HIP + 250, 0.06);
  head.add(hPlane(106, 74, M.steel, 0, 0, 0), hPlane(86, 10, M.plate, 0, 41, 0.001), hPlane(84, 32, M.glass, 0, 2, 0.002));
  const eye = new THREE.Mesh(new THREE.CircleGeometry(11, 20), M.eye); eye.position.set(14, 2, 0.003);
  const eyeGlow = hPlane(90, 90, glowMat(new THREE.Color('#ff2b3d'), 0.4), 14, 2, 0.004);
  const ant1 = hPlane(4, 30, M.joint, -32, 50, 0), ant2 = hPlane(4, 22, M.joint, 32, 46, 0);
  head.add(eye, eyeGlow, ant1, ant2);
  const tip = new THREE.Mesh(new THREE.CircleGeometry(5, 12), M.eye); tip.position.set(-32, 66, 0.001);
  const tip2 = new THREE.Mesh(new THREE.CircleGeometry(4, 12), M.eye); tip2.position.set(32, 58, 0.001);
  head.add(tip, tip2);
  const finL = hPoly([[-53, 24], [-53, -22], [-72, 6], [-70, 34]], M.dark, -0.001), finR = hPoly([[53, 24], [53, -22], [72, 6], [70, 34]], M.dark, -0.001);
  head.add(finL, finR);   // side fins
  const crest = hPoly([[-14, 37], [14, 37], [5, 64], [-5, 64]], M.stripe, -0.0005);
  head.add(crest);
  for (let k = 0; k < 5; k++) head.add(hPlane(4, 12, M.joint, -16 + k * 8, -24, 0.002));   // mouth grille
  const ring = new THREE.Mesh(new THREE.RingGeometry(12, 15.5, 24), M.joint); ring.position.set(14, 2, 0.0025);
  const scan = hPlane(3, 28, M.scan, 0, 2, 0.0022);
  head.add(ring, scan);
  // Sensor cluster: two small extra lenses beside the main eye, cheek vents, rivets and grime.
  for (const [lx, ly, r] of [[-12, 8, 4.2], [-25, -4, 3]]) {
    const l = new THREE.Mesh(new THREE.CircleGeometry(r, 12), bmat('#4a1414')); l.position.set(lx, ly, 0.0026);
    const gl = new THREE.Mesh(new THREE.CircleGeometry(r * 0.4, 8), bmat('#ff6a5a')); gl.position.set(lx - r * 0.25, ly + r * 0.25, 0.0027);
    head.add(l, gl);
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) head.add(hPlane(12, 2, M.joint, sx * 43, -26 + k * 5, 0.0015));
  head.add(grime(106, 74, 0, 0, 0.0012));
  rivets(head, [[-48, 32], [48, 32], [-48, -32], [48, -32]], 0.0016);
  // Damage that shows up as it gets shot: cracks, scorch marks, a cracked visor and fires.
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
  const crackMat = bmat('#1a1d2a');
  const cracks = [
    crackLine([[-70, 388], [-50, 360], [-58, 336], [-36, 302], [-44, 280]], 3, crackMat, 0.0465),
    crackLine([[62, 250], [44, 276], [60, 300], [40, 332], [52, 350]], 3, crackMat, 0.0465),
    crackLine([[-20, 246], [-4, 266], [-24, 288], [-10, 300]], 3, crackMat, 0.0465),
  ];
  torso.add(...cracks);
  const visorCrack = crackLine([[-40, 15], [-22, 3], [-28, -6], [-8, -15]], 2, bmat('#9aa3c0'), 0.0024);
  head.add(visorCrack);
  const scorchMat = bmat('#24252c');
  const scorch = [[-50, 272, 14, 1], [70, 350, 12, 2], [28, 384, 16, 3], [-82, 322, 11, 4], [4, 252, 13, 5]].map(([x, y, r, st]) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 14), scorchMat);
    m.position.set(x, y, 0.0467); m.scale.y = 0.8; m.visible = false;
    torso.add(m);
    return { m, st };
  });
  const fires = [[-60, 300, 3], [52, 388, 4], [-88, 250, 5], [72, 270, 5]].map(([x, y, st]) => {
    const m = hPlane(70, 90, glowMat(new THREE.Color('#ff7a1a'), 0.8), x, y + 20, 0.065);
    m.visible = false;
    torso.add(m);
    return { m, st, lx: x, ly: y };
  });
  body.add(head);
  // Arms live in world space so the fists can fly out to where they punch.
  const arms = [];
  for (const side of [-1, 1]) {
    const a = new THREE.Group();
    a.position.z = 0.93 + (side > 0 ? 0.01 : 0);
    const rod = new THREE.Mesh(beamGeo, M.joint); rod.position.z = 0;
    const piston = new THREE.Mesh(beamGeo, M.steel); piston.position.z = 0.002;
    const band = new THREE.Mesh(beamGeo, M.stripe); band.position.z = 0.003;
    const shoulder = new THREE.Mesh(new THREE.CircleGeometry(30, 22), M.dark); shoulder.position.z = 0.004;
    const fist = new THREE.Group();
    fist.position.z = 0.005;
    fist.add(hPlane(58, 54, M.plate, 0, 0, 0), hPlane(12, 58, M.stripe, -26, 0, 0.001));
    for (let k = 0; k < 4; k++) fist.add(hPlane(8, 10, M.dark, 24, -19 + k * 12.6, 0.001));
    for (let k = 0; k < 3; k++) fist.add(hPoly([[29, -25 + k * 20], [29, -15 + k * 20], [43, -20 + k * 20]], M.dark, 0.001));   // knuckle spikes
    const fistGlow = hPlane(110, 110, glowMat(ROBOT_ORANGE, 0), 0, 0, -0.001);
    fist.add(fistGlow);
    fist.add(grime(58, 54, 0, 0, 0.0008));
    const coil = new THREE.Mesh(beamGeo, M.energy); coil.position.z = 0.001;
    const pad = new THREE.Group();
    pad.position.z = 0.006;
    pad.add(hPoly([[-38, -8], [38, -8], [30, 28], [-30, 32]], M.plate, 0), hPlane(60, 6, M.stripe, 0, 14, 0.001));
    for (const px of [-12, 12]) pad.add(hPoly([[px - 5, 28], [px + 5, 28], [px, 46]], M.dark, -0.001));
    a.add(rod, coil, piston, band, shoulder, fist, pad);
    arms.push({ g: a, rod, coil, piston, band, shoulder, fist, fistGlow, pad });
  }
  const dmg = { cracks, visorCrack, scorch, fires, chestPlate, ant1, ant2, finL, finR, crest, tipGone: [false, false] };
  return { g, body, legs, head, eyeGlow, hatchGlow, doorL, doorR, coreGlow, arms, M, base, scan, tips: [tip, tip2], exhaust, dmg };
}
