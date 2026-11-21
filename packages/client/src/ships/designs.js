import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Ship designs: how a ship's hull looks. Each player picks one on the start screen, next to their colour.
 * Looks only: every design must fit inside the collision hull (HULL in shared ships/ship.js: nose at
 * y = 12, fins out to ±8 at y = -8), so the choice never changes gameplay.
 *
 * A design is { id, name, nozzles, flameY, build(hex), svg(hex) }:
 *   nozzles   [[x, y], ...] in ship space, where exhaust sparks come out (one is picked at random).
 *   flameY    where the glow flame starts.
 *   build     returns a THREE.Group whose userData.setColor(hex) recolours it to a player's colour.
 *   svg       the same ship as a small SVG for the start screen (viewBox -10 -14 20 34, y down).
 * This module only uses Three.js, so the preview page (rocket-preview.html) imports it too.
 * ------------------------------------------------------------------ */

const hexRGB = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const shadeHex = (hex, f) => '#' + hexRGB(hex).map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('');

/* ---------------- polygon helpers ---------------- */
const mirror = (pts) => pts.map(([x, y]) => [-x, y]).reverse();
const ellipse = (cx, cy, rx, ry, n = 28) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
function dedupe(pts) { return pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4; }); }
// A closed, left-right symmetric polygon from a half width x(t), t = 0..1 running from y0 to y1.
function profile(y0, y1, fx, n = 16) {
  const r = [];
  for (let i = 0; i <= n; i++) { const t = i / n; r.push([Math.max(fx(t), 0), y0 + (y1 - y0) * t]); }
  const right = r.filter(([x], i) => x > 1e-4 || i === 0 || i === n);
  return dedupe([...right, ...mirror(right).filter(([x]) => x < -1e-4)]);
}
function area(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
const ccw = (pts) => (area(pts) < 0 ? [...pts].reverse() : pts);
function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
// Grows a simple polygon outwards by d (mitred corners, the miter clamped so sharp tips stay short).
function offset(pts, d) {
  pts = ccw(pts);
  const n = pts.length;
  return pts.map((b, i) => {
    const a = pts[(i - 1 + n) % n], c = pts[(i + 1) % n];
    const e1 = norm([b[0] - a[0], b[1] - a[1]]), e2 = norm([c[0] - b[0], c[1] - b[1]]);
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    const m = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const len = d / Math.max(m[0] * n1[0] + m[1] * n1[1], 0.35);
    return [b[0] + m[0] * len, b[1] + m[1] * len];
  });
}
// The part of a polygon with x >= cut (Sutherland–Hodgman against one line).
function clipRight(pts, cut = 0) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], pin = p[0] >= cut, qin = q[0] >= cut;
    if (pin) out.push(p);
    if (pin !== qin) { const t = (cut - p[0]) / (q[0] - p[0]); out.push([cut, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
function polyGeo(pts) {
  pts = ccw(pts);
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}
const svgPath = (pts, fill, extra = '') => `<path d="M${pts.map(([x, y]) => `${+x.toFixed(2)} ${+(-y).toFixed(2)}`).join('L')}Z" fill="${fill}"${extra}/>`;

/* ---------------- flat cartoon parts ----------------
 * A part list is drawn in order. Each part draws its dark outline just beneath itself, so the seams between
 * parts get the line too (the cel look). Part fields:
 *   pts      the polygon, ship space (y up)
 *   fill     'white' | 'accent' (the player's colour) | 'accentS' (its shade) | 'metal' | 'glass' | 'glint'
 *   shade    false to skip the darker half laid over x > cut (cut defaults to 0, the centre line)
 *   outline  false to skip the outline; ow its width
 */
const TOON = { outline: '#2a1838', white: '#f6f3ec', whiteS: '#c3cfdb', metal: '#8f9aab', metalS: '#5f6878', glass: '#9fe2f2', glassS: '#4fa9c4', glint: '#ffffff', ink: '#2f3a4b' };
const ACCENT_SHADE = 0.62, OUTLINE_W = 0.55, Z_STEP = 0.0004;   // the whole hull stays under z 0.02, below the shield and frost

function toonColors(hex) {
  return { ...TOON, accent: hex, accentS: shadeHex(hex, ACCENT_SHADE) };
}
const SHADED = new Set(['white', 'accent', 'metal', 'glass']);   // fills that have a darker half
// Each layer: [polygon, colour key].
function toonLayers(parts) {
  const layers = [];
  for (const p of parts) {
    if (p.outline !== false) layers.push([offset(p.pts, p.ow ?? OUTLINE_W), 'outline']);
    const key = p.fill ?? 'white';
    layers.push([p.pts, key]);
    if (p.shade !== false && SHADED.has(key)) {
      const half = clipRight(ccw(p.pts), p.cut ?? 0);
      if (half.length > 2) layers.push([half, key + 'S']);
    }
  }
  return layers;
}
function buildToon(layers, hex) {
  const g = new THREE.Group();
  const cols = toonColors(hex), mats = {};
  for (const k of Object.keys(cols)) mats[k] = new THREE.MeshBasicMaterial(k === 'glint' ? { color: cols[k], transparent: true, opacity: 0.85 } : { color: cols[k] });
  layers.forEach(([pts, key], i) => {
    const m = new THREE.Mesh(polyGeo(pts), mats[key]);
    m.position.z = i * Z_STEP;
    g.add(m);
  });
  g.userData.setColor = (h) => { mats.accent.color.set(h); mats.accentS.color.set(h).multiplyScalar(ACCENT_SHADE); };
  return g;
}
// dy moves the drawing down the icon, for a hull whose nose would poke out of the top.
function toonSVG(layers, hex, flames, dy = 0) {
  const cols = toonColors(hex);
  return `<svg viewBox="-10 -14 20 34" aria-hidden="true"><g transform="translate(0 ${dy})">${flames}${layers.map(([pts, key]) => svgPath(pts, cols[key], key === 'glint' ? ' opacity="0.85"' : '')).join('')}</g></svg>`;
}
// A small flat flame for the SVGs, its top at (x, y) in ship space.
const svgFlame = (x, y, w) => {
  const t = -y;
  return `<path d="M${x - w} ${t}L${x} ${t + w * 3.4}L${x + w} ${t}Z" fill="#ff8f3d"/><path d="M${x - w * 0.45} ${t}L${x} ${t + w * 1.7}L${x + w * 0.45} ${t}Z" fill="#fff1c2"/>`;
};

/* ---------------- Dart ---------------- */
const DART_NOZZLES = [[-1.15, -7.3], [1.15, -7.3]];
const DART_PARTS = [
  // swept delta fins, white with a colour leading edge
  { pts: [[-2.2, 2.2], [-7.9, -7.2], [-7.9, -8.8], [-2.2, -5.6]] },
  { pts: [[2.2, 2.2], [2.2, -5.6], [7.9, -8.8], [7.9, -7.2]] },
  { pts: [[-2.2, 2.2], [-7.9, -7.2], [-7.9, -8.1], [-2.2, 0.6]], fill: 'accent', shade: false, outline: false },
  { pts: [[2.2, 2.2], [2.2, 0.6], [7.9, -8.1], [7.9, -7.2]], fill: 'accentS', shade: false, outline: false },
  // canards
  { pts: [[-2.2, 5.6], [-3.9, 3.0], [-3.9, 2.3], [-2.2, 3.1]] },
  { pts: [[2.2, 5.6], [2.2, 3.1], [3.9, 2.3], [3.9, 3.0]] },
  // twin nozzles
  ...DART_NOZZLES.map(([x]) => ({ pts: [[x - 0.85, -5.7], [x + 0.85, -5.7], [x + 1.1, -7.3], [x - 1.1, -7.3]], fill: 'metal', cut: x })),
  // body, nose and its colour tip
  { pts: profile(-6, 5, (t) => 2.25 + Math.sin(t * Math.PI) * 0.25) },
  { pts: profile(5, 13, (t) => 2.25 * Math.pow(Math.cos(t * Math.PI / 2), 0.62), 18) },
  { pts: profile(10.6, 13, (t) => 2.25 * Math.pow(Math.cos((0.7 + t * 0.3) * Math.PI / 2), 0.62), 10), fill: 'accent' },
  // racing stripe, window and its glint
  { pts: [[-0.75, -6], [0.75, -6], [0.75, 4.6], [-0.75, 4.6]], fill: 'accent', outline: false },
  { pts: ellipse(0, 7.0, 1.05, 1.75, 22), fill: 'glass', ow: 0.4 },
  { pts: ellipse(-0.35, 7.6, 0.28, 0.6, 10), fill: 'glint', outline: false, shade: false },
];
const DART_LAYERS = toonLayers(DART_PARTS);

/* ---------------- Jet ---------------- */
// Points along a quadratic Bézier from a to c with control b.
const quad = (a, b, c, n = 10) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]; });
const shift = (pts, dx) => pts.map(([x, y]) => [x + dx, y]);
const both = (half, part) => [{ ...part, pts: mirror(half) }, { ...part, pts: half }];
// The jet is drawn at a smaller size below and scaled up by JET_SCALE (outlines keep their width), since its
// detail reads too small at the hull's size. It pokes a little past the collision hull; looks only.
const JET_SCALE = 1.2;
const scalePts = (pts) => pts.map(([x, y]) => [x * JET_SCALE, y * JET_SCALE]);
const JET_ENGINES = [-1.2, 1.2];
const JET_NOZZLES = scalePts(JET_ENGINES.map((x) => [x, -7.2]));
const jetEngine = (t) => 0.78 * (t < 0.75 ? 1 : Math.sqrt(1 - ((t - 0.75) / 0.25) ** 2));
const JET_PARTS = [
  // swept wings with a curved root extension, wingtip rails and tailplanes
  ...both([...quad([1.0, 6.6], [1.7, 3.2], [6.2, -2.2]), [6.2, -4.2], [2.4, -3.6], [1.0, -3.6]], { fill: 'accent' }),
  ...both([[6.0, -1.6], [6.6, -1.6], [6.6, -4.7], [6.0, -4.7]], { fill: 'metal', cut: 6.3 }),
  ...both([[1.4, -4.3], [5.3, -6.8], [5.2, -7.9], [1.4, -7.1]], { fill: 'accent' }),
  ...both([[2.3, -0.7], [3.5, -1.1], [3.5, -1.45], [2.3, -1.05]], { fill: 'ink', outline: false, shade: false }),
  ...both([[2.3, -1.8], [3.5, -2.2], [3.5, -2.55], [2.3, -2.15]], { fill: 'ink', outline: false, shade: false }),
  // long nose and body
  { pts: profile(-6.2, 12, (t) => (t < 0.45 ? 1.45 : 1.45 * Math.pow(Math.cos(((t - 0.45) / 0.55) * Math.PI / 2), 0.7)), 30), fill: 'accent' },
  // twin engines, their nozzles, and the tail spine between them
  ...JET_ENGINES.flatMap((x) => [
    { pts: shift(profile(-6.6, -1.6, jetEngine, 12), x), fill: 'white', cut: x },
    { pts: [[x - 0.78, -6.4], [x + 0.78, -6.4], [x + 0.7, -7.2], [x - 0.7, -7.2]], fill: 'ink', ow: 0.45 },
  ]),
  { pts: profile(-8.5, 1.6, (t) => 0.4 * Math.sqrt(Math.min(1, t * 4, (1 - t) * 2.5)), 18), fill: 'white' },
  // dark canopy and its glint
  { pts: profile(5.0, 9.6, (t) => 0.8 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.6), 14), fill: 'ink', ow: 0.4 },
  { pts: ellipse(-0.28, 8.1, 0.15, 0.6, 10), fill: 'glint', outline: false, shade: false },
];
const JET_LAYERS = toonLayers(JET_PARTS.map((p) => ({ ...p, pts: scalePts(p.pts), cut: p.cut === undefined ? undefined : p.cut * JET_SCALE })));

/* ---------------- Arrow (the original ship) ---------------- */
const ARROW_SHADE = 0.6;
function buildArrow(hex) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshBasicMaterial({ color: hex, transparent: true });
  const shadeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(ARROW_SHADE), transparent: true });
  const left = new THREE.Mesh(polyGeo([[0, 12], [-8, -8], [-3, -4.5], [0, -4.5]]), hullMat);
  const right = new THREE.Mesh(polyGeo([[0, 12], [0, -4.5], [3, -4.5], [8, -8]]), shadeMat);
  const cockpit = new THREE.Mesh(polyGeo([[0, 7], [2.6, 0.5], [-2.6, 0.5]]), new THREE.MeshBasicMaterial({ color: '#1b1640', transparent: true }));
  cockpit.position.z = 0.01;
  const glint = new THREE.Mesh(polyGeo([[0, 6.2], [-1.9, 1.2], [-0.9, 1.2]]), new THREE.MeshBasicMaterial({ color: '#b9b0ff', transparent: true, opacity: 0.7 }));
  glint.position.z = 0.02;
  g.add(left, right, cockpit, glint);
  g.userData.setColor = (h) => { hullMat.color.set(h); shadeMat.color.set(h).multiplyScalar(ARROW_SHADE); };
  return g;
}
const arrowSVG = (hex) => `<svg viewBox="-10 -14 20 34" aria-hidden="true"><path d="M-3.5 8 L0 19 L3.5 8Z" fill="#ff8f3d"/><path d="M-1.6 8 L0 13.5 L1.6 8Z" fill="#fff1c2"/><path d="M0 -12 L-8 8 L-3 4.5 L0 4.5Z" fill="${hex}"/><path d="M0 -12 L0 4.5 L3 4.5 L8 8Z" fill="${shadeHex(hex, ARROW_SHADE)}"/><path d="M0 -7 L2.6 -0.5 L-2.6 -0.5Z" fill="#1b1640"/><path d="M0 -6.2 L-1.9 -1.2 L-0.9 -1.2Z" fill="#b9b0ff" opacity="0.7"/></svg>`;

/* ---------------- the list ---------------- */
export const DESIGNS = [
  {
    id: 'dart', name: 'Dart',
    nozzles: DART_NOZZLES.map(([x, y]) => [x, y - 0.3]), flameY: -6.8,
    build: (hex) => buildToon(DART_LAYERS, hex),
    svg: (hex) => toonSVG(DART_LAYERS, hex, DART_NOZZLES.map(([x, y]) => svgFlame(x, y + 0.3, 1.05)).join('')),
  },
  {
    id: 'jet', name: 'Jet',
    nozzles: JET_NOZZLES.map(([x, y]) => [x, y - 0.2]), flameY: -6.9 * JET_SCALE,
    build: (hex) => buildToon(JET_LAYERS, hex),
    svg: (hex) => toonSVG(JET_LAYERS, hex, JET_NOZZLES.map(([x, y]) => svgFlame(x, y + 0.2, 0.75 * JET_SCALE)).join(''), 1.2),
  },
  {
    id: 'arrow', name: 'Arrow',
    nozzles: [[0, -7]], flameY: -4.5,
    build: buildArrow,
    svg: arrowSVG,
  },
];
export const designOf = (id) => DESIGNS.find((d) => d.id === id) || DESIGNS[0];
