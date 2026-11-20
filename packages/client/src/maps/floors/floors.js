import * as THREE from 'three';
import { P } from '../../config.js';
import { mulberry32 } from '../../util/math.js';
import { H, level, paintRegion, W } from '../../level/mask.js';
import { glowMat, LAVA_VS, NOISE_GLSL, scene } from '../../render/scene.js';
import { SHIP_RADIUS, ships } from '../../ships/ship.js';
import { addShake, damage, kill } from '../../ships/physics.js';
import { EMBER, FIRE, WHITE } from '../../fx/pools.js';
import { emit } from '../../fx/particles.js';
import { emitSmoke } from '../../fx/smoke.js';
import { rebuildCave } from '../../game/modes.js';

/* ------------------------------------------------------------------ *
 * Floors: a race up two hallways with lava rising behind you
 * ------------------------------------------------------------------ */
const BLOCK_HP = 5;
export const FL = { spec: null, lava: [-60, -60], v: [0, 0], delay: [0, 0], asteroids: [], blocks: [], wrecks: [], halls: [[0, 0], [0, 0]], finish: 1e9, toastTimer: 0 };
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
export function resetLava(i) {
  FL.lava[i] = -60;
  FL.v[i] = P.lavaSpeed;
  FL.delay[i] = P.lavaDelay;
}

export function clearFloors() {
  for (const o of [...FL_GROUP.children]) {
    FL_GROUP.remove(o);
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material && !c.material.userData.shared) c.material.dispose();
    });
  }
  FL.asteroids = []; FL.blocks = []; FL.wrecks = [];
  FL.finish = 1e9;
}
export function stripedPlane(w, h, tileW) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * w / tileW);
  return g;
}
export function buildFloors() {
  clearFloors();
  const sp = FL.spec;
  if (!sp) return;
  FL.halls = sp.halls;
  FL.finish = sp.finish;
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
    FL.blocks.push({ ...b, hp: BLOCK_HP, flash: 0, mesh: m, alive: true });
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
    FL.wrecks.push({ x: w.x, y: w.y, top: w.top, glow, t: Math.random() * 0.5 });
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
    FL.asteroids.push({ ...a, rot: 0, mesh: g });
  }
  for (const [x0, x1] of sp.halls) {   // the finish line
    const m = new THREE.Mesh(stripedPlane(x1 - x0, 14, 56), finishMat);
    m.position.set((x0 + x1) / 2, sp.finish + 7, 0.3);
    FL_GROUP.add(m);
  }
}
export const bulletHitsRock = (x, y) => FL.asteroids.some((a) => (x - a.x) ** 2 + (y - a.y) ** 2 < a.r * a.r);
export function hitBreakable(x, y) {
  for (const b of FL.blocks) {
    if (!b.alive || x < b.x0 - 3 || x > b.x1 + 3 || y < b.y0 - 3 || y > b.y1 + 3) continue;
    b.hp -= 1;
    b.flash = 0.1;
    if (b.hp <= 0) {
      b.alive = false;
      b.mesh.visible = false;
      const m = level.mask;
      for (let yy = Math.floor(b.y0); yy < Math.ceil(b.y1); yy++) {
        const row = (H - 1 - yy) * W;
        for (let xx = Math.floor(b.x0); xx < Math.ceil(b.x1); xx++) m[row + xx] = 0;
      }
      paintRegion(b.x0 - 3, H - b.y1 - 3, b.x1 + 3, H - b.y0 + 3);
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 200;
        emit(b.x0 + Math.random() * (b.x1 - b.x0), (b.y0 + b.y1) / 2, Math.cos(a) * sp, Math.sin(a) * sp, 0.4 + Math.random() * 0.5, i % 3 ? CRATE_BITS : WHITE, 1, 3 + Math.random() * 4);
      }
    }
    return true;
  }
  return false;
}
export function showToast(title, text) {
  const el = document.getElementById('mapToast');
  el.querySelector('.toast-name').textContent = title;
  el.querySelector('.toast-desc').textContent = text;
  el.hidden = false;
  clearTimeout(FL.toastTimer);
  FL.toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}
function floorsWin(s) {
  s.score++;
  showToast(`${s.id === 0 ? 'Player 1' : 'Player 2'} reached the top!`, 'Point scored. The next race starts at the bottom.');
  rebuildCave();
}
export function stepFloors(h) {
  for (let i = 0; i < 2; i++) {
    const s = ships[i];
    if (!s.active) continue;
    if (FL.delay[i] > 0) FL.delay[i] -= h;
    else { FL.v[i] += P.lavaAccel * h; FL.lava[i] = Math.min(H, FL.lava[i] + FL.v[i] * h); }
    s.rockCd = Math.max(0, (s.rockCd || 0) - h);
    const [x0, x1] = FL.halls[i];
    if (FL.lava[i] > 0 && Math.random() < h * 14) {
      emit(x0 + Math.random() * (x1 - x0), FL.lava[i] + 2, (Math.random() - 0.5) * 30, 60 + Math.random() * 90, 0.6 + Math.random() * 0.6, Math.random() < 0.5 ? FIRE : EMBER, -0.1, 3 + Math.random() * 3);
    }
    if (!s.alive) continue;
    if (s.y - 6 * P.shipSize < FL.lava[i]) { kill(s, 'lava'); continue; }
    if (s.y > FL.finish) { floorsWin(s); return; }
  }
  for (const a of FL.asteroids) {
    const [x0, x1] = FL.halls[a.hall];
    a.x += a.vx * h;
    a.rot += a.spin * h;
    if (a.x - a.r < x0) { a.x = x0 + a.r; a.vx = Math.abs(a.vx); }
    if (a.x + a.r > x1) { a.x = x1 - a.r; a.vx = -Math.abs(a.vx); }
    const s = ships[a.hall];
    if (!s.active || !s.alive) continue;
    const dx = s.x - a.x, dy = s.y - a.y, d = Math.hypot(dx, dy), R = a.r + SHIP_RADIUS * P.shipSize * 0.8;
    if (d >= R || d < 1e-6) continue;
    const nx = dx / d, ny = dy / d;
    s.x = a.x + nx * R; s.y = a.y + ny * R;
    const vn = (s.vx - a.vx) * nx + s.vy * ny;
    if (vn < 0) { s.vx -= 1.6 * vn * nx; s.vy -= 1.6 * vn * ny; }
    s.landed = false;
    if (s.rockCd <= 0) {
      s.rockCd = 0.5;
      damage(s, 20);
      addShake(s, 0.6);
      for (let j = 0; j < 8; j++) emit(s.x - nx * SHIP_RADIUS, s.y - ny * SHIP_RADIUS, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, 0.4, j % 2 ? WHITE : EMBER, 0.3);
    }
  }
  for (const b of FL.blocks) if (b.flash > 0) b.flash -= h;
  for (const w of FL.wrecks) {
    w.t -= h;
    if (w.t <= 0) { w.t = 0.3 + Math.random() * 0.4; emitSmoke(w.x + (Math.random() - 0.5) * 16, w.top + 6, (Math.random() - 0.5) * 10, 12 + Math.random() * 12, 1.8 + Math.random(), 6 + Math.random() * 4); }
  }
}
export function drawFloors(now) {
  const on = level.theme === 'floors';
  for (let i = 0; i < 2; i++) {
    const L = lavas[i], [x0, x1] = FL.halls[i];
    L.sheet.visible = L.glow.visible = on && ships[i].active;
    if (!L.sheet.visible) continue;
    const top = FL.lava[i], bottom = -40;
    L.mat.uniforms.uTop.value = top;
    L.mat.uniforms.uTime.value = now / 1000;
    L.sheet.position.set(x0, bottom, 0.9);
    L.sheet.scale.set(x1 - x0, Math.max(1, top - bottom + 12), 1);
    L.glow.position.set(x0, top - 10, 0.88);
    L.glow.scale.set(x1 - x0, 150, 1);
  }
  if (!on) return;
  for (const a of FL.asteroids) { a.mesh.position.set(a.x, a.y, 0.5); a.mesh.rotation.z = a.rot; }
  for (const b of FL.blocks) {
    if (!b.alive) continue;
    const k = (0.45 + 0.55 * b.hp / BLOCK_HP) * (b.flash > 0 ? 1.8 : 1);
    b.mesh.material.color.setRGB(k, k, k);
  }
  for (const w of FL.wrecks) w.glow.material.opacity = 0.35 + 0.25 * Math.sin(now / 90 + w.x);
}
