import * as THREE from 'three';
import { P1HEX, P2HEX } from '../config.js';
import { hexRGB } from '@rocket-duel/shared/math.js';
import { H, onLevel, W } from '@rocket-duel/shared/level/mask.js';
import { field } from './field.js';

/* ------------------------------------------------------------------ *
 * Three.js scene
 * ------------------------------------------------------------------ */
export const stage = document.getElementById('stage');
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

// The sky and terrain shaders run on every pixel, so a big high-DPI canvas costs more GPU time than a
// frame has. Above this many drawn pixels the pixel ratio drops (never below 1) to stay within it.
const PIXEL_BUDGET = 3.3e6;
// Sizes the canvas to w × h CSS pixels, at the screen's pixel ratio or less, within PIXEL_BUDGET.
export function sizeRenderer(w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(Math.max(1, Math.min(dpr, Math.sqrt(PIXEL_BUDGET / (w * h)))));
  renderer.setSize(w, h, false);
}
renderer.setClearColor('#0a0820');
stage.prepend(renderer.domElement);

export const scene = new THREE.Scene();

export const NOISE_GLSL = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v / 0.9375; }
`;
export const srgb3 = (hex) => new THREE.Vector3(...hexRGB(hex).map((v) => v / 255));

/* The map theme's looks (forest, desert, steel) are compile-time switches, not uniforms: both shaders run
 * on every pixel of the screen, and blending in a theme that is off still paid for all its noise.
 * setShaderTheme() recompiles them for the active map (three.js keeps each variant, so switching back is free). */
const THEME_DEFINES = () => ({ FOREST: 0, DESERT: 0, STEEL: 0 });
const THEME_GLSL = `
const float kForest = float(FOREST), kDesert = float(DESERT), kSteel = float(STEEL);
`;

// Sky: a procedural gradient, soft nebula and round twinkling stars, drawn with a little parallax.
// One sky per theme: the desert's dusk, else the forest planet's, else the night sky.
export const skyMat = new THREE.ShaderMaterial({
  defines: THEME_DEFINES(),
  uniforms: { uTime: { value: 0 }, uHalf: { value: new THREE.Vector2(W, H) } },
  vertexShader: `varying vec2 vPos; void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
uniform float uTime; uniform vec2 uHalf; varying vec2 vPos;
${NOISE_GLSL}
float stars(vec2 p, float cell, float density, float sz) {
  vec2 c = floor(p / cell); vec2 f = p - c * cell;
  float h = hash12(c);
  if (h > density) return 0.0;
  vec2 o = (0.2 + 0.6 * hash22(c + 3.7)) * cell;
  float d = length(f - o);
  float r = sz * (0.5 + hash12(c + 9.1));
  float tw = 0.65 + 0.35 * sin(uTime * (0.8 + 2.5 * h / density) + h * 80.0);
  return (smoothstep(r, 0.0, d) + 0.3 * smoothstep(r * 3.0, 0.0, d)) * tw;
}
// Jagged ridge line: summed folded noise gives sharp peaks.
float ridge(float x, float seed) {
  float n = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < 4; i++) { float v = vnoise(vec2(x * f, seed)); n += a * (1.0 - abs(2.0 * v - 1.0)); f *= 2.13; a *= 0.5; }
  return n;
}
void main() {
  float h = clamp(vPos.y / (2.0 * uHalf.y) + 0.5, 0.0, 1.0);
  float st = stars(vPos, 34.0, 0.07, 0.55) + stars(vPos + 50.0, 72.0, 0.20, 0.85);
  vec3 col;
#if DESERT || FOREST
  float n1 = fbm(vPos * 0.0022 + 3.0);
#endif
#if DESERT
  // Dune sea sky: an orange dusk, a big low sun and a ringed planet.
  vec3 dsc = mix(vec3(0.98, 0.56, 0.30), vec3(0.32, 0.14, 0.36), smoothstep(0.15, 0.72, h));
  dsc = mix(dsc, vec3(0.08, 0.05, 0.18), smoothstep(0.7, 1.0, h));
  dsc += vec3(0.95, 0.45, 0.40) * pow(n1, 3.0) * 0.3;
  float ds = length(vPos - vec2(330.0, -170.0));
  dsc += vec3(1.0, 0.72, 0.38) * 0.4 * smoothstep(420.0, 0.0, ds);
  dsc = mix(dsc, vec3(1.0, 0.94, 0.74), smoothstep(84.0, 81.0, ds));
  dsc += vec3(0.86, 0.85, 1.0) * st * smoothstep(0.55, 0.95, h) * 0.8;
  vec2 pp = vPos - vec2(-470.0, 350.0);
  float pu = pp.x * 0.94 + pp.y * 0.34, pv = -pp.x * 0.34 + pp.y * 0.94;
  float rg = length(vec2(pu, pv * 3.6));
  float band = smoothstep(46.0, 49.0, rg) * smoothstep(80.0, 76.0, rg);
  float pl = smoothstep(36.0, 34.0, length(pp));
  vec3 pc = mix(vec3(0.50, 0.70, 0.82), vec3(0.85, 0.95, 1.0), 0.5 + 0.5 * sin(pp.y * 0.35)) * (0.65 + 0.35 * smoothstep(44.0, 0.0, length(pp - vec2(-12.0, 12.0))));
  vec3 ringC = vec3(0.93, 0.80, 0.64);
  dsc = mix(dsc, ringC, band * (1.0 - pl) * 0.85);
  dsc = mix(dsc, pc, pl);
  dsc = mix(dsc, ringC, band * pl * step(pv, 0.0) * 0.85);
  col = dsc;
#elif FOREST
  // Forest planet sky: teal haze and two moons.
  float n2 = fbm(vPos * 0.004 + vec2(11.0, -7.0));
  float dm1 = length(vPos - vec2(-430.0, 320.0)), dm2 = length(vPos - vec2(390.0, 430.0));
  float m1 = smoothstep(64.0, 61.5, dm1), m2 = smoothstep(25.0, 23.0, dm2);
  vec3 fc = mix(vec3(0.04, 0.12, 0.11), vec3(0.19, 0.11, 0.25), h);
  fc += vec3(0.10, 0.30, 0.20) * pow(n1, 3.0) * 0.55 + vec3(0.30, 0.12, 0.30) * pow(n2, 3.5) * 0.4;
  fc += vec3(0.86, 0.92, 0.86) * st * 0.6 * (1.0 - max(m1, m2));
  fc += vec3(0.95, 0.78, 0.55) * 0.10 * smoothstep(200.0, 64.0, dm1);
  vec3 moonA = vec3(0.95, 0.80, 0.60) * (0.78 + 0.22 * fbm((vPos - vec2(-430.0, 320.0)) * 0.045)) * (0.75 + 0.25 * smoothstep(90.0, 0.0, length(vPos - vec2(-455.0, 345.0))));
  fc = mix(fc, moonA, m1);
  fc = mix(fc, vec3(0.62, 0.88, 0.86), m2);
  col = fc;
#else
  float yN = vPos.y / uHalf.y;
  float aa = max(fwidth(vPos.y), 0.5);
  // Night gradient: deep indigo overhead, warming to violet and magenta towards the horizon.
  col = mix(vec3(0.17, 0.045, 0.21), vec3(0.035, 0.028, 0.10), smoothstep(0.12, 0.62, h));
  col = mix(col, vec3(0.010, 0.014, 0.045), smoothstep(0.62, 1.0, h));
  // Horizon glow behind the far range: wide magenta haze around a small hot gold core.
  float gd = length(vec2(vPos.x * 0.5, vPos.y + 0.30 * uHalf.y)) / uHalf.y;
  vec3 glow = vec3(0.60, 0.13, 0.40) * exp(-gd * 2.6) * 0.6 + vec3(1.0, 0.66, 0.32) * exp(-gd * 8.0) * 0.5;
  col += glow;
  // Stars: sparse and small, fading out near the glowing horizon.
  float stSky = st * smoothstep(-0.45, 0.15, yN);
  // Long, low cloud banks: dark bodies with faint magenta underlight.
  float cl = fbm(vec2(vPos.x * 0.0015 + uTime * 0.003, vPos.y * 0.0085) + vec2(5.0, 2.0));
  float bank = smoothstep(0.56, 0.80, cl) * smoothstep(-0.55, -0.1, yN) * (1.0 - smoothstep(0.35, 0.7, yN));
  col += vec3(0.86, 0.85, 1.0) * stSky * (1.0 - bank);
  col = mix(col, vec3(0.045, 0.028, 0.085) + glow * 0.25, bank * 0.8);
  col += vec3(0.55, 0.16, 0.38) * (smoothstep(0.50, 0.58, cl) - smoothstep(0.58, 0.72, cl)) * 0.22 * smoothstep(-0.55, -0.1, yN);
  // Far range: hazy silhouettes, lit on faces turned towards the glow, with a thin hot rim.
  float x = vPos.x;
  float r1 = (-0.33 + 0.30 * ridge(x * 0.0034, 4.0)) * uHalf.y;
  float d1 = (ridge((x + 4.0) * 0.0034, 4.0) - ridge((x - 4.0) * 0.0034, 4.0)) * uHalf.y;
  float in1 = smoothstep(r1 + aa, r1 - aa, vPos.y);
  float below1 = max(r1 - vPos.y, 0.0);
  float face1 = smoothstep(0.0, 6.0, -d1 * sign(x + 1e-3));
  float streak1 = 0.6 + 0.4 * vnoise(vec2(x * 0.045 + vPos.y * 0.03, vPos.y * 0.006));
  vec3 mtn1 = vec3(0.085, 0.035, 0.12) + glow * 0.35;
  mtn1 += vec3(0.85, 0.28, 0.36) * face1 * streak1 * exp(-below1 / (0.05 * uHalf.y)) * exp(-abs(x) / (0.9 * uHalf.x)) * 0.45;
  mtn1 += vec3(1.0, 0.50, 0.45) * exp(-below1 / 2.5) * exp(-abs(x) / (0.7 * uHalf.x)) * 0.5;
  col = mix(col, mtn1, in1);
  // Mist pooling in the valleys.
  float mist = smoothstep(-0.62, -0.32, yN) * (1.0 - smoothstep(-0.32, -0.12, yN)) * (0.5 + 0.5 * fbm(vec2(vPos.x * 0.003 + uTime * 0.006, vPos.y * 0.012)));
  col += vec3(0.30, 0.09, 0.26) * mist * 0.35;
  // Near range: almost black, with a faint violet edge.
  float r2 = (-0.50 + 0.32 * ridge(x * 0.0058 + 9.0, 13.0)) * uHalf.y;
  float in2 = smoothstep(r2 + aa, r2 - aa, vPos.y);
  vec3 mtn2 = vec3(0.028, 0.018, 0.055) + vec3(0.40, 0.12, 0.34) * exp(-max(r2 - vPos.y, 0.0) / 2.0) * 0.35;
  col = mix(col, mtn2, in2);
#endif
  // Film grain.
  col += (hash12(floor(vPos * 1.4)) - 0.5) * 0.035;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`,
  depthWrite: false,
});
export const skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H * 2), skyMat);
skyMesh.position.set(W / 2, H / 2, -1);
skyMesh.frustumCulled = false;
scene.add(skyMesh);

// Terrain: smooth walls from the softened field, with soft lighting, depth shading, cast shadows and glowing pads.
field.tex = new THREE.DataTexture(field.data, W, H, THREE.RGFormat, THREE.UnsignedByteType);
field.tex.magFilter = THREE.LinearFilter;
field.tex.minFilter = THREE.LinearMipmapLinearFilter;
field.tex.generateMipmaps = true;
field.tex.unpackAlignment = 1;
export const levelMat = new THREE.ShaderMaterial({
  defines: THEME_DEFINES(),
  uniforms: {
    uField: { value: field.tex },
    uSize: { value: new THREE.Vector2(W, H) },
    uP1: { value: srgb3(P1HEX) },
    uP2: { value: srgb3(P2HEX) },
    uLights: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },   // (x, y, strength): see lights.js
    uLightN: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
uniform sampler2D uField; uniform vec2 uSize; uniform vec3 uP1; uniform vec3 uP2;
uniform vec3 uLights[8]; uniform int uLightN;
varying vec2 vUv;
${NOISE_GLSL}
${THEME_GLSL}
vec3 rock(float y) {
  float t = 0.5 + 0.5 * sin(y * 6.2831853 / 520.0 + 0.7);
  float f = t * 3.0;
  vec3 a = mix(vec3(16.0, 11.0, 30.0) / 255.0, vec3(26.0, 15.0, 42.0) / 255.0, clamp(f, 0.0, 1.0));
  a = mix(a, vec3(42.0, 20.0, 56.0) / 255.0, clamp(f - 1.0, 0.0, 1.0));
  return mix(a, vec3(64.0, 28.0, 66.0) / 255.0, clamp(f - 2.0, 0.0, 1.0));
}
float L(vec2 uv, float lod) { return textureLod(uField, uv, lod).r; }
void main() {
  vec2 tx = 1.0 / uSize;
  vec2 px = vUv * uSize;
  vec4 t = texture2D(uField, vUv);
  float s = t.r;
  float aa = max(fwidth(s) * 0.75, 0.002);
  float cover = smoothstep(0.5 - aa, 0.5 + aa, s);
  vec3 padCol = px.x < uSize.x * 0.5 ? uP1 : uP2;

  // Outside the rock: soft shadow on the sky, and light rising from the pads.
  float oa = L(vUv + vec2(-5.0, 7.0) * tx, 3.0) * 0.55;
  float ga = clamp(textureLod(uField, vUv - vec2(0.0, 14.0) * tx, 4.5).g * 1.6, 0.0, 1.0) * 0.4;
  float outA = oa + ga - oa * ga;
  vec3 outC = (vec3(0.02, 0.01, 0.06) * oa * (1.0 - ga) + padCol * ga) / max(outA, 1e-4);

  // Inside: surface direction, a lit rim, a fine edge line and darker depths.
  vec2 dx = vec2(3.0, 0.0) * tx, dy = vec2(0.0, 3.0) * tx;
  vec2 g = vec2(L(vUv + dx, 2.0) - L(vUv - dx, 2.0), L(vUv + dy, 2.0) - L(vUv - dy, 2.0));
  vec2 nOut = -g / (length(g) + 1e-3);
  float lit = dot(nOut, normalize(vec2(-0.45, 1.0)));
  float rim = 1.0 - smoothstep(0.55, 0.98, L(vUv, 2.0));
  float lip = 1.0 - smoothstep(0.5, 0.9, s);
  float deep = smoothstep(0.55, 1.0, L(vUv, 5.0));

  vec3 col = rock(px.y);
  // Painterly brush strokes running down the slopes, and fine grain.
  vec2 bp = mat2(0.80, -0.60, 0.60, 0.80) * px;
  float stroke = vnoise(bp * vec2(0.012, 0.10)) * 0.6 + vnoise(bp * vec2(0.035, 0.32)) * 0.4;
  float brush = smoothstep(0.32, 0.78, stroke);
  float grain = hash12(floor(px * 1.5)) - 0.5;
#if FOREST
  col = mix(vec3(0.17, 0.12, 0.09), vec3(0.28, 0.20, 0.13), 0.5 + 0.5 * sin(px.y * 0.05));   // soil
#endif
#if DESERT
  col = mix(vec3(0.80, 0.58, 0.36), vec3(0.62, 0.38, 0.25), 0.5 + 0.5 * sin(px.y * 0.07 + 3.0 * fbm(px * 0.012)));   // sand
#endif
#if STEEL
  vec2 q = abs(fract(px / 64.0) - 0.5) * 64.0;
  float seam = smoothstep(29.5, 31.0, max(q.x, q.y));
  col = vec3(0.24, 0.26, 0.34) * (0.88 + 0.12 * fbm(px * 0.02)) * (1.0 - 0.4 * seam);
#endif
#if DESERT
  col *= 0.8 + 0.32 * fbm(px * 0.035) + 0.06 * vnoise(px * 0.18);
#else
  col *= 0.76 + 0.26 * fbm(px * 0.02) + 0.18 * stroke;
#endif
  col *= mix(1.0, mix(0.34, 0.5, kDesert), deep);
  vec3 warm = mix(vec3(0.92, 0.32, 0.40), vec3(0.45, 0.86, 0.36), kForest), hot = mix(vec3(1.0, 0.68, 0.44), vec3(0.75, 0.95, 0.55), kForest), cool = vec3(0.16, 0.12, 0.40);
  warm = mix(warm, vec3(1.0, 0.86, 0.58), kDesert); hot = mix(hot, vec3(1.0, 0.94, 0.76), kDesert);
  float litK = max(lit, 0.0);
  col = mix(col, warm * (0.4 + 0.6 * brush), rim * litK * (0.3 + 0.6 * brush));
  col = mix(col, col * 0.5 + cool * 0.1, rim * max(-lit, 0.0) * 0.75);
  col += mix(warm, hot, litK * litK) * lip * litK * 0.75 + cool * lip * max(-lit, 0.0) * 0.12;
  col = mix(col, vec3(0.20, 0.52, 0.22), kForest * rim * smoothstep(0.2, 0.8, lit) * 0.7);
  col = mix(col, vec3(0.96, 0.82, 0.58), kDesert * rim * smoothstep(0.2, 0.8, lit) * 0.6);

  // Point lights (a frag grenade, blast flashes): warm light on the rock faces turned towards them, and a soft glow in the air.
  float lt = 0.0, glow = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uLightN) break;
    vec3 Lp = uLights[i];
    vec2 to = Lp.xy - px;
    float d2 = dot(to, to);
    float face = max(dot(nOut, to * inversesqrt(d2 + 1.0)), 0.0);
    lt += Lp.z * exp(-d2 / 19000.0) * (0.2 + 0.8 * face * rim) * (1.0 - 0.75 * deep);
    glow += Lp.z * exp(-d2 / 2600.0);
  }
  vec3 lightCol = vec3(1.0, 0.82, 0.48);
  col += lightCol * lt * 0.85;

  float de = min(min(px.x, uSize.x - px.x), min(px.y, uSize.y - px.y));
  float frame = 1.0 - smoothstep(15.0, 17.0, de);
  vec3 fc = vec3(0.05, 0.035, 0.09) * (0.92 + 0.08 * sin((px.x + px.y) * 0.25));
  fc += warm * lip * max(lit, 0.0) * 0.3;
  col = mix(col, fc, frame);

  float pad = smoothstep(0.3, 0.6, t.g);
  vec3 pc = padCol * (0.62 + 0.45 * rim * max(lit, 0.0)) + padCol * lip * 0.5;
  pc = mix(pc, vec3(1.0), lip * max(lit, 0.0) * 0.4);
  col = mix(col, pc, pad);
  col += grain * 0.04 * (1.0 - pad);

  float gA = clamp(glow, 0.0, 1.0) * 0.28;
  float oA = outA + gA - outA * gA;
  outC = (outC * outA * (1.0 - gA) + lightCol * gA) / max(oA, 1e-4);
  gl_FragColor = vec4(mix(outC, col, cover), mix(oA, 1.0, cover));
}`,
  transparent: true,
  depthWrite: false,
});
// Compiles the sky and terrain shaders for a map theme's switches ({ forest, desert, steel }, each 0 or 1).
export function setShaderTheme(sh) {
  const d = { FOREST: sh.forest ? 1 : 0, DESERT: sh.desert ? 1 : 0, STEEL: sh.steel ? 1 : 0 };
  for (const m of [skyMat, levelMat]) {
    if (Object.keys(d).every((k) => m.defines[k] === d[k])) continue;
    Object.assign(m.defines, d);
    m.needsUpdate = true;
  }
}
const levelMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), levelMat);
levelMesh.position.set(W / 2, H / 2, 0);
scene.add(levelMesh);

// Practice grid: faint lines every 50 units, stronger every 250, so speed and drift read in empty space.
const gridMat = new THREE.ShaderMaterial({
  vertexShader: `varying vec2 vPos; void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
varying vec2 vPos;
float lineAt(vec2 p, float cell) {
  vec2 g = abs(fract(p / cell - 0.5) - 0.5) * cell;
  vec2 l = 1.0 - smoothstep(vec2(0.0), fwidth(p) * 1.2, g);
  return max(l.x, l.y);
}
void main() {
  float a = lineAt(vPos, 50.0) * 0.07 + lineAt(vPos, 250.0) * 0.16;
  gl_FragColor = vec4(vec3(0.75, 0.72, 1.0), a);
}`,
  transparent: true,
  depthWrite: false,
});
export const gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), gridMat);
gridMesh.position.set(W / 2, H / 2, -0.5);
gridMesh.visible = false;
scene.add(gridMesh);

// When a map changes the world size, rebuild everything that was sized to it.
function worldResized() {
  field.tex.dispose();
  field.tex = new THREE.DataTexture(field.data, W, H, THREE.RGFormat, THREE.UnsignedByteType);
  field.tex.magFilter = THREE.LinearFilter;
  field.tex.minFilter = THREE.LinearMipmapLinearFilter;
  field.tex.generateMipmaps = true;
  field.tex.unpackAlignment = 1;
  levelMat.uniforms.uField.value = field.tex;
  levelMat.uniforms.uSize.value.set(W, H);
  skyMat.uniforms.uHalf.value.set(W, H);
  for (const [mesh, sx, sy] of [[levelMesh, 1, 1], [skyMesh, 2, 2], [gridMesh, 1, 1]]) {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(W * sx, H * sy);
    mesh.position.x = W / 2; mesh.position.y = H / 2;
  }
}
onLevel('resized', worldResized);

// Sends the terrain rows that changed to the GPU. The field is megabytes, and a shot only digs a few
// rows: uploading it whole on every hit stalls the frame. (Not renderer.copyTextureToTexture: it reads
// GL state back with getParameter, and that stalls too.)
export function uploadField() {
  if (!field.dirty) return;
  if (field.full) { field.tex.needsUpdate = true; field.full = false; }
  else {
    const gl = renderer.getContext(), { state } = renderer;
    renderer.initTexture(field.tex);   // makes sure the whole texture is on the GPU first
    state.bindTexture(gl.TEXTURE_2D, renderer.properties.get(field.tex).__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, field.lo, W, field.hi - field.lo + 1, gl.RG, gl.UNSIGNED_BYTE, field.data, field.lo * W * 2);
    gl.generateMipmap(gl.TEXTURE_2D);
    state.unbindTexture();
  }
  field.dirty = false; field.lo = H; field.hi = -1;
}

// A soft round glow, reused for ship auras and engine flames.
const glowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
export const glowMat = (color, opacity) => new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

export const LAVA_VS = `varying vec2 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xy; gl_Position = projectionMatrix * viewMatrix * w; }`;
