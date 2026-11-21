import * as THREE from 'three';
import { mulberry32 } from '@rocket-duel/shared/math.js';
import { level } from '@rocket-duel/shared/level/mask.js';
import { onSim } from '@rocket-duel/shared/events.js';
import { BLOCK_HP, FL } from '@rocket-duel/shared/maps/floors.js';
import { glowMat, LAVA_VS, NOISE_GLSL, scene } from '../../render/scene.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { EMBER, FIRE, WHITE } from '../../fx/pools.js';
import { emit, PT } from '../../fx/particles.js';
import { DB } from '../../fx/debris.js';
import { emitSmoke } from '../../fx/smoke.js';

/* ------------------------------------------------------------------ *
 * Floors as drawn: girders, crates, wrecks, asteroids, the finish line and the lava. The race itself
 * (lava, asteroids, blocks, scoring) runs in @rocket-duel/shared/maps/floors.js; these meshes follow FL.
 * ------------------------------------------------------------------ */
// Meshes by index into FL.blocks and FL.asteroids; wrecks are looks only (their smoke and glow).
const looks = { blocks: [], asteroids: [], wrecks: [] };
let toastTimer = 0;
const FL_GROUP = new THREE.Group();
scene.add(FL_GROUP);
export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
const hazardTex = canvasTex(64, 32, (g) => {
  g.fillStyle = '#1d1a2c'; g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#ffcc33';
  for (let x = -32; x < 96; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 48, 0); g.lineTo(x + 32, 0); g.closePath(); g.fill(); }
});
const crateTex = canvasTex(64, 32, (g) => {
  g.fillStyle = '#ffb347'; g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#c4441a'; g.fillRect(4, 4, 56, 24);
  g.strokeStyle = '#7a2408'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(6, 6); g.lineTo(58, 26); g.moveTo(58, 6); g.lineTo(6, 26); g.stroke();
  g.fillStyle = '#ffe2a8';
  for (const [x, y] of [[7, 7], [57, 7], [7, 25], [57, 25]]) { g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill(); }
});
const finishTex = canvasTex(32, 8, (g) => {
  for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#ffffff' : '#1d1a2c'; g.fillRect(i * 4, j * 4, 4, 4); }
});
const sharedMat = (o) => { const m = new THREE.MeshBasicMaterial(o); m.userData.shared = true; return m; };
export const girderMat = sharedMat({ map: hazardTex }), lipMat = sharedMat({ color: '#8a8fb0' }), finishMat = sharedMat({ map: finishTex });
const wreckMat = sharedMat({ color: '#5d6178', side: THREE.DoubleSide }), wreckDarkMat = sharedMat({ color: '#45485c', side: THREE.DoubleSide });
const rockMat = sharedMat({ color: '#7d6b5d', side: THREE.DoubleSide }), craterMat = sharedMat({ color: '#5c4e44' });
const CRATE_BITS = new THREE.Color('#ff8a3d');

// Lava: one animated sheet per hallway, with a glow above its surface.

function makeLava() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTop: { value: 0 } },
    vertexShader: LAVA_VS,
    fragmentShader: `
uniform float uTime; uniform float uTop; varying vec2 vW;
${NOISE_GLSL}
void main() {
  float top = uTop + 5.0 * sin(vW.x * 0.045 + uTime * 2.2) + 3.0 * sin(vW.x * 0.11 - uTime * 3.1);
  float d = top - vW.y;
  if (d < 0.0) discard;
  float n = fbm(vW * 0.018 + vec2(0.0, -uTime * 0.35));
  float n2 = fbm(vW * 0.05 + vec2(uTime * 0.25, uTime * 0.1));
  vec3 col = mix(vec3(0.50, 0.04, 0.02), vec3(1.0, 0.42, 0.05), smoothstep(0.3, 0.75, n));
  col = mix(col, vec3(1.0, 0.86, 0.35), smoothstep(0.68, 0.92, n2) * 0.8);
  col *= mix(1.0, 0.55, smoothstep(0.0, 360.0, d));
  col = mix(col, vec3(1.0, 0.93, 0.6), smoothstep(10.0, 0.0, d) * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`,
  });
  const glowM = new THREE.ShaderMaterial({
    uniforms: { uTop: mat.uniforms.uTop },
    vertexShader: LAVA_VS,
    fragmentShader: `uniform float uTop; varying vec2 vW;
void main() { float t = clamp((vW.y - uTop) / 140.0, 0.0, 1.0); float a = (1.0 - t) * (1.0 - t) * 0.55; gl_FragColor = vec4(vec3(1.0, 0.45, 0.1) * a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0.5, 0.5, 0);
  const sheet = new THREE.Mesh(geo, mat), glow = new THREE.Mesh(geo, glowM);
  sheet.frustumCulled = glow.frustumCulled = false;
  sheet.visible = glow.visible = false;
  scene.add(sheet, glow);
  return { sheet, glow, mat };
}
const lavas = [makeLava(), makeLava()];
export function clearFloors() {
  for (const o of [...FL_GROUP.children]) {
    FL_GROUP.remove(o);
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material && !c.material.userData.shared) c.material.dispose();
    });
  }
  looks.blocks = []; looks.asteroids = []; looks.wrecks = [];
}
export function stripedPlane(w, h, tileW) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * w / tileW);
  return g;
}
// The meshes for the level just built (after floorsRules.start(), so FL matches level.spec).
export function buildFloors() {
  clearFloors();
  const sp = level.spec;
  if (!sp) return;
  for (const L of sp.ledges) {   // barriers to dodge: steel girders with hazard stripes
    const w = L.x1 - L.x0, h = L.y1 - L.y0;
    const m = new THREE.Mesh(stripedPlane(w, h, 2 * h), girderMat);
    m.position.set((L.x0 + L.x1) / 2, (L.y0 + L.y1) / 2, 0.3);
    const lip = new THREE.Mesh(new THREE.PlaneGeometry(w, 3), lipMat);
    lip.position.set(m.position.x, L.y1 - 1.5, 0.31);
    FL_GROUP.add(m, lip);
  }
  for (const b of sp.blocks) {   // barriers to shoot: orange crates
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.x1 - b.x0, b.y1 - b.y0), new THREE.MeshBasicMaterial({ map: crateTex }));
    m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0.35);
    FL_GROUP.add(m);
    looks.blocks.push({ mesh: m, flash: 0 });
  }
  for (const w of sp.wrecks) {   // wrecks of other ships, still smouldering
    for (const p of w.pieces) {
      const s = new THREE.Shape();
      p.pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(s), p.shade ? wreckDarkMat : wreckMat);
      m.position.z = 0.3;
      FL_GROUP.add(m);
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), glowMat(new THREE.Color('#ff7a2e'), 0.5));
    glow.position.set(w.x, w.y, 0.32);
    FL_GROUP.add(glow);
    looks.wrecks.push({ x: w.x, y: w.y, top: w.top, glow, t: Math.random() * 0.5 });
  }
  for (const a of sp.asteroids) {   // asteroids drifting across the hallway
    const R = mulberry32(a.seed), s = new THREE.Shape();
    for (let i = 0; i < 11; i++) {
      const ang = i / 11 * Math.PI * 2, rr = a.r * (0.78 + 0.3 * R());
      if (i) s.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); else s.moveTo(rr, 0);
    }
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.ShapeGeometry(s), rockMat));
    for (let j = 0; j < 3; j++) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(a.r * (0.12 + 0.1 * R()), 10), craterMat);
      c.position.set((R() - 0.5) * a.r, (R() - 0.5) * a.r, 0.01);
      g.add(c);
    }
    g.position.set(a.x, a.y, 0.5);
    FL_GROUP.add(g);
    looks.asteroids.push(g);
  }
  for (const [x0, x1] of sp.halls) {   // the finish line
    const m = new THREE.Mesh(stripedPlane(x1 - x0, 14, 56), finishMat);
    m.position.set((x0 + x1) / 2, sp.finish + 7, 0.3);
    FL_GROUP.add(m);
  }
}
export function showToast(title, text) {
  const el = document.getElementById('mapToast');
  el.querySelector('.toast-name').textContent = title;
  el.querySelector('.toast-desc').textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

// What the shared rules report (online, replayed from the server's events).
onSim('blockHit', (i) => { if (looks.blocks[i]) looks.blocks[i].flash = 0.1; });
onSim('blockBroken', (i) => {
  const b = FL.blocks[i];
  if (!b) return;
  for (let k = 0; k < 24; k++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 200;
    emit(b.x0 + Math.random() * (b.x1 - b.x0), (b.y0 + b.y1) / 2, Math.cos(a) * sp, Math.sin(a) * sp, 0.4 + Math.random() * 0.5, k % 3 ? CRATE_BITS : WHITE, 1, 3 + Math.random() * 4);
  }
});
onSim('asteroidHit', (s, x, y) => {
  for (let j = 0; j < 8; j++) emit(x, y, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, 0.4, j % 2 ? WHITE : EMBER, 0.3);
});
onSim('floorsWon', (s) => {
  showToast(`${s.id === 0 ? 'Player 1' : 'Player 2'} reached the top!`, 'Point scored. The next race starts at the bottom.');
  PT.on.fill(0); DB.on.fill(0);   // a fresh start, as a rebuilt map gets
});

// Per-step looks: embers off the lava, crate hit flashes, wreck smoke.
export function floorLooks(h) {
  for (let i = 0; i < 2; i++) {
    const [x0, x1] = FL.halls[i];
    if (!ships[i].active || FL.lava[i] <= 0 || Math.random() >= h * 14) continue;
    emit(x0 + Math.random() * (x1 - x0), FL.lava[i] + 2, (Math.random() - 0.5) * 30, 60 + Math.random() * 90, 0.6 + Math.random() * 0.6, Math.random() < 0.5 ? FIRE : EMBER, -0.1, 3 + Math.random() * 3);
  }
  for (const b of looks.blocks) if (b.flash > 0) b.flash -= h;
  for (const w of looks.wrecks) {
    w.t -= h;
    if (w.t <= 0) { w.t = 0.3 + Math.random() * 0.4; emitSmoke(w.x + (Math.random() - 0.5) * 16, w.top + 6, (Math.random() - 0.5) * 10, 12 + Math.random() * 12, 1.8 + Math.random(), 6 + Math.random() * 4); }
  }
}
// alpha: how far between the last two steps (online: snapshots) to draw the lava and asteroids.
export function drawFloors(now, alpha = 1) {
  const on = level.theme === 'floors';
  for (let i = 0; i < 2; i++) {
    const L = lavas[i], [x0, x1] = FL.halls[i];
    L.sheet.visible = L.glow.visible = on && ships[i].active;
    if (!L.sheet.visible) continue;
    const top = FL.plava[i] + (FL.lava[i] - FL.plava[i]) * alpha, bottom = -40;
    L.mat.uniforms.uTop.value = top;
    L.mat.uniforms.uTime.value = now / 1000;
    L.sheet.position.set(x0, bottom, 0.9);
    L.sheet.scale.set(x1 - x0, Math.max(1, top - bottom + 12), 1);
    L.glow.position.set(x0, top - 10, 0.88);
    L.glow.scale.set(x1 - x0, 150, 1);
  }
  if (!on) return;
  FL.asteroids.forEach((a, k) => {
    const g = looks.asteroids[k];
    if (!g) return;
    g.position.set(a.px + (a.x - a.px) * alpha, a.y, 0.5);
    g.rotation.z = a.prot + (a.rot - a.prot) * alpha;
  });
  FL.blocks.forEach((b, k) => {
    const L = looks.blocks[k];
    if (!L) return;
    L.mesh.visible = b.alive;
    if (!b.alive) return;
    const v = (0.45 + 0.55 * b.hp / BLOCK_HP) * (L.flash > 0 ? 1.8 : 1);
    L.mesh.material.color.setRGB(v, v, v);
  });
  for (const w of looks.wrecks) w.glow.material.opacity = 0.35 + 0.25 * Math.sin(now / 90 + w.x);
}
