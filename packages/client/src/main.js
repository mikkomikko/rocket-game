import * as THREE from 'three';
import { Pane } from 'tweakpane';
import './styles/index.css';

/* ------------------------------------------------------------------ *
 * Constants and tuning parameters
 * ------------------------------------------------------------------ */
let W = 1800, H = 1100;            // level size: 1 world unit = 1 mask pixel
const DEG = Math.PI / 180;
const P1HEX = '#ffe066', P2HEX = '#6ee7ff';
const SKIN = [P1HEX, P2HEX];   // the colours in use now; the start screen changes them
const STORAGE_KEY = 'rocket-duel-tuning-v1';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const DEFAULTS = {
  // Movement
  gravity: 16, thrustForce: 400, thrustRampUp: 30, thrustRampDown: 26,
  mass: 2.4, ammoWeight: 0.004, rotSpeed: 5.2, rotAccel: 48,
  linearDrag: 0.5, maxSpeed: 520, shipSize: 1,
  // Obstacles
  restitution: 0.35, wallFriction: 0.25, safeImpact: 120, damagePerSpeed: 0.35,
  lethalImpact: 420, landMaxSpeed: 110, landMaxAngle: 25, invulnTime: 1.2,
  respawnTime: 1.6, repairRate: 12, shipBounce: 0.6, shake: 6,
  // Shooting
  bulletSpeed: 650, inheritVelocity: 0.6, fireRate: 9, spread: 2, bulletLife: 1.6,
  bulletGravity: 0.3, recoil: 18, knockback: 60, bulletDamage: 8, ammoMax: 60,
  rearmRate: 25, destructible: true, holeRadius: 7,
  // Level
  lavaSpeed: 70, lavaAccel: 2, lavaDelay: 3,
  map: 'cave', seed: 7, rockAmount: 0.5, noiseScale: 140, tunnelRadius: 46,
  // View and debug
  zoom: 1.5, cameraLag: 0.12, lookahead: 0.22, split: 'side',
  showTrajectory: false, trajectorySeconds: 2, showHull: false, showVelocity: false,
  timeScale: 1, physicsHz: 120,
  smoke: true, smokeLife: 3, smokeRate: 45,
  sound: true, volume: 0.7,
  // Input
  p1Pad: 0, p2Pad: 1, deadzone: 0.18,
};

const PRESETS = {
  classic: {},
  floaty: { gravity: 90, thrustForce: 300, linearDrag: 0.6, rotSpeed: 3, rotAccel: 12, maxSpeed: 380, thrustRampUp: 6, restitution: 0.5 },
  twitchy: { gravity: 230, thrustForce: 820, rotSpeed: 6.5, rotAccel: 90, linearDrag: 0.1, maxSpeed: 720, thrustRampUp: 40, thrustRampDown: 40 },
  heavy: { mass: 2.2, thrustForce: 950, gravity: 200, rotSpeed: 3, rotAccel: 10, ammoWeight: 0.02, restitution: 0.1, wallFriction: 0.5, recoil: 60 },
};

const P = structuredClone(DEFAULTS);

/* Weapons. The Blaster uses the Shooting sliders as they are; the others scale from them. */
const WEAPONS = [
  { id: 'basic', name: 'Blaster', color: null, speed: 1, rate: 1, cost: 1, damage: 1, hole: 1, recoil: 1, knockback: 1, life: 1, grav: 1, size: 8, trail: 0.032, tLife: 0.45, tWidth: 2.6 },
  { id: 'heavy', name: 'Cannon', color: '#ff9a3c', speed: 0.42, rate: 0.13, cost: 5, damage: 4.5, hole: 4.6, recoil: 14, knockback: 4, life: 2.2, grav: 4, size: 18, trail: 0.07, tLife: 1.3, tWidth: 7,
    blast: 64 },          // splash radius: ships inside it take falloff damage and get shoved
  { id: 'ice', name: 'Freezer', color: '#9fe7ff', speed: 0.85, rate: 0.3, cost: 3, damage: 0.25, hole: 0, recoil: 1.5, knockback: 0.3, life: 1.3, grav: 1, size: 11, trail: 0.05, tLife: 0.9, tWidth: 4.2,
    freeze: 5 },          // seconds the target stays frozen
  { id: 'laser', name: 'Big laser', color: null, speed: 1, rate: 1, cost: 0, damage: 1, hole: 0, recoil: 0, knockback: 1, life: 1, grav: 1, size: 8, trail: 0.03, tLife: 0.45, tWidth: 2.6 },   // one shot per match: see fireBigLaser
  { id: 'ball', name: 'Bouncer', color: '#ff5fd2', speed: 0.7, rate: 0.25, cost: 4, damage: 0.4, hole: 0, recoil: 2, knockback: 1.5, life: 1.6, grav: 1.5, size: 13, trail: 0.05, tLife: 0.9, tWidth: 4.5,
    ball: 5 },            // seconds the target stays trapped in the bouncy ball
];
const FREEZE_COLOR = '#9fe7ff';
/* Bouncer: a hit wraps the ship in a heavy, very bouncy ball. The pilot can't steer or fire, the ball falls a bit
 * harder, bounces off terrain and the map edges, rolls along the ground and takes no crash damage. */
const BALL_IDX = WEAPONS.findIndex((w) => w.id === 'ball');
const BALL_COLOR = '#ff5fd2';
const BALL_R = 19;          // ball radius (world units at ship size 1)
const BALL_MASS = 4;        // extra mass while trapped: heavier to knock around, hits the other ship harder
const BALL_BOUNCE = 0.86;   // share of impact speed kept on each bounce
const BALL_GRAV = 1.3;      // gravity multiplier while trapped
if (reducedMotion) P.shake = 0;

// Practice mode: one ship in an empty, walled arena. These toggles stay out of the tuning JSON.
const PR = { infiniteAmmo: true, noDamage: false, grid: true, spawn: 'floor' };
const isPractice = () => game.mode === 'practice';
// One ship on screen: the practice arena, or "solo" (one player on a real map).
const isSolo = () => game.mode === 'practice' || game.mode === 'solo';

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const wrapAngle = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
function fbm(x, y, seed) {
  return (vnoise(x, y, seed) * 0.5 + vnoise(x * 2.03, y * 2.03, seed + 17) * 0.25 + vnoise(x * 4.1, y * 4.1, seed + 31) * 0.125) / 0.875;
}
const hexRGB = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/* ------------------------------------------------------------------ *
 * The level: one bitmap mask, used for both collision and drawing.
 * Mask values: 0 empty, 1 rock (destructible), 2 hard border, 3 landing pad.
 * Mask rows run top to bottom; world y runs bottom to top (row = H - y).
 * ------------------------------------------------------------------ */
const level = {
  mask: new Uint8Array(W * H),
  // Drawing field: a softened copy of the mask (R = rock, G = landing pad), rows bottom to top,
  // so the GPU can draw smooth, anti-aliased cave walls at any zoom instead of square pixels.
  field: new Uint8Array(W * H * 2),
  tex: null, dirty: false,
  spawns: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
};

// Rock colours by height: a smooth wave through plum, wine, rust and copper (the terrain shader uses the same formula).
const COPPER = [[16, 11, 30], [26, 15, 42], [42, 20, 56], [64, 28, 66]];
function rockRGB(worldY) {
  const t = 0.5 + 0.5 * Math.sin(worldY * (2 * Math.PI / 520) + 0.7);
  const f = t * (COPPER.length - 1);
  const i = Math.min(COPPER.length - 2, Math.floor(f)), k = f - i;
  return [0, 1, 2].map((j) => COPPER[i][j] + (COPPER[i + 1][j] - COPPER[i][j]) * k);
}
const rowColor = [];
for (let r = 0; r < H; r++) rowColor.push(rockRGB(H - r));

// Most maps are 1800 × 1100; a map can ask for another size (Floors is tall and narrow).
function resizeWorld(w, h) {
  if (w === W && h === H) return;
  W = w; H = h;
  level.mask = new Uint8Array(W * H);
  level.field = new Uint8Array(W * H * 2);
  rowColor.length = 0;
  for (let r = 0; r < H; r++) rowColor.push(rockRGB(H - r));
  worldResized();
}

function maskAt(x, y) {
  const c = Math.floor(x), r = Math.floor(H - y);
  if (c < 0 || c >= W || r < 0 || r >= H) return 2;
  return level.mask[r * W + c];
}
const solidAt = (x, y) => maskAt(x, y) !== 0;

// Rebuild the drawing field for a mask region (x = column, y = row) with a 5x5 binomial blur.
const BLUR = [1, 4, 6, 4, 1];
function paintRegion(x0, y0, x1, y1) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
  x1 = Math.min(W - 1, x1 | 0); y1 = Math.min(H - 1, y1 | 0);
  if (x1 < x0 || y1 < y0) return;
  const m = level.mask, f = level.field;
  const w = x1 - x0 + 1;
  const ry0 = Math.max(0, y0 - 2), ry1 = Math.min(H - 1, y1 + 2);
  const n = (ry1 - ry0 + 1) * w;
  const hs = new Float32Array(n), hp = new Float32Array(n);
  for (let r = ry0; r <= ry1; r++) {
    const row = r * W, o = (r - ry0) * w;
    for (let c = x0; c <= x1; c++) {
      let a = 0, b = 0;
      for (let k = -2; k <= 2; k++) {
        const cc = c + k < 0 ? 0 : c + k >= W ? W - 1 : c + k;
        const v = m[row + cc];
        if (v !== 0) { a += BLUR[k + 2]; if (v === 3) b += BLUR[k + 2]; }
      }
      hs[o + c - x0] = a; hp[o + c - x0] = b;
    }
  }
  for (let r = y0; r <= y1; r++) {
    const out = (H - 1 - r) * W;
    for (let c = x0; c <= x1; c++) {
      let a = 0, b = 0;
      for (let k = -2; k <= 2; k++) {
        let rr = r + k; if (rr < ry0) rr = ry0; else if (rr > ry1) rr = ry1;
        const i = (rr - ry0) * w + c - x0;
        a += hs[i] * BLUR[k + 2]; b += hp[i] * BLUR[k + 2];
      }
      const o = (out + c) * 2;
      f[o] = a * 0.99609375; f[o + 1] = b * 0.99609375;   // /256*255
    }
  }
  level.dirty = true;
}

// Carve a disk in mask coordinates. Only rock (1) is removed; borders and pads survive.
function carveDiskMask(cx, cy, r, paint) {
  const m = level.mask;
  const r0 = Math.max(0, Math.floor(cy - r)), r1 = Math.min(H - 1, Math.ceil(cy + r));
  let changed = false;
  for (let row = r0; row <= r1; row++) {
    const dy = row + 0.5 - cy;
    const span2 = r * r - dy * dy;
    if (span2 < 0) continue;
    const span = Math.sqrt(span2);
    const c0 = Math.max(0, Math.floor(cx - span)), c1 = Math.min(W - 1, Math.ceil(cx + span));
    for (let c = c0; c <= c1; c++) {
      const i = row * W + c;
      if (m[i] === 1) { m[i] = 0; changed = true; }
    }
  }
  if (changed && paint) paintRegion(cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3);
  return changed;
}
// World-space crater (used by bullets and explosions).
function carve(x, y, r) {
  if (carveDiskMask(x, H - y, r, true) && (level.theme === 'forest' || level.theme === 'desert')) plantsAfterCarve(x, y, r);
}

/* Map styles. Each one fills the mask with rock (1) in mask coordinates (x = column, y = row);
 * the spawn chambers, landing pads and the frame are added afterwards by generateLevel. */
function fillBlob(m, cx, cy, r, seed) {
  const r0 = Math.max(0, Math.floor(cy - r * 1.3)), r1 = Math.min(H - 1, Math.ceil(cy + r * 1.3));
  const c0 = Math.max(0, Math.floor(cx - r * 1.3)), c1 = Math.min(W - 1, Math.ceil(cx + r * 1.3));
  for (let row = r0; row <= r1; row++) {
    for (let c = c0; c <= c1; c++) {
      if (Math.hypot(c - cx, row - cy) < r * (0.7 + 0.6 * fbm(c / 45, row / 45, seed))) m[row * W + c] = 1;
    }
  }
}
// Rolling ground (and optional ceiling), mirrored around the middle so both sides match.
function fillGround(m, seed, base, amp, ceiling) {
  for (let c = 0; c < W; c++) {
    const x = Math.min(c, W - 1 - c);
    const g = base + amp * fbm(x / 170, 3.3, seed + 5);
    for (let row = Math.max(0, Math.floor(H - g)); row < H; row++) m[row * W + c] = 1;
    if (ceiling) {
      const t = ceiling * fbm(x / 120, 8.1, seed + 9);
      for (let row = 0; row < t; row++) m[row * W + c] = 1;
    }
  }
}
// Copy the left half onto the right, so neither player gets the better side.
function mirrorLeft(m) {
  for (let row = 0; row < H; row++) {
    for (let c = 0; c < W / 2; c++) m[row * W + (W - 1 - c)] = m[row * W + c];
  }
}
const farFrom = (x, y, pts, d) => pts.every((p) => Math.hypot(p.x - x, p.y - y) > d);

// Open sky: rolling ground, a low ceiling and floating rock islands.
function terrainOpen(m, rng, seed, A) {
  fillGround(m, seed, 30, 110, 60);
  const n = Math.round(4 + P.rockAmount * 14);
  for (let k = 0, tries = 0; k < n && tries < 400; tries++) {
    const r = 35 + rng() * 60;
    const x = 40 + r + rng() * (W / 2 - 80 - 2 * r), y = 120 + rng() * (H - 330);
    if (!farFrom(x, y, [A], 190 + r)) continue;
    fillBlob(m, x, y, r, seed + k);
    k++;
  }
  mirrorLeft(m);
}

// Pillars: stalactites and stalagmites in turn, so you weave up and down to cross.
function terrainPillars(m, rng, seed) {
  fillGround(m, seed, 25, 70, 0);
  const gap = Math.max(170, P.tunnelRadius * 4);
  let top = rng() < 0.5;
  for (let x = 450; x < W / 2 + 20; x += 150 + rng() * 60) {
    const w = 26 + rng() * 22 + P.rockAmount * 20;
    const len = (H - 120 - gap) * (0.6 + rng() * 0.4);
    for (let i = 0; i < len; i++) {
      const row = top ? i : H - 1 - i;
      const tip = Math.min(1, (len - i) / 40 + 0.35);
      const hw = w * (0.8 + 0.4 * fbm(x / 50, row / 60, seed)) * tip;
      for (let c = Math.max(0, Math.round(x - hw)); c <= Math.min(W - 1, Math.round(x + hw)); c++) m[row * W + c] = 1;
    }
    top = !top;
  }
  mirrorLeft(m);
}

// Maze: solid rock with a grid of corridors, plus extra openings so there are loops to chase around.
function terrainMaze(m, rng, seed, A, B) {
  m.fill(1);
  const T = 16, cell = Math.max(150, P.tunnelRadius * 3.3);
  const cols = Math.max(2, Math.floor((W - 2 * T - 40) / cell)), rows = Math.max(2, Math.floor((H - 2 * T - 40) / cell));
  const ox = (W - cols * cell) / 2 + cell / 2, oy = (H - rows * cell) / 2 + cell / 2;
  const at = (i, j) => ({ x: ox + i * cell, y: oy + j * cell });
  const seg = (a, b) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
    for (let s = 0; s <= n; s++) {
      const t = s / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      carveDiskMask(x, y, P.tunnelRadius * (0.85 + 0.3 * vnoise(x / 60, y / 60, seed)), false);
    }
  };
  const seen = new Uint8Array(cols * rows);
  const stack = [[0, 0]];
  seen[0] = 1;
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => [i + di, j + dj])
      .filter(([a, b]) => a >= 0 && b >= 0 && a < cols && b < rows && !seen[b * cols + a]);
    if (!nb.length) { stack.pop(); continue; }
    const [a, b] = nb[Math.floor(rng() * nb.length)];
    seen[b * cols + a] = 1;
    seg(at(i, j), at(a, b));
    stack.push([a, b]);
  }
  const extra = 0.12 + (1 - P.rockAmount) * 0.25;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (i + 1 < cols && rng() < extra) seg(at(i, j), at(i + 1, j));
      if (j + 1 < rows && rng() < extra) seg(at(i, j), at(i, j + 1));
    }
  }
  for (const S of [A, B]) {
    const i = clamp(Math.round((S.x - ox) / cell), 0, cols - 1), j = clamp(Math.round((S.y - oy) / cell), 0, rows - 1);
    seg(S, at(i, j));
  }
}

// The divide: a wall down the middle with three gaps, and a few rocks on each side.
function terrainDivide(m, rng, seed, A) {
  fillGround(m, seed, 25, 80, 40);
  const gh = Math.max(55, P.tunnelRadius * 1.4);
  const gaps = [0.25, 0.5, 0.75].map((f) => H * f + (rng() - 0.5) * 90);
  for (let row = 0; row < H; row++) {
    if (gaps.some((g) => Math.abs(row - g) < gh)) continue;
    const hw = 30 + 14 * fbm(3.7, row / 50, seed);
    for (let c = Math.round(W / 2 - hw); c < W / 2; c++) m[row * W + c] = 1;
  }
  const n = Math.round(2 + P.rockAmount * 8);
  for (let k = 0, tries = 0; k < n && tries < 300; tries++) {
    const r = 30 + rng() * 45;
    const x = 360 + rng() * (W / 2 - 520), y = 140 + rng() * (H - 360);
    if (!farFrom(x, y, [A], 180 + r)) continue;
    fillBlob(m, x, y, r, seed + k);
    k++;
  }
  mirrorLeft(m);
}

// A floating island: a lumpy flat top over rock that tapers to a point underneath (mask coordinates).
function fillIsland(m, cx, ty, hw, D, seed) {
  for (let c = Math.floor(cx - hw); c <= Math.ceil(cx + hw); c++) {
    const u = (c - cx) / hw;
    if (Math.abs(u) > 1 || c < 0 || c >= W) continue;
    const top = ty + Math.round(3 * fbm(c / 30, 1.7, seed) + 6 * u * u);
    const depth = D * Math.pow(1 - u * u, 0.7) * (0.75 + 0.5 * fbm(c / 25, 4.2, seed + 1));
    for (let r = Math.max(0, top); r < ty + depth && r < H; r++) m[r * W + c] = 1;
  }
}
// Forest planet: rolling hills for the plants and the dinosaur, and three floating islands with trees.
// The minigun waits on the middle island, the same distance from both players.
function terrainForest(m, rng, seed) {
  fillGround(m, seed + 3, 120, 100, 0);
  fillIsland(m, W * 0.33, H * 0.27, 105, 85, seed + 11);
  fillIsland(m, W * 0.5, H * 0.17, 120, 100, seed + 23);
  mirrorLeft(m);
  level.islands = [[W * 0.33, H * 0.27, 105], [W * 0.67, H * 0.27, 105], [W * 0.5, H * 0.17, 120]].map(([x, y, hw]) => ({ x, hw, top: H - y }));
}

// Dune sea: rolling dunes, a tall flat-topped mesa on each side and a floating slab of rock up high.
function terrainDesert(m, rng, seed) {
  for (let c = 0; c < W; c++) {
    const x = Math.min(c, W - 1 - c);
    const g = 150 + 40 * Math.sin(x / 95 + 1.3) + 26 * Math.sin(x / 41 + 0.4) + 34 * fbm(x / 140, 2.1, seed + 4);
    for (let row = Math.max(0, Math.floor(H - g)); row < H; row++) m[row * W + c] = 1;
  }
  const mx = Math.round(W * 0.31), top = H - 430;
  for (let row = top; row < H; row++) {
    const t = (row - top) / (H - top);
    const half = 62 + 40 * t * t + 6 * fbm(row / 30, 5.5, seed + 8);
    for (let c = Math.round(mx - half); c <= Math.round(mx + half); c++) m[row * W + c] = 1;
  }
  fillIsland(m, W * 0.5, H * 0.24, 150, 70, seed + 17);
  mirrorLeft(m);
  level.mesas = [mx, W - 1 - mx];
}

// Floors: two identical hallways side by side, ten floors high, each floor with an obstacle.
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function fillPolyMask(m, pts, v) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
      if (inPoly(x + 0.5, y + 0.5, pts)) m[(H - 1 - y) * W + x] = v;
    }
  }
}
// A wrecked ship: the rocket's outline, scaled up and snapped in two along a jagged line.
const WRECK_FRONT = [[0, 12], [4, 2], [1.5, 3.2], [-0.5, 1.2], [-2, 2.6], [-4, 2]];
const WRECK_BACK = [[4, 2], [8, -8], [0, -4.5], [-8, -8], [-4, 2], [-2, 2.6], [-0.5, 1.2], [1.5, 3.2]];
function wreckPieces(wx, wy, ang, sc) {
  const tf = (pts, dx, dy, a) => pts.map(([x, y]) => {
    const px = (x * Math.cos(a) - y * Math.sin(a) + dx) * sc, py = (x * Math.sin(a) + y * Math.cos(a) + dy) * sc;
    return [wx + px * Math.cos(ang) - py * Math.sin(ang), wy + px * Math.sin(ang) + py * Math.cos(ang)];
  });
  return [{ pts: tf(WRECK_FRONT, 0, 0.6, -0.15), shade: 0 }, { pts: tf(WRECK_BACK, 0.6, -1.4, 0.3), shade: 1 }];
}
function terrainFloors(m, rng, seed) {
  const T = 16, mid0 = W / 2 - 30, mid1 = W / 2 + 30;
  const fill = (x0, y0, x1, y1, v) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
      const row = (H - 1 - y) * W;
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) m[row + x] = v;
    }
  };
  fill(mid0, 0, mid1, H, 2);   // the wall between the hallways
  const halls = [[T, mid0], [mid1, W - T]];
  const spec = { halls, ledges: [], blocks: [], wrecks: [], asteroids: [], finish: H - 120 };
  const kinds = ['ledge', 'asteroids', 'breakable', 'wrecks', 'zigzag', 'asteroids', 'breakable', 'wrecks', 'zigzag'];
  halls.forEach(([x0, x1], hi) => {
    const R = mulberry32(seed * 13 + 7);   // same numbers for both hallways, so both races are identical
    const w = x1 - x0, cx = (x0 + x1) / 2, TH = 26;
    fill(cx - 45, 16, cx + 45, 26, 3);     // start pad
    kinds.forEach((kind, k) => {
      const fy = 300 + k * 400;
      if (kind === 'ledge' || kind === 'zigzag') {
        const gap = 120 + R() * 30;
        const sides = kind === 'zigzag' ? (R() < 0.5 ? ['L', 'R'] : ['R', 'L']) : [R() < 0.33 ? 'L' : R() < 0.5 ? 'R' : 'M'];
        sides.forEach((sd, j) => {
          const y = fy + 120 + j * 170;
          const rects = sd === 'L' ? [[x0, x1 - gap]] : sd === 'R' ? [[x0 + gap, x1]] : [[x0, cx - gap / 2], [cx + gap / 2, x1]];
          for (const [a, b] of rects) { fill(a, y, b, y + TH, 2); spec.ledges.push({ x0: a, y0: y, x1: b, y1: y + TH }); }
        });
      } else if (kind === 'breakable') {
        const y = fy + 180, n = 5, bw = w / n;
        for (let i = 0; i < n; i++) {
          const a = x0 + i * bw + 1, b = x0 + (i + 1) * bw - 1;
          fill(a, y, b, y + 34, 2);
          spec.blocks.push({ x0: a, y0: y, x1: b, y1: y + 34, hall: hi });
        }
      } else if (kind === 'wrecks') {
        for (const [fx, dy] of [[0.28, 130], [0.72, 270]]) {
          const wx = x0 + w * fx + (R() - 0.5) * 30, wy = fy + dy;
          const pieces = wreckPieces(wx, wy, R() * Math.PI * 2, 3.2 + R() * 0.6);
          for (const p of pieces) fillPolyMask(m, p.pts, 2);
          const top = Math.max(...pieces.flatMap((p) => p.pts.map((q) => q[1])));
          spec.wrecks.push({ pieces, x: wx, y: wy, top, hall: hi });
        }
      } else if (kind === 'asteroids') {
        for (let j = 0; j < 3; j++) {
          const r = 20 + R() * 12, dir = j % 2 ? 1 : -1;
          spec.asteroids.push({ hall: hi, x: x0 + r + R() * (w - 2 * r), y: fy + 90 + j * 115, r, vx: dir * (80 + R() * 80), spin: (R() - 0.5) * 2, seed: Math.floor(R() * 1e6) });
        }
      }
    });
  });
  FL.spec = spec;
  level.spawns = halls.map(([x0, x1]) => ({ x: (x0 + x1) / 2, y: 26 }));
}

// Starship: the inside of a big starship, full of cargo boxes, with a raygun on the roof and an exit door on the right.
function terrainStarship(m) {
  const fill = (x0, y0, x1, y1, v) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
      const row = (H - 1 - y) * W;
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) m[row + x] = v;
    }
  };
  const HT = 56, WX0 = 1560, WX1 = 1600;
  fill(0, 0, WX1, HT, 2);          // deck
  fill(0, H - HT, WX1, H, 2);      // roof
  fill(0, 0, 40, H, 2);            // back hull
  fill(WX0, 0, WX1, H, 2);         // front hull; the door is part of it until the boss is beaten
  const boxes = [
    [440, 56, 560, 176], [470, 176, 540, 236], [760, 56, 900, 146], [1080, 56, 1220, 196], [1110, 196, 1190, 266],
    [1380, 56, 1500, 136], [380, 578, 470, 650], [520, 578, 600, 630], [1180, 718, 1290, 800], [720, 420, 810, 500], [1250, 400, 1330, 470],
  ];
  const catwalks = [[300, 560, 640, 578], [980, 700, 1340, 718]];
  for (const r of [...boxes, ...catwalks]) fill(r[0], r[1], r[2], r[3], 2);
  fill(866, H - 84, 934, H - HT, 2);   // the raygun's mount: it can't be broken
  for (const x of [150, 270]) fill(x - 38, 56, x + 38, 66, 3);
  SH.spec = {
    boxes, catwalks, door: [WX0, 340, WX1, 470], hullX: WX0, exitX: 1660,
    spawnPts: [[1300, 950], [700, 950], [1450, 600], [1000, 540], [1300, 330], [620, 380], [1000, 900]], bossSpawn: [900, 820],
    ammo: [[330, 578], [1060, 718], [660, 56], [1300, 56], [830, 146], [1290, 470]],
    medkits: [[505, 236], [1150, 266], [1318, 718]],
  };
  level.spawns = [{ x: 150, y: 66 }, { x: 270, y: 66 }];
}

const MAPS = {
  cave: { name: 'Cave', desc: 'Twisty tunnels through noisy rock.', make: terrainCave },
  clear: { name: 'Clear space', desc: 'Empty space: just the walls and two landing pads. An arrow points to your opponent.', make: () => {}, bare: true },
  open: { name: 'Open sky', desc: 'Rolling ground and floating islands. Room to dogfight.', make: terrainOpen },
  forest: { name: 'Forest planet', desc: 'Exotic trees, giant mushrooms and floating islands. Grab the minigun on the top island! Every 10 s a colorful dino runs by.', make: terrainForest, theme: 'forest', thumbRock: [92, 74, 50], thumbSky: [14, 38, 36] },
  desert: { name: 'Dune sea', desc: 'Sand dunes, cacti and tall mesas under a setting sun. When the sand rumbles, move! A giant sandworm bursts out and swallows rockets. Three shots to its head and it bursts.', make: terrainDesert, theme: 'desert', thumbRock: [204, 150, 92], thumbSky: [96, 48, 64] },
  pillars: { name: 'Pillars', desc: 'Columns from floor and ceiling. Weave to get across.', make: terrainPillars },
  maze: { name: 'Maze', desc: 'Corridors and loops. Fight round corners.', make: terrainMaze },
  divide: { name: 'The divide', desc: 'A wall down the middle with three gaps.', make: terrainDivide },
  floors: { name: 'Floors', desc: 'Race up your own hallway. Lava rises behind you! Dodge rocks and wrecks, shoot the orange blocks.', make: terrainFloors, theme: 'floors', size: [1000, 4000], custom: true },
  starship: { name: 'Starship', desc: 'Work together inside a giant starship: 7 waves of red robot ships, the raygun, the boss, then escape! Grab ammo boxes and the three medkits on the way.', make: terrainStarship, theme: 'ship', custom: true },
  hangar: { name: 'Robot hangar', desc: 'Work together in a starship hangar full of parked ships. A giant robot drops from the roof: it shoots a laser from its eye, punches and sends small robots. Hide behind the ships and aim for its head!', make: terrainHangar, theme: 'ship', custom: true },
};

// Cave: the original noise cave with a loop of tunnels through both spawns.
function terrainCave(m, rng, seed, A, B) {
  const sc = P.noiseScale;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      m[r * W + c] = fbm(c / sc, r / sc, seed) < P.rockAmount ? 1 : 0;
    }
  }
  const ry = () => H * (0.18 + rng() * 0.64);
  // A closed loop of tunnels through both spawns so the players can always reach each other.
  const pts = [A, { x: W * 0.32, y: ry() }, { x: W * 0.5, y: ry() }, { x: W * 0.68, y: ry() }, B,
               { x: W * 0.68, y: ry() }, { x: W * 0.5, y: ry() }, { x: W * 0.32, y: ry() }];
  const n = pts.length, steps = 48;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      const r = P.tunnelRadius * (0.7 + 0.6 * vnoise(i * 1.7 + t * 2.3, 0.5, seed + 99));
      carveDiskMask(x, y, r, false);
    }
  }
  for (let k = 0; k < 10; k++) carveDiskMask(rng() * W, rng() * H, 25 + rng() * 55, false);
}

function generateLevel(paint = true) {
  const seed = P.seed | 0;
  const rng = mulberry32(seed * 7919 + 13);
  const def = MAPS[P.map] || MAPS.cave;
  resizeWorld(...(def.size || [1800, 1100]));
  const m = level.mask;
  const A = { x: W * 0.14, y: H * 0.42 }, B = { x: W * 0.86, y: H * 0.42 };
  m.fill(0);
  (MAPS[P.map] || MAPS.cave).make(m, rng, seed, A, B);
  const bare = !!(MAPS[P.map] && MAPS[P.map].bare);   // bare maps get floating pads with no rock under them
  // Spawn chambers, a rock pedestal and a landing pad for each player.
  const pads = [];
  for (const S of def.custom ? [] : [A, B]) {   // custom maps place their own pads
    carveDiskMask(S.x, S.y, 96, false);
    const padTop = Math.round(S.y + 38);
    if (!bare) for (let r = padTop + 10; r < padTop + 70 && r < H; r++) {
      const half = 30 + (r - padTop - 10) * 0.6;
      for (let c = Math.round(S.x - half); c <= Math.round(S.x + half); c++) if (m[r * W + c] === 0) m[r * W + c] = 1;
    }
    for (let r = padTop; r < padTop + 10; r++) {
      for (let c = Math.round(S.x - 38); c <= Math.round(S.x + 38); c++) m[r * W + c] = 3;
    }
    pads.push({ x: S.x, y: H - padTop });
  }
  // Indestructible frame.
  const T = 16;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (r < T || r >= H - T || c < T || c >= W - T) m[r * W + c] = 2;
    }
  }
  if (!def.custom) level.spawns = pads;
  level.builtMap = P.map;
  if (paint) paintRegion(0, 0, W - 1, H - 1);
}

// Practice arena: nothing but the indestructible frame.
function generateEmptyLevel() {
  resizeWorld(1800, 1100);
  const m = level.mask, T = 16;
  m.fill(0);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (r < T || r >= H - T || c < T || c >= W - T) m[r * W + c] = 2;
    }
  }
  level.spawns = [{ x: W / 2, y: T }, { x: W / 2, y: T }];
  paintRegion(0, 0, W - 1, H - 1);
}
function buildLevel() {
  if (isPractice()) generateEmptyLevel(); else generateLevel();
  level.theme = (!isPractice() && MAPS[level.builtMap] && MAPS[level.builtMap].theme) || 'rock';
  applyTheme();
  updateMapButton();
}

/* ------------------------------------------------------------------ *
 * Three.js scene
 * ------------------------------------------------------------------ */
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor('#0a0820');
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();

const NOISE_GLSL = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v / 0.9375; }
`;
const srgb3 = (hex) => new THREE.Vector3(...hexRGB(hex).map((v) => v / 255));

// Sky: a procedural gradient, soft nebula and round twinkling stars, drawn with a little parallax.
const skyMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uHalf: { value: new THREE.Vector2(W, H) }, uForest: { value: 0 }, uDesert: { value: 0 } },
  vertexShader: `varying vec2 vPos; void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
uniform float uTime; uniform vec2 uHalf; uniform float uForest; uniform float uDesert; varying vec2 vPos;
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
  float yN = vPos.y / uHalf.y;
  float aa = max(fwidth(vPos.y), 0.5);
  // Night gradient: deep indigo overhead, warming to violet and magenta towards the horizon.
  vec3 col = mix(vec3(0.17, 0.045, 0.21), vec3(0.035, 0.028, 0.10), smoothstep(0.12, 0.62, h));
  col = mix(col, vec3(0.010, 0.014, 0.045), smoothstep(0.62, 1.0, h));
  float n1 = fbm(vPos * 0.0022 + 3.0);
  float n2 = fbm(vPos * 0.004 + vec2(11.0, -7.0));
  // Horizon glow behind the far range: wide magenta haze around a small hot gold core.
  float gd = length(vec2(vPos.x * 0.5, vPos.y + 0.30 * uHalf.y)) / uHalf.y;
  vec3 glow = vec3(0.60, 0.13, 0.40) * exp(-gd * 2.6) * 0.6 + vec3(1.0, 0.66, 0.32) * exp(-gd * 8.0) * 0.5;
  col += glow;
  // Stars: sparse and small, fading out near the glowing horizon.
  float st = stars(vPos, 34.0, 0.07, 0.55) + stars(vPos + 50.0, 72.0, 0.20, 0.85);
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
  // Forest planet sky: teal haze and two moons.
  float dm1 = length(vPos - vec2(-430.0, 320.0)), dm2 = length(vPos - vec2(390.0, 430.0));
  float m1 = smoothstep(64.0, 61.5, dm1), m2 = smoothstep(25.0, 23.0, dm2);
  vec3 fc = mix(vec3(0.04, 0.12, 0.11), vec3(0.19, 0.11, 0.25), h);
  fc += vec3(0.10, 0.30, 0.20) * pow(n1, 3.0) * 0.55 + vec3(0.30, 0.12, 0.30) * pow(n2, 3.5) * 0.4;
  fc += vec3(0.86, 0.92, 0.86) * st * 0.6 * (1.0 - max(m1, m2));
  fc += vec3(0.95, 0.78, 0.55) * 0.10 * smoothstep(200.0, 64.0, dm1);
  vec3 moonA = vec3(0.95, 0.80, 0.60) * (0.78 + 0.22 * fbm((vPos - vec2(-430.0, 320.0)) * 0.045)) * (0.75 + 0.25 * smoothstep(90.0, 0.0, length(vPos - vec2(-455.0, 345.0))));
  fc = mix(fc, moonA, m1);
  fc = mix(fc, vec3(0.62, 0.88, 0.86), m2);
  col = mix(col, fc, uForest);
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
  col = mix(col, dsc, uDesert);
  // Film grain.
  col += (hash12(floor(vPos * 1.4)) - 0.5) * 0.035;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`,
  depthWrite: false,
});
const skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H * 2), skyMat);
skyMesh.position.set(W / 2, H / 2, -1);
skyMesh.frustumCulled = false;
scene.add(skyMesh);

// Terrain: smooth walls from the softened field, with soft lighting, depth shading, cast shadows and glowing pads.
level.tex = new THREE.DataTexture(level.field, W, H, THREE.RGFormat, THREE.UnsignedByteType);
level.tex.magFilter = THREE.LinearFilter;
level.tex.minFilter = THREE.LinearMipmapLinearFilter;
level.tex.generateMipmaps = true;
level.tex.unpackAlignment = 1;
const levelMat = new THREE.ShaderMaterial({
  uniforms: {
    uField: { value: level.tex },
    uSize: { value: new THREE.Vector2(W, H) },
    uP1: { value: srgb3(P1HEX) },
    uP2: { value: srgb3(P2HEX) },
    uForest: { value: 0 },
    uDesert: { value: 0 },
    uSteel: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
uniform sampler2D uField; uniform vec2 uSize; uniform vec3 uP1; uniform vec3 uP2; uniform float uForest; uniform float uSteel; uniform float uDesert;
varying vec2 vUv;
${NOISE_GLSL}
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
  vec3 soil = mix(vec3(0.17, 0.12, 0.09), vec3(0.28, 0.20, 0.13), 0.5 + 0.5 * sin(px.y * 0.05));
  col = mix(col, soil, uForest);
  vec3 sand = mix(vec3(0.80, 0.58, 0.36), vec3(0.62, 0.38, 0.25), 0.5 + 0.5 * sin(px.y * 0.07 + 3.0 * fbm(px * 0.012)));
  col = mix(col, sand, uDesert);
  vec2 q = abs(fract(px / 64.0) - 0.5) * 64.0;
  float seam = smoothstep(29.5, 31.0, max(q.x, q.y));
  vec3 steel = vec3(0.24, 0.26, 0.34) * (0.88 + 0.12 * fbm(px * 0.02)) * (1.0 - 0.4 * seam);
  col = mix(col, steel, uSteel);
  col *= mix(0.76 + 0.26 * fbm(px * 0.02) + 0.18 * stroke, 0.8 + 0.32 * fbm(px * 0.035) + 0.06 * vnoise(px * 0.18), uDesert);
  col *= mix(1.0, mix(0.34, 0.5, uDesert), deep);
  vec3 warm = mix(vec3(0.92, 0.32, 0.40), vec3(0.45, 0.86, 0.36), uForest), hot = mix(vec3(1.0, 0.68, 0.44), vec3(0.75, 0.95, 0.55), uForest), cool = vec3(0.16, 0.12, 0.40);
  warm = mix(warm, vec3(1.0, 0.86, 0.58), uDesert); hot = mix(hot, vec3(1.0, 0.94, 0.76), uDesert);
  float litK = max(lit, 0.0);
  col = mix(col, warm * (0.4 + 0.6 * brush), rim * litK * (0.3 + 0.6 * brush));
  col = mix(col, col * 0.5 + cool * 0.1, rim * max(-lit, 0.0) * 0.75);
  col += mix(warm, hot, litK * litK) * lip * litK * 0.75 + cool * lip * max(-lit, 0.0) * 0.12;
  col = mix(col, vec3(0.20, 0.52, 0.22), uForest * rim * smoothstep(0.2, 0.8, lit) * 0.7);
  col = mix(col, vec3(0.96, 0.82, 0.58), uDesert * rim * smoothstep(0.2, 0.8, lit) * 0.6);

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

  gl_FragColor = vec4(mix(outC, col, cover), mix(outA, 1.0, cover));
}`,
  transparent: true,
  depthWrite: false,
});
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
const gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), gridMat);
gridMesh.position.set(W / 2, H / 2, -0.5);
gridMesh.visible = false;
scene.add(gridMesh);

// When a map changes the world size, rebuild everything that was sized to it.
function worldResized() {
  level.tex.dispose();
  level.tex = new THREE.DataTexture(level.field, W, H, THREE.RGFormat, THREE.UnsignedByteType);
  level.tex.magFilter = THREE.LinearFilter;
  level.tex.minFilter = THREE.LinearMipmapLinearFilter;
  level.tex.generateMipmaps = true;
  level.tex.unpackAlignment = 1;
  levelMat.uniforms.uField.value = level.tex;
  levelMat.uniforms.uSize.value.set(W, H);
  skyMat.uniforms.uHalf.value.set(W, H);
  for (const [mesh, sx, sy] of [[levelMesh, 1, 1], [skyMesh, 2, 2], [gridMesh, 1, 1]]) {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(W * sx, H * sy);
    mesh.position.x = W / 2; mesh.position.y = H / 2;
  }
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
const glowMat = (color, opacity) => new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

/* ------------------------------------------------------------------ *
 * Ships
 * ------------------------------------------------------------------ */
// Hull sample points in ship-local units (nose points along +y). Collision samples these.
const HULL = [[0, 12], [8, -8], [-8, -8], [4.5, 2], [-4.5, 2], [0, -4.5]];
const SHIP_RADIUS = 10;

function shapeGeo(points) {
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
const TRAJ_MAX = 600;
const ships = [makeShip(0), makeShip(1)];

const HW = HULL.map(() => [0, 0]);
function hullWorld(s, dx = 0, dy = 0) {
  const c = Math.cos(s.a), sn = Math.sin(s.a), k = P.shipSize;
  for (let i = 0; i < HULL.length; i++) {
    const lx = HULL[i][0] * k, ly = HULL[i][1] * k;
    HW[i][0] = s.x + dx + lx * c - ly * sn;
    HW[i][1] = s.y + dy + lx * sn + ly * c;
  }
  return HW;
}
function hullSolid(s, dx = 0, dy = 0) {
  const pts = hullWorld(s, dx, dy);
  for (const p of pts) if (solidAt(p[0], p[1])) return true;
  return false;
}
function localToWorld(s, lx, ly) {
  const c = Math.cos(s.a), sn = Math.sin(s.a), k = P.shipSize;
  return { x: s.x + (lx * c - ly * sn) * k, y: s.y + (lx * sn + ly * c) * k };
}
const shipMass = (s) => P.mass + s.ammo * P.ammoWeight + (s.ballT > 0 ? BALL_MASS : 0);

function normalAt(x, y, s) {
  let nx = 0, ny = 0;
  const R = 5;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      if (solidAt(x + dx, y + dy)) { nx -= dx; ny -= dy; }
    }
  }
  const l = Math.hypot(nx, ny);
  if (l < 1e-6) {
    const v = Math.hypot(s.vx, s.vy);
    return v > 1e-6 ? { x: -s.vx / v, y: -s.vy / v } : { x: 0, y: 1 };
  }
  return { x: nx / l, y: ny / l };
}

function standingOnPad(s) {
  const pts = hullWorld(s, 0, -2.5);
  return maskAt(pts[1][0], pts[1][1]) === 3 || maskAt(pts[2][0], pts[2][1]) === 3;
}
function supported(s) {
  const pts = hullWorld(s, 0, -2);
  for (const p of pts) if (solidAt(p[0], p[1])) return true;
  return false;
}

function addShake(s, amount) { s.cam.shake = Math.max(s.cam.shake, amount * P.shake); }

function damage(s, amount) {
  if (!s.alive || s.invulnT > 0 || (isPractice() && PR.noDamage) || (level.theme === 'ship' && RB.cut)) return;
  s.hp -= amount;
  addShake(s, Math.min(1, amount / 30));
  if (s.hp <= 0) { s.hp = 0; kill(s); }
}

function kill(s, eaten = false) {
  s.minigunT = 0;
  s.beam = null;   // a beam in progress stops, but a used Big laser does not come back
  s.frozenT = 0;
  s.ballT = 0;
  s.alive = false;
  s.respawnT = P.respawnTime;
  s.deathX = s.x; s.deathY = s.y;
  s.thrust = 0;
  s.group.visible = false;
  const other = ships[1 - s.id];
  if (!isPractice() && level.theme !== 'floors' && level.theme !== 'ship') other.score++;   // in Floors and Starship you score another way
  if (level.theme === 'ship') SH.deaths++;
  const how = eaten === true ? 'eaten' : (eaten || '');
  s.eaten = how === 'eaten';
  s.lava = how === 'lava';
  if (s.eaten) { sfx.bump(s, 400); return; }
  sfx.death(s);
  if (s.lava) {
    for (let i = 0; i < 40; i++) emit(s.x + (Math.random() - 0.5) * 20, s.y, (Math.random() - 0.5) * 160, 80 + Math.random() * 220, 0.5 + Math.random() * 0.7, i % 2 ? FIRE : EMBER, 0.6, 3 + Math.random() * 5);
    for (let i = 0; i < 5; i++) emitSmoke(s.x, s.y + 10, (Math.random() - 0.5) * 30, 30 + Math.random() * 30, 1.5 + Math.random(), 8 + Math.random() * 6);
    addShake(s, 1.2);
    return;
  }
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 260;
    emit(s.x, s.y, s.vx * 0.4 + Math.cos(a) * sp, s.vy * 0.4 + Math.sin(a) * sp, 0.5 + Math.random() * 0.9, i % 3 ? s.color : FIRE, 0.4, 3 + Math.random() * 5);
  }
  emit(s.x, s.y, 0, 0, 0.35, s.color, 0, 70);
  emit(s.x, s.y, 0, 0, 0.2, WHITE, 0, 34);
  if (P.smoke) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = 15 + Math.random() * 70;
      emitSmoke(s.x, s.y, Math.cos(a) * sp + s.vx * 0.2, Math.sin(a) * sp + s.vy * 0.2, P.smokeLife * (0.8 + Math.random() * 0.6), 12 + Math.random() * 10);
    }
  }
  terrainDebris(s.x, s.y, 1.6);
  if (P.destructible) carve(s.x, s.y, P.holeRadius * 2.2);
  addShake(s, 1.6);
  if (other.active) addShake(other, 0.4);
}

function respawn(s) {
  const sp = level.spawns[s.id];
  const air = isPractice() && PR.spawn === 'air';
  s.x = sp.x; s.y = air ? H / 2 : sp.y + 8 * P.shipSize + 0.6;
  s.px = s.x; s.py = s.y;
  s.vx = 0; s.vy = 0; s.a = 0; s.pa = 0; s.av = 0; s.thrust = 0;
  s.hp = 100; s.ammo = P.ammoMax;
  s.landed = !air; s.onPad = !isPractice(); s.alive = true; s.active = true; s.lastImpact = 0; s.eaten = false; s.lava = false; s.minigunT = 0; s.frozenT = 0; s.ballT = 0;
  if (level.theme === 'floors') resetLava(s.id);
  s.invulnT = P.invulnTime; s.fireCd = 0.2;
  s.cam.x = s.x; s.cam.y = s.y;
  s.group.visible = true;
  sfx.respawn(s);
}

function resolveTerrain(s) {
  const pts = hullWorld(s);
  let hits = 0, cx = 0, cy = 0;
  for (const p of pts) if (solidAt(p[0], p[1])) { hits++; cx += p[0]; cy += p[1]; }
  if (!hits) return;
  cx /= hits; cy /= hits;
  const n = normalAt(cx, cy, s);
  let free = false;
  for (let k = 0; k < 24; k++) {
    s.x += n.x * 0.75; s.y += n.y * 0.75;
    if (!hullSolid(s)) { free = true; break; }
  }
  if (!free) { s.x = s.px; s.y = s.py; }

  const vn = s.vx * n.x + s.vy * n.y;
  if (vn >= 0) return;
  const impact = -vn;
  if (impact > 5) s.lastImpact = impact;
  const upright = Math.abs(wrapAngle(s.a)) <= P.landMaxAngle * DEG;
  if (n.y > 0.7 && upright && impact <= P.landMaxSpeed) {
    s.landed = true; s.vx = 0; s.vy = 0;
    s.onPad = standingOnPad(s);
    if (impact > 40) { dust(cx, cy, n, impact * 0.5); sfx.bump(s, impact * 0.4); }
    return;
  }
  const tx = s.vx - vn * n.x, ty = s.vy - vn * n.y;
  const bounce = impact < 12 ? 0 : P.restitution;
  const keep = 1 - P.wallFriction;
  s.vx = tx * keep + n.x * impact * bounce;
  s.vy = ty * keep + n.y * impact * bounce;
  if (impact > P.lethalImpact) damage(s, 1e9);
  else if (impact > P.safeImpact) damage(s, (impact - P.safeImpact) * P.damagePerSpeed);
  if (impact > 40) { addShake(s, Math.min(1, impact / 400)); dust(cx, cy, n, impact); sfx.bump(s, impact); }
}

function updateShip(s, h) {
  if (!s.alive) { s.respawnT -= h; if (s.respawnT <= 0) respawn(s); return; }
  s.invulnT = Math.max(0, s.invulnT - h);
  s.fireCd -= h;
  if (s.minigunT > 0) s.minigunT = Math.max(0, s.minigunT - h);
  const inp = s.input;

  if (s.ballT > 0) { stepBall(s, h); return; }

  if (s.frozenT > 0) {
    // Frozen solid: no turning, thrust or firing. The ship keeps drifting with the velocity it had
    // when it was hit (no gravity, no drag), though walls, ships and hits can still push it.
    s.frozenT = Math.max(0, s.frozenT - h);
    s.av = 0; s.thrust = 0;
    if (!s.landed) {
      s.x += s.vx * h; s.y += s.vy * h;
      resolveTerrain(s);
    }
    if (Math.random() < 0.25) {
      const a = Math.random() * Math.PI * 2;
      emit(s.x + Math.cos(a) * 12, s.y + Math.sin(a) * 12, s.vx * 0.5 + Math.cos(a) * 20, s.vy * 0.5 + Math.sin(a) * 20, 0.5, ICE_COL, 0.3, 2.5 + Math.random() * 2);
    }
    if (s.frozenT === 0) {
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
        emit(s.x, s.y, s.vx * 0.3 + Math.cos(a) * sp, s.vy * 0.3 + Math.sin(a) * sp, 0.4 + Math.random() * 0.4, i % 2 ? ICE_COL : WHITE, 0.8, 2 + Math.random() * 3);
      }
    }
    return;
  }

  s.av = approach(s.av, inp.turn * P.rotSpeed, P.rotAccel * h);
  s.a += s.av * h;
  const tgt = inp.thrust;
  s.thrust = approach(s.thrust, tgt, (tgt > s.thrust ? P.thrustRampUp : P.thrustRampDown) * h);

  const m = shipMass(s);
  const fx = -Math.sin(s.a), fy = Math.cos(s.a);
  const acc = P.thrustForce * s.thrust / m;

  if (s.landed) {
    if (acc * fy > P.gravity + 1 || !supported(s)) {
      s.landed = false;
    } else {
      s.vx = 0; s.vy = 0;
      if (s.av !== 0) resolveTerrain(s);
      if (s.onPad) {
        s.ammo = Math.min(P.ammoMax, s.ammo + P.rearmRate * h);
        s.hp = Math.min(100, s.hp + P.repairRate * h);
      }
    }
  }
  if (!s.landed) {
    s.onPad = false;
    s.vx += fx * acc * h;
    s.vy += (fy * acc - P.gravity) * h;
    const k = Math.exp(-P.linearDrag * h);
    s.vx *= k; s.vy *= k;
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > P.maxSpeed) { s.vx *= P.maxSpeed / sp; s.vy *= P.maxSpeed / sp; }
    s.x += s.vx * h; s.y += s.vy * h;
    resolveTerrain(s);
  }
  if (!s.alive) return;
  if (inp.fire && s.fireCd <= 0 && (s.ammo >= WEAPONS[s.weapon].cost || s.minigunT > 0 || (isPractice() && PR.infiniteAmmo))) fire(s);
  stepBigLaser(s, h);
  if (s.thrust > 0.05 && Math.random() < s.thrust * 0.9) {
    const t = localToWorld(s, 0, -7);
    const sp = 120 + Math.random() * 120;
    emit(t.x, t.y, s.vx - fx * sp + (Math.random() - 0.5) * 50, s.vy - fy * sp + (Math.random() - 0.5) * 50, 0.25 + Math.random() * 0.25, Math.random() < 0.5 ? FIRE : EMBER, 0.2, 3 + Math.random() * 3);
  }
  if (P.smoke && s.thrust > 0.02) {
    s.smokeAcc += P.smokeRate * s.thrust * h;
    while (s.smokeAcc >= 1) {
      s.smokeAcc -= 1;
      const t = localToWorld(s, (Math.random() - 0.5) * 3, -10);
      const sp = 30 + Math.random() * 40;
      emitSmoke(t.x, t.y, s.vx * 0.25 - fx * sp + (Math.random() - 0.5) * 24, s.vy * 0.25 - fy * sp + (Math.random() - 0.5) * 24,
        P.smokeLife * (0.75 + Math.random() * 0.5), (7 + Math.random() * 5) * P.shipSize);
    }
  }
}

function fire(s) {
  const wp = WEAPONS[s.weapon];
  if (wp.id === 'laser') { fireBigLaser(s); return; }
  const ang = s.a + (Math.random() - 0.5) * 2 * (P.spread * (wp.id === 'heavy' ? 0.3 : 1) + (s.minigunT > 0 ? 3 : 0)) * DEG;
  const dx = -Math.sin(ang), dy = Math.cos(ang);
  const nose = localToWorld(s, 0, 13);
  const spd = P.bulletSpeed * wp.speed;
  spawnBullet(s.id, nose.x, nose.y, dx * spd + s.vx * P.inheritVelocity, dy * spd + s.vy * P.inheritVelocity, P.bulletLife * wp.life, s.weapon);
  if (!(isPractice() && PR.infiniteAmmo) && !(s.minigunT > 0)) s.ammo = Math.max(0, s.ammo - wp.cost);   // the minigun uses no ammo
  s.fireCd = 1 / (P.fireRate * wp.rate * (s.minigunT > 0 ? MINIGUN_RATE : 1));
  if (P.recoil > 0) {
    const m = shipMass(s), rc = P.recoil * wp.recoil * (s.minigunT > 0 ? 0.25 : 1) / m;
    // The Cannon kicks hard enough to knock a landed ship off the ground; the others only push in the air.
    if (s.landed && wp.id === 'heavy') s.landed = false;
    if (!s.landed) {
      s.vx -= -Math.sin(s.a) * rc;
      s.vy -= Math.cos(s.a) * rc;
    }
  }
  if (wp.id === 'heavy') {
    sfx.cannon(s);
    addShake(s, 0.5);
    for (let i = 0; i < 14; i++) {
      const a = ang + (Math.random() - 0.5) * 1.2, sp = 60 + Math.random() * 160;
      emit(nose.x, nose.y, -Math.sin(a) * sp + s.vx, Math.cos(a) * sp + s.vy, 0.2 + Math.random() * 0.2, i % 2 ? FIRE : EMBER, 0.2, 4 + Math.random() * 4);
    }
    if (P.smoke) for (let i = 0; i < 4; i++) emitSmoke(nose.x, nose.y, dx * 40 + s.vx * 0.3 + (Math.random() - 0.5) * 30, dy * 40 + s.vy * 0.3 + (Math.random() - 0.5) * 30, P.smokeLife * 0.6, 9 + Math.random() * 6);
    emit(nose.x, nose.y, s.vx, s.vy, 0.12, WHITE, 0, 30);
  } else {
    if (wp.id === 'ice') sfx.freezer(s); else sfx.shoot(s);
    emit(nose.x, nose.y, dx * 80 + s.vx, dy * 80 + s.vy, 0.09, wp.id === 'ice' ? ICE_COL : wp.id === 'ball' ? BALL_COL : s.color, 0, wp.id === 'ice' || wp.id === 'ball' ? 16 : 12);
  }
}

/* Weapon switching: cycles to the next weapon and plays the slide animation in the little box by the ship. */
function cycleWeapon(s) {
  if (!s.active) return;
  const prev = s.weapon;
  s.weapon = (s.weapon + 1) % WEAPONS.length;
  // A used Big laser is skipped until the next match.
  if (WEAPONS[s.weapon].id === 'laser' && !(s.bigLaser > 0) && !bigFree()) s.weapon = (s.weapon + 1) % WEAPONS.length;
  s.fireCd = Math.max(s.fireCd, 0.15);
  animateWeaponBox(s.id, prev, s.weapon);
  sfx.swap();
  updateWeaponButtons();
}

const shipR = (s) => s.ballT > 0 ? BALL_R : SHIP_RADIUS * 0.9;

// Trapped in a Bouncer ball: no control, heavier gravity, bounces off everything, rolls on the ground.
function ballShip(s) {
  if (!s.alive || s.invulnT > 0 || (isPractice() && PR.noDamage)) return;
  if (!(s.ballT > 0)) ballPop(s.x, s.y, 20);
  s.ballT = WEAPONS[BALL_IDX].ball;
  s.frozenT = 0; s.landed = false; s.onPad = false; s.thrust = 0;
  sfx.boing(s, 300);
  addShake(s, 0.4);
}
function ballPop(x, y, n) {
  for (let j = 0; j < n; j++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 140;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.35 + Math.random() * 0.3, j % 3 ? BALL_COL : WHITE, 0.3, 2.5 + Math.random() * 2.5);
  }
}
function stepBall(s, h) {
  s.ballT = Math.max(0, s.ballT - h);
  s.thrust = 0; s.landed = false; s.onPad = false;
  s.vy -= P.gravity * BALL_GRAV * h;
  const k = Math.exp(-P.linearDrag * 0.25 * h);
  s.vx *= k; s.vy *= k;
  const sp = Math.hypot(s.vx, s.vy), max = P.maxSpeed * 1.6;
  if (sp > max) { s.vx *= max / sp; s.vy *= max / sp; }
  s.x += s.vx * h; s.y += s.vy * h;
  s.a += s.av * h;
  resolveBall(s);
  if (s.ballT === 0) { ballPop(s.x, s.y, 24); s.av = 0; sfx.boing(s, 120); }
}
function resolveBall(s) {
  const R = BALL_R * P.shipSize;
  let nx = 0, ny = 0, impact = 0;
  // Map edges: bounce straight back.
  if (s.x < R) { s.x = R; nx += 1; } else if (s.x > W - R) { s.x = W - R; nx -= 1; }
  if (s.y < R) { s.y = R; ny += 1; } else if (s.y > H - R) { s.y = H - R; ny -= 1; }
  // Terrain: points around the rim; push out along the line from the touching points to the centre.
  let hits = 0, cx = 0, cy = 0;
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, x = s.x + Math.cos(a) * R, y = s.y + Math.sin(a) * R;
    if (solidAt(x, y)) { hits++; cx += x; cy += y; }
  }
  if (hits) {
    cx /= hits; cy /= hits;
    let tx = s.x - cx, ty = s.y - cy, l = Math.hypot(tx, ty);
    if (l < 1e-6) { const n = normalAt(cx, cy, s); tx = n.x; ty = n.y; } else { tx /= l; ty /= l; }
    let free = false;
    for (let k = 0; k < 40; k++) {
      s.x += tx * 0.75; s.y += ty * 0.75;
      let solid = false;
      for (let j = 0; j < 24 && !solid; j++) { const a = j / 24 * Math.PI * 2; solid = solidAt(s.x + Math.cos(a) * R, s.y + Math.sin(a) * R); }
      if (!solid) { free = true; break; }
    }
    if (!free) { s.x = s.px; s.y = s.py; }
    nx += tx; ny += ty;
  }
  const l = Math.hypot(nx, ny);
  if (l < 1e-6) return;
  nx /= l; ny /= l;
  const vn = s.vx * nx + s.vy * ny;
  if (vn >= 0) return;
  impact = -vn;
  const tvx = s.vx - vn * nx, tvy = s.vy - vn * ny;
  const bounce = impact < 18 ? 0 : BALL_BOUNCE;   // tiny bounces settle so it can roll
  s.vx = tvx * 0.97 + nx * impact * bounce;
  s.vy = tvy * 0.97 + ny * impact * bounce;
  s.av = -(s.vx * ny - s.vy * nx) / R;            // roll: spin matches speed along the surface
  if (impact > 40) {
    addShake(s, Math.min(0.6, impact / 600));
    if (hits) dust(s.x - nx * R, s.y - ny * R, { x: nx, y: ny }, impact * 0.6);
    sfx.boing(s, impact);
  }
}

function shipVsShip() {
  const a = ships[0], b = ships[1];
  if (!a.active || !b.active || !a.alive || !b.alive) return;
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  const R = (shipR(a) + shipR(b)) * P.shipSize;
  if (d >= R || d < 1e-6) return;
  const nx = dx / d, ny = dy / d, overlap = R - d;
  a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
  b.x += nx * overlap / 2; b.y += ny * overlap / 2;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv >= 0) return;
  const ma = shipMass(a), mb = shipMass(b);
  const j = -(1 + P.shipBounce) * rv / (1 / ma + 1 / mb);
  a.vx -= j / ma * nx; a.vy -= j / ma * ny;
  b.vx += j / mb * nx; b.vy += j / mb * ny;
  if (j > 5) { a.landed = false; b.landed = false; }
  if (j > 60) sfx.hit((a.x + b.x) / 2, (a.y + b.y) / 2);
}

/* ------------------------------------------------------------------ *
 * Bullets and particles (fixed pools, drawn as THREE.Points)
 * ------------------------------------------------------------------ */
const FIRE = new THREE.Color('#ff8f3d'), EMBER = new THREE.Color('#ffd166'), WHITE = new THREE.Color('#ffffff');
const ICE_COL = new THREE.Color(FREEZE_COLOR), HEAVY_COL = new THREE.Color(WEAPONS[1].color), BALL_COL = new THREE.Color(BALL_COLOR);
const DUST = new THREE.Color();

const MAXB = 600;
const B = {
  x: new Float32Array(MAXB), y: new Float32Array(MAXB), vx: new Float32Array(MAXB), vy: new Float32Array(MAXB),
  life: new Float32Array(MAXB), owner: new Int8Array(MAXB), on: new Uint8Array(MAXB), kind: new Uint8Array(MAXB), cursor: 0,
  tx: new Float32Array(MAXB), ty: new Float32Array(MAXB), tt: new Float32Array(MAXB),   // last point dropped on the trail
};
// Soft, round, additive points sized in world units (bullets and particles).
const pointScale = { value: 1 };
const POINT_VS = `
attribute float size; attribute vec3 tint;
uniform float uScale;
varying vec3 vTint;
void main() {
  vTint = tint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale;
}`;
const POINT_FS = `
uniform float uCore;
varying vec3 vTint;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = 1.0 - d; a *= a;
  float core = smoothstep(0.45, 0.0, d) * uCore;
  gl_FragColor = vec4(vTint * a + vec3(core), 1.0);
  #include <colorspace_fragment>
}`;
const pointMaterial = (core) => new THREE.ShaderMaterial({
  uniforms: { uScale: pointScale, uCore: { value: core } },
  vertexShader: POINT_VS, fragmentShader: POINT_FS,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
function pointGeo(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}
const bulletGeo = pointGeo(MAXB);
const bulletPts = new THREE.Points(bulletGeo, pointMaterial(0.9));
bulletPts.frustumCulled = false;
bulletPts.position.z = 2;
scene.add(bulletPts);
/* Fading trails: every bullet drops short ribbon pieces along its path. Each piece fades and thins on its own clock,
 * so the oldest end goes first and the trail slowly shrinks back toward the shot (and stays behind at the impact point
 * until it has faded out). Length and width per weapon: tLife / tWidth in WEAPONS. */
const MAXT = 12000, TRAIL_STEP = 6;
const TRAIL_STRENGTH = 0.18;
const TRAIL_START = 0.55;    // a fresh trail starts as if already this far into its fade (1 = full, lower = dimmer and thinner from the start)   // how strongly trails show (0 = invisible, 1 = full colour)
const TR = {
  x0: new Float32Array(MAXT), y0: new Float32Array(MAXT), t0: new Float32Array(MAXT),
  x1: new Float32Array(MAXT), y1: new Float32Array(MAXT), t1: new Float32Array(MAXT),
  life: new Float32Array(MAXT), w: new Float32Array(MAXT),
  r: new Float32Array(MAXT), g: new Float32Array(MAXT), b: new Float32Array(MAXT), cursor: 0,
};
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((MAXT + MAXB) * 18), 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((MAXT + MAXB) * 18), 3));
const trailMesh = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
trailMesh.frustumCulled = false;
trailMesh.position.z = 1.9;
scene.add(trailMesh);
const bulletColor = (i) => B.owner[i] >= 2 ? ENEMY_RED : B.kind[i] === 1 ? HEAVY_COL : B.kind[i] === 2 ? ICE_COL : B.kind[i] === BALL_IDX ? BALL_COL : ships[B.owner[i]].color;
// Drop a trail piece from the bullet's last trail point to where it is now (always when it ends, so the trail reaches the impact).
function trailPoint(i, end) {
  const dx = B.x[i] - B.tx[i], dy = B.y[i] - B.ty[i], d2 = dx * dx + dy * dy;
  if (d2 < 0.0001 || (!end && d2 < TRAIL_STEP * TRAIL_STEP)) return;
  const wp = WEAPONS[B.kind[i]], col = bulletColor(i), k = TR.cursor;
  TR.x0[k] = B.tx[i]; TR.y0[k] = B.ty[i]; TR.t0[k] = B.tt[i];
  TR.x1[k] = B.x[i]; TR.y1[k] = B.y[i]; TR.t1[k] = game.time;
  TR.life[k] = wp.tLife; TR.w[k] = wp.tWidth; TR.r[k] = col.r; TR.g[k] = col.g; TR.b[k] = col.b;
  TR.cursor = (k + 1) % MAXT;
  B.tx[i] = B.x[i]; B.ty[i] = B.y[i]; B.tt[i] = game.time;
}
// One ribbon quad (two triangles); f0/f1 = how fresh each end is (1 new, 0 gone): brightness and width follow it.
function trailQuad(p, c, n, x0, y0, f0, x1, y1, f1, w, r, g, b) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
  if (L < 0.01) return n;
  const nx = -dy / L, ny = dx / L;
  f0 *= TRAIL_START; f1 *= TRAIL_START;
  const w0 = w * (0.2 + 0.8 * f0) * 0.5, w1 = w * (0.2 + 0.8 * f1) * 0.5;
  const k0 = f0 * f0 * TRAIL_STRENGTH, k1 = f1 * f1 * TRAIL_STRENGTH;
  const ax = x0 + nx * w0, ay = y0 + ny * w0, bx = x0 - nx * w0, by = y0 - ny * w0;
  const cx = x1 + nx * w1, cy = y1 + ny * w1, ex = x1 - nx * w1, ey = y1 - ny * w1;
  const V = [ax, ay, k0, bx, by, k0, cx, cy, k1, cx, cy, k1, bx, by, k0, ex, ey, k1];
  let o = n * 18;
  for (let v = 0; v < 18; v += 3, o += 3) {
    p[o] = V[v]; p[o + 1] = V[v + 1]; p[o + 2] = 0;
    c[o] = r * V[v + 2]; c[o + 1] = g * V[v + 2]; c[o + 2] = b * V[v + 2];
  }
  return n + 1;
}

function spawnBullet(owner, x, y, vx, vy, life, kind = 0) {
  for (let k = 0; k < MAXB; k++) {
    const i = (B.cursor + k) % MAXB;
    if (!B.on[i]) {
      B.on[i] = 1; B.owner[i] = owner; B.x[i] = x; B.y[i] = y; B.vx[i] = vx; B.vy[i] = vy; B.life[i] = life; B.kind[i] = kind;
      B.tx[i] = x; B.ty[i] = y; B.tt[i] = game.time;
      B.cursor = (i + 1) % MAXB;
      return;
    }
  }
}
function clearBullets() { B.on.fill(0); SM.on.fill(0); TR.life.fill(0); }

function stepBullets(h) {
  for (let i = 0; i < MAXB; i++) {
    if (!B.on[i]) continue;
    const kind = B.kind[i], wp = WEAPONS[kind];
    B.life[i] -= h;
    if (B.life[i] <= 0) {
      B.on[i] = 0;
      trailPoint(i, true);
      if (kind === 1) explode(B.x[i], B.y[i], 1, B.owner[i]);   // the Cannon shell goes off when its fuse runs out
      else if (kind === 2) iceBurst(B.x[i], B.y[i], 6);
      else if (kind === BALL_IDX) ballPop(B.x[i], B.y[i], 8);
      continue;
    }
    B.vy[i] -= P.gravity * P.bulletGravity * wp.grav * h;
    if (kind === 1 && P.smoke && Math.random() < 0.5) emitSmoke(B.x[i], B.y[i], (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, P.smokeLife * 0.35, 5 + Math.random() * 3);
    if (kind === 2 && Math.random() < 0.35) emit(B.x[i], B.y[i], (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.35, ICE_COL, 0.2, 2 + Math.random() * 2);
    const dx = B.vx[i] * h, dy = B.vy[i] * h;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
    outer:
    for (let k = 0; k < n; k++) {
      B.x[i] += dx / n; B.y[i] += dy / n;
      const x = B.x[i], y = B.y[i];
      if (solidAt(x, y) || (level.theme === 'floors' && bulletHitsRock(x, y))) {
        if (kind === 2) iceBurst(x, y, 10); else if (kind === BALL_IDX) { ballPop(x, y, 10); sfx.rock(x, y); } else explode(x, y, kind, B.owner[i]);
        B.on[i] = 0; break;
      }
      const wh = wormHit(x, y);
      if (wh) {
        if (wh === 2) hurtWorm(); else for (let j = 0; j < 5; j++) emit(x, y, (Math.random() - 0.5) * 120, Math.random() * 100, 0.4, SAND, 1, 2 + Math.random() * 3);
        if (kind === 1) explode(x, y, 1, B.owner[i]);
        B.on[i] = 0; break;
      }
      if (dinoHit(x, y)) {
        killDino();
        if (kind === 1) explode(x, y, 1, B.owner[i]);
        B.on[i] = 0; break;
      }
      if (level.theme === 'ship' && B.owner[i] < 2 && bulletHitsEnemy(B.owner[i], x, y, P.bulletDamage * wp.damage, kind)) {
        if (kind === 1) explode(x, y, 1, B.owner[i]);
        B.on[i] = 0; break;
      }
      for (const s of ships) {
        if (s.id === B.owner[i] || !s.alive || ((level.theme === 'floors' || level.theme === 'ship') && B.owner[i] < 2)) continue;
        const r = (s.ballT > 0 ? BALL_R : SHIP_RADIUS) * P.shipSize + 2;
        if ((x - s.x) ** 2 + (y - s.y) ** 2 < r * r) {
          const sp = Math.hypot(B.vx[i], B.vy[i]) || 1;
          const m = shipMass(s);
          s.vx += B.vx[i] / sp * P.knockback * wp.knockback / m;
          s.vy += B.vy[i] / sp * P.knockback * wp.knockback / m;
          if (P.knockback > 0) s.landed = false;
          if (kind === 0) sfx.hit(x, y);
          damage(s, P.bulletDamage * wp.damage);
          if (kind === 2) freezeShip(s);
          if (kind === BALL_IDX) ballShip(s);
          if (kind === 1) explode(x, y, 1, B.owner[i], s);
          for (let j = 0; j < 8; j++) emit(x, y, (Math.random() - 0.5) * 180, (Math.random() - 0.5) * 180, 0.3, j % 2 ? (kind === 2 ? ICE_COL : s.color) : WHITE, 0.2);
          B.on[i] = 0;
          break outer;
        }
      }
    }
    trailPoint(i, !B.on[i]);
  }
}

// Ice shots don't dig: they shatter into frost.
function iceBurst(x, y, n) {
  sfx.tink(x, y);
  for (let j = 0; j < n; j++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 130;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.4, j % 3 ? ICE_COL : WHITE, 0.6, 2 + Math.random() * 3);
  }
  emit(x, y, 0, 0, 0.15, ICE_COL, 0, 16);
}
function freezeShip(s) {
  if (!s.alive || s.invulnT > 0 || (isPractice() && PR.noDamage) || s.ballT > 0) return;
  s.frozenT = WEAPONS[2].freeze;
  s.thrust = 0; s.av = 0;
  sfx.frost(s);
  iceBurst(s.x, s.y, 22);
  addShake(s, 0.4);
}
// The Cannon shell: a big crater, splash damage and a shove for any ship nearby.
function bigBlast(x, y, owner, direct) {
  const wp = WEAPONS[1];
  sfx.blast(x, y);
  if (level.theme === 'floors') { for (let k = 0; k < 6; k++) hitBreakable(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30); }
  else if (P.destructible) carve(x, y, P.holeRadius * wp.hole);
  const R = wp.blast;
  for (const s of ships) {
    if (!s.active || !s.alive || s === direct) continue;
    if ((level.theme === 'floors' || level.theme === 'ship') && owner < 2) continue;
    const ddx = s.x - x, ddy = s.y - y, d = Math.hypot(ddx, ddy);
    if (d > R) continue;
    const f = 1 - d / R;   // falloff; your own ship takes half
    damage(s, P.bulletDamage * wp.damage * 0.6 * f * (s.id === owner ? 0.5 : 1));
    const m = shipMass(s), push = 260 * f / m;
    s.vx += (ddx / (d || 1)) * push; s.vy += (ddy / (d || 1)) * push;
    s.landed = false;
  }
  if (level.theme === 'ship') {
    for (const e of SH.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < R + e.K.r) { e.hp -= P.bulletDamage * wp.damage * 0.5; e.flash = 0.08; if (e.hp <= 0 && owner < 2) killEnemy(e, ships[owner]); }
    }
    if (SH.spec && SH.spec.mode === 'robot' && owner < 2 && RB.on && !RB.dead && Math.hypot(RB.x - x, RB.y + 300 - y) < R + 150) hurtRobot(P.bulletDamage * wp.damage * 0.5, ships[owner]);
  }
  for (const s of ships) if (s.active && s.alive) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < 500) addShake(s, 1.1 * (1 - d / 500));
  }
  emit(x, y, 0, 0, 0.22, WHITE, 0, 60);
  emit(x, y, 0, 0, 0.35, FIRE, 0, 110);
  for (let j = 0; j < 40; j++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 320;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.35 + Math.random() * 0.6, j % 3 ? FIRE : EMBER, 0.5, 3 + Math.random() * 6);
  }
  if (P.smoke) for (let j = 0; j < 12; j++) {
    const a = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 80;
    emitSmoke(x, y, Math.cos(a) * sp, Math.sin(a) * sp, P.smokeLife * (0.7 + Math.random() * 0.5), 14 + Math.random() * 12);
  }
}
function explode(x, y, kind = 0, owner = -1, direct = null) {
  if (kind !== 1) sfx.rock(x, y);
  terrainDebris(x, y, kind === 1 ? 2.6 : 1);
  if (kind === 1) bigBlast(x, y, owner, direct);
  else if (level.theme === 'floors') hitBreakable(x, y);   // Floors walls can't be shot; only the orange blocks break
  else if (P.destructible) carve(x, y, P.holeRadius);
  const rc = groundRGB(y);
  DUST.setRGB(rc[0] / 255 * 1.6, rc[1] / 255 * 1.6, rc[2] / 255 * 1.6, THREE.SRGBColorSpace);
  emit(x, y, 0, 0, 0.14, EMBER, 0, 18);
  for (let j = 0; j < 7; j++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 140;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 + Math.random() * 0.3, j % 2 ? FIRE : EMBER, 0.3);
  }
}

function dust(x, y, n, impact) {
  const rc = groundRGB(y);
  DUST.setRGB(rc[0] / 255 * 1.6, rc[1] / 255 * 1.6, rc[2] / 255 * 1.6, THREE.SRGBColorSpace);
  const count = Math.min(14, 3 + impact / 30);
  for (let j = 0; j < count; j++) {
    const sp = 20 + Math.random() * impact * 0.4;
    emit(x, y, n.x * sp + (Math.random() - 0.5) * 80, n.y * sp + (Math.random() - 0.5) * 80, 0.4 + Math.random() * 0.4, DUST, 1);
  }
  const sf = surfaceAt(x, y);
  spray(x, y, n.x, n.y, terrainMaterial(sf.hard), clamp(impact / 350, 0.15, 0.7));
}

/* ------------------------------------------------------------------ *
 * Terrain debris: solid bits (normal blending, so dark rock still shows) that fly, bounce and settle,
 * plus soft dust puffs. Each terrain type breaks differently:
 *   rock  - angular chunks that bounce and settle, fine grit and a violet dust cloud
 *   soil  - (forest) dirt clumps that thud down, leaf bits that flutter off grassy tops
 *   sand  - (desert) a spray of fine grains that sink in where they land, and a big sandy haze
 *   metal - (Floors, Starship, hard walls and pads) hot sparks and a few bouncing steel flakes
 * ------------------------------------------------------------------ */
const MAXD = 3200;
// Overall debris tuning: how many bits each hit throws out, and how big they are (puffs grow less).
const DEBRIS_AMOUNT = 2, DEBRIS_SIZE = 1.7, PUFF_SIZE = 1.3;
const DB = {
  x: new Float32Array(MAXD), y: new Float32Array(MAXD), vx: new Float32Array(MAXD), vy: new Float32Array(MAXD),
  life: new Float32Array(MAXD), max: new Float32Array(MAXD), g: new Float32Array(MAXD), sz: new Float32Array(MAXD),
  r: new Float32Array(MAXD), gr: new Float32Array(MAXD), b: new Float32Array(MAXD),
  rot: new Float32Array(MAXD), spin: new Float32Array(MAXD), shape: new Uint8Array(MAXD),
  rest: new Float32Array(MAXD), bn: new Int8Array(MAXD), flut: new Float32Array(MAXD), stuck: new Uint8Array(MAXD),
  on: new Uint8Array(MAXD), cursor: 0,
};
const debGeo = new THREE.BufferGeometry();
debGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXD * 3), 3));
debGeo.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(MAXD * 3), 3));
for (const k of ['size', 'alpha', 'rot', 'shape']) debGeo.setAttribute(k, new THREE.BufferAttribute(new Float32Array(MAXD), 1));
const debPts = new THREE.Points(debGeo, new THREE.ShaderMaterial({
  uniforms: { uScale: pointScale },
  vertexShader: `
attribute float size; attribute vec3 tint; attribute float alpha; attribute float rot; attribute float shape;
uniform float uScale;
varying vec3 vTint; varying float vAlpha; varying float vRot; varying float vShape;
void main() {
  vTint = tint; vAlpha = alpha; vRot = rot; vShape = shape;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale;
}`,
  fragmentShader: `
varying vec3 vTint; varying float vAlpha; varying float vRot; varying float vShape;
void main() {
  vec2 p = gl_PointCoord - 0.5; p.y = -p.y;
  float c = cos(vRot), s = sin(vRot);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float light = 0.72 + 0.9 * (p.y - 0.45 * p.x);   // lit from above, like the terrain
  vec3 col = vTint; float a = 1.0;
  if (vShape < 0.5) {            // rock chunk: a rotated, lopsided shard with a cut corner
    vec2 k = abs(q) * vec2(1.0, 1.4);
    if (max(k.x, k.y) + 0.3 * max(q.x + q.y, 0.0) > 0.42) discard;
    col *= light;
  } else if (vShape < 1.5) {     // dirt clump
    if (length(q * vec2(1.0, 1.25)) > 0.45) discard;
    col *= light;
  } else if (vShape < 2.5) {     // leaf
    if (length(q * vec2(1.0, 2.8)) > 0.46) discard;
    col *= 0.85 + 0.45 * q.x;
  } else if (vShape < 3.5) {     // grain
    if (length(p) > 0.45) discard;
    col *= 0.8 + 0.5 * p.y;
  } else {                       // dust puff
    a = 1.0 - smoothstep(0.0, 0.5, length(p)); a *= a;
  }
  gl_FragColor = vec4(col, a * vAlpha);
  #include <colorspace_fragment>
}`,
  transparent: true,
  depthWrite: false,
}));
debPts.frustumCulled = false;
debPts.position.z = 0.9;
scene.add(debPts);

const DEB_COL = new THREE.Color();
function debris(x, y, vx, vy, life, rgb, shape, size, g, rest = 0, bounces = 0, flut = 0) {
  const i = DB.cursor;
  DB.cursor = (DB.cursor + 1) % MAXD;
  DEB_COL.setRGB(clamp(rgb[0], 0, 1), clamp(rgb[1], 0, 1), clamp(rgb[2], 0, 1), THREE.SRGBColorSpace);
  DB.on[i] = 1; DB.stuck[i] = 0;
  DB.x[i] = x; DB.y[i] = y; DB.vx[i] = vx; DB.vy[i] = vy;
  DB.life[i] = life; DB.max[i] = life; DB.g[i] = g; DB.sz[i] = size * (shape === 4 ? PUFF_SIZE : DEBRIS_SIZE);
  DB.r[i] = DEB_COL.r; DB.gr[i] = DEB_COL.g; DB.b[i] = DEB_COL.b;
  DB.rot[i] = Math.random() * 6.283; DB.spin[i] = (Math.random() - 0.5) * 24;
  DB.shape[i] = shape; DB.rest[i] = rest; DB.bn[i] = bounces; DB.flut[i] = flut;
}
function stepTerrainBits(h) {
  const air = Math.exp(-0.5 * h), leafAir = Math.exp(-2.6 * h), puffAir = Math.exp(-2.2 * h);
  for (let i = 0; i < MAXD; i++) {
    if (!DB.on[i]) continue;
    DB.life[i] -= h;
    if (DB.life[i] <= 0) { DB.on[i] = 0; continue; }
    if (DB.shape[i] === 4) {   // puffs drift, slow down and rise a little
      DB.vx[i] *= puffAir; DB.vy[i] *= puffAir; DB.vy[i] += 8 * h;
      DB.x[i] += DB.vx[i] * h; DB.y[i] += DB.vy[i] * h;
      continue;
    }
    if (DB.stuck[i]) { if (!solidAt(DB.x[i], DB.y[i] - 1.5)) DB.stuck[i] = 0; else continue; }   // falls again if its ledge is shot away
    if (DB.flut[i]) {          // leaves sway from side to side as they sink
      DB.vx[i] = DB.vx[i] * leafAir + Math.sin(DB.life[i] * 6 + i) * DB.flut[i] * h;
      DB.vy[i] *= leafAir;
    } else { DB.vx[i] *= air; DB.vy[i] *= air; }
    DB.vy[i] -= DB.g[i] * h;
    const nx = DB.x[i] + DB.vx[i] * h, ny = DB.y[i] + DB.vy[i] * h;
    if (solidAt(nx, ny)) {
      if (DB.bn[i] > 0) {
        DB.bn[i]--;
        if (solidAt(nx, DB.y[i])) { DB.vx[i] = -DB.vx[i] * DB.rest[i]; DB.vy[i] *= 0.7; }
        if (solidAt(DB.x[i], ny)) { DB.vy[i] = -DB.vy[i] * DB.rest[i]; DB.vx[i] *= 0.7; }
        DB.spin[i] *= -0.6;
      } else {                 // comes to rest on the surface and fades
        DB.stuck[i] = 1; DB.vx[i] = 0; DB.vy[i] = 0;
        DB.life[i] = Math.min(DB.life[i], 0.5 + Math.random() * 0.9);
      }
      continue;
    }
    DB.x[i] = nx; DB.y[i] = ny;
    DB.rot[i] += DB.spin[i] * h;
  }
}
function drawTerrainBits() {
  const A = debGeo.attributes;
  const pp = A.position.array, pc = A.tint.array, ps = A.size.array, pa = A.alpha.array, pr = A.rot.array, sh = A.shape.array;
  let n = 0;
  for (let i = 0; i < MAXD; i++) {
    if (!DB.on[i]) continue;
    const f = DB.life[i] / DB.max[i];
    pp[n * 3] = DB.x[i]; pp[n * 3 + 1] = DB.y[i]; pp[n * 3 + 2] = 0;
    pc[n * 3] = DB.r[i]; pc[n * 3 + 1] = DB.gr[i]; pc[n * 3 + 2] = DB.b[i];
    if (DB.shape[i] === 4) {
      const age = 1 - f;
      ps[n] = DB.sz[i] * (1 + 1.8 * age);
      pa[n] = 0.42 * f * Math.min(1, age * 10);
    } else {
      ps[n] = DB.sz[i];
      pa[n] = Math.min(1, f * 4);
    }
    pr[n] = DB.rot[i]; sh[n] = DB.shape[i];
    n++;
  }
  debGeo.setDrawRange(0, n);
  for (const k of ['position', 'tint', 'size', 'alpha', 'rot', 'shape']) A[k].needsUpdate = true;
}

// Which way the surface at (x, y) faces, how much solid is around, and whether it is a hard wall or pad.
function surfaceAt(x, y) {
  let nx = 0, ny = 0, solid = 0, hard = 0;
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6, ca = Math.cos(a), sa = Math.sin(a);
    for (const r of [4, 9]) {
      const m = maskAt(x + ca * r, y + sa * r);
      if (m) { solid++; nx -= ca; ny -= sa; if (m !== 1) hard++; }
    }
  }
  const l = Math.hypot(nx, ny);
  return { solid, hard: hard * 2 > solid, nx: l > 1e-3 ? nx / l : 0, ny: l > 1e-3 ? ny / l : 1 };
}
function terrainMaterial(hard) {
  if (hard || level.theme === 'floors' || level.theme === 'ship') return 'metal';
  if (level.theme === 'forest') return 'soil';
  if (level.theme === 'desert') return 'sand';
  return 'rock';
}
const rnd = (a, b) => a + Math.random() * (b - a);
const jitter = (c, j) => c.map((v) => v * (1 + (Math.random() - 0.5) * j));
// Throw out k "units" of material from a surface point facing (nx, ny).
function spray(x, y, nx, ny, mat, k) {
  const base = groundRGB(y).map((v) => v / 255);
  const ang0 = Math.atan2(ny, nx), sk = Math.sqrt(k);
  const ox = x + nx * 4, oy = y + ny * 4;
  const dir = (spread, s0, s1) => { const a = ang0 + (Math.random() - 0.5) * spread, sp = rnd(s0, s1) * sk; return [Math.cos(a) * sp, Math.sin(a) * sp]; };
  const count = (n) => Math.max(1, Math.round(n * k * DEBRIS_AMOUNT * (0.8 + Math.random() * 0.4)));
  if (mat === 'rock') {
    const lit = [0.86, 0.40, 0.46];
    for (let j = count(10); j-- > 0;) {
      const [vx, vy] = dir(2.6, 60, 250);
      const c = Math.random() < 0.3 ? jitter(lit, 0.25) : jitter(base.map((v) => v * 1.5 + 0.03), 0.35);
      debris(ox, oy, vx, vy, rnd(1.2, 2.4), c, 0, rnd(2.2, 4.8) * Math.min(1.5, sk), 430, 0.35, 2);
    }
    for (let j = count(8); j-- > 0;) {
      const [vx, vy] = dir(2.2, 80, 320);
      debris(ox, oy, vx, vy, rnd(0.5, 1.0), jitter(base.map((v) => v * 1.9 + 0.05), 0.3), 3, rnd(1.1, 1.9), 320);
    }
    for (let j = count(3); j-- > 0;) {
      const [vx, vy] = dir(2.0, 15, 50);
      debris(ox, oy, vx, vy, rnd(1.1, 2.0), [0.36 + base[0] * 0.4, 0.27 + base[1] * 0.4, 0.40 + base[2] * 0.4], 4, rnd(14, 26) * sk, 0);
    }
  } else if (mat === 'soil') {
    for (let j = count(9); j-- > 0;) {
      const [vx, vy] = dir(2.4, 50, 220);
      debris(ox, oy, vx, vy, rnd(1.0, 2.0), jitter(base.map((v) => v * 1.1), 0.4), 1, rnd(2.4, 5) * Math.min(1.5, sk), 400, 0.15, 1);
    }
    if (ny > 0.2) {   // grassy tops lose leaves and blades
      const greens = [[0.36, 0.70, 0.30], [0.55, 0.82, 0.38], [0.24, 0.52, 0.24], [0.80, 0.86, 0.40]];
      for (let j = count(6); j-- > 0;) {
        const [vx, vy] = dir(1.8, 40, 150);
        debris(ox, oy, vx, vy + 30, rnd(2.0, 3.6), jitter(greens[j % 4], 0.2), 2, rnd(3.5, 6), 45, 0, 0, rnd(160, 300));
      }
    }
    for (let j = count(2); j-- > 0;) {
      const [vx, vy] = dir(2.0, 12, 40);
      debris(ox, oy, vx, vy, rnd(1.0, 1.8), [0.42, 0.34, 0.25], 4, rnd(12, 22) * sk, 0);
    }
  } else if (mat === 'sand') {
    for (let j = count(30); j-- > 0;) {
      const [vx, vy] = dir(1.9, 60, 300);
      debris(ox, oy, vx, vy + 40, rnd(0.8, 1.7), jitter(base.map((v) => v * (Math.random() < 0.5 ? 1.05 : 0.8)), 0.15), 3, rnd(1.1, 2.2), 360);
    }
    for (let j = count(4); j-- > 0;) {
      const [vx, vy] = dir(2.2, 20, 70);
      debris(ox, oy, vx, vy + 10, rnd(1.6, 2.8), jitter([0.88, 0.70, 0.50], 0.08), 4, rnd(18, 34) * sk, 0);
    }
  } else {   // metal: sparks plus a few steel flakes
    for (let j = count(12); j-- > 0;) {
      const [vx, vy] = dir(2.0, 150, 430);
      emit(ox, oy, vx, vy, rnd(0.15, 0.42), j % 3 ? EMBER : WHITE, 20, rnd(2, 3.4) * DEBRIS_SIZE);
    }
    for (let j = count(3); j-- > 0;) {
      const [vx, vy] = dir(2.4, 60, 200);
      debris(ox, oy, vx, vy, rnd(1.0, 1.8), jitter([0.62, 0.64, 0.74], 0.2), 0, rnd(1.6, 2.6), 420, 0.55, 3);
    }
    const [vx, vy] = dir(1.5, 10, 30);
    debris(ox, oy, vx, vy, rnd(0.6, 1.0), [0.55, 0.55, 0.62], 4, rnd(8, 14) * sk, 0);
  }
}
// Debris from a hit at (x, y): call before carving, while the surface is still there.
function terrainDebris(x, y, k) {
  const sf = surfaceAt(x, y);
  if (sf.solid < 2) return;   // nothing solid here, e.g. a shell going off in the air
  spray(x, y, sf.nx, sf.ny, terrainMaterial(sf.hard), k);
}

const MAXP = 2500;
const PT = {
  x: new Float32Array(MAXP), y: new Float32Array(MAXP), vx: new Float32Array(MAXP), vy: new Float32Array(MAXP),
  life: new Float32Array(MAXP), max: new Float32Array(MAXP), g: new Float32Array(MAXP), sz: new Float32Array(MAXP),
  r: new Float32Array(MAXP), gr: new Float32Array(MAXP), b: new Float32Array(MAXP), on: new Uint8Array(MAXP), cursor: 0,
};
const partGeo = pointGeo(MAXP);
const partPts = new THREE.Points(partGeo, pointMaterial(0));
partPts.frustumCulled = false;
partPts.position.z = 1.5;
scene.add(partPts);

function emit(x, y, vx, vy, life, color, grav, size = 4) {
  const i = PT.cursor;
  PT.cursor = (PT.cursor + 1) % MAXP;
  PT.on[i] = 1; PT.x[i] = x; PT.y[i] = y; PT.vx[i] = vx; PT.vy[i] = vy;
  PT.life[i] = life; PT.max[i] = life; PT.g[i] = grav; PT.sz[i] = size;
  PT.r[i] = color.r; PT.gr[i] = color.g; PT.b[i] = color.b;
}
function stepParticles(h) {
  const drag = Math.exp(-1.5 * h);
  for (let i = 0; i < MAXP; i++) {
    if (!PT.on[i]) continue;
    PT.life[i] -= h;
    if (PT.life[i] <= 0) { PT.on[i] = 0; continue; }
    PT.vy[i] -= P.gravity * PT.g[i] * h;
    PT.vx[i] *= drag; PT.vy[i] *= drag;
    PT.x[i] += PT.vx[i] * h; PT.y[i] += PT.vy[i] * h;
    if (solidAt(PT.x[i], PT.y[i])) PT.on[i] = 0;
  }
}

// Smoke: soft grey puffs that drift, grow and fade slowly. Normal blending, drawn behind the ships.
const MAXS = 1500;
const SM = {
  x: new Float32Array(MAXS), y: new Float32Array(MAXS), vx: new Float32Array(MAXS), vy: new Float32Array(MAXS),
  life: new Float32Array(MAXS), max: new Float32Array(MAXS), sz: new Float32Array(MAXS), on: new Uint8Array(MAXS), cursor: 0,
};
const smokeGeo = new THREE.BufferGeometry();
smokeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXS * 3), 3));
smokeGeo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(MAXS), 1));
smokeGeo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(MAXS), 1));
const smokePts = new THREE.Points(smokeGeo, new THREE.ShaderMaterial({
  uniforms: { uScale: pointScale, uColor: { value: new THREE.Color('#8d779f') } },
  vertexShader: `
attribute float size; attribute float alpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale;
}`,
  fragmentShader: `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = 1.0 - d * d;
  gl_FragColor = vec4(uColor, a * a * vAlpha);
  #include <colorspace_fragment>
}`,
  transparent: true,
  depthWrite: false,
}));
smokePts.frustumCulled = false;
smokePts.position.z = 0.8;
scene.add(smokePts);

function emitSmoke(x, y, vx, vy, life, size) {
  const i = SM.cursor;
  SM.cursor = (SM.cursor + 1) % MAXS;
  SM.on[i] = 1; SM.x[i] = x; SM.y[i] = y; SM.vx[i] = vx; SM.vy[i] = vy;
  SM.life[i] = life; SM.max[i] = life; SM.sz[i] = size;
}
function stepSmoke(h) {
  const drag = Math.exp(-1.8 * h);
  for (let i = 0; i < MAXS; i++) {
    if (!SM.on[i]) continue;
    SM.life[i] -= h;
    if (SM.life[i] <= 0) { SM.on[i] = 0; continue; }
    SM.vx[i] *= drag;
    SM.vy[i] = SM.vy[i] * drag + 14 * h;   // a gentle rise
    const nx = SM.x[i] + SM.vx[i] * h, ny = SM.y[i] + SM.vy[i] * h;
    if (solidAt(nx, ny)) { SM.vx[i] = 0; SM.vy[i] = 0; }
    else { SM.x[i] = nx; SM.y[i] = ny; }
  }
}

/* ------------------------------------------------------------------ *
 * Forest planet: Jurassic plants and the cyan dinosaur
 * ------------------------------------------------------------------ */
const FOREST_SOIL = [104, 84, 56];
function groundRGB(y) { return level.theme === 'forest' ? FOREST_SOIL : level.theme === 'desert' ? DESERT_SAND : rowColor[clamp(Math.floor(H - y), 0, H - 1)]; }
const LEAF = new THREE.Color('#5fbf55');

// Plants: one vertex-coloured mesh per layer, rebuilt when a crater uproots a plant.
const plantMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
function plantLayer(z) {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), plantMat);
  m.position.z = z;
  m.frustumCulled = false;
  m.visible = false;
  scene.add(m);
  return m;
}
const backPlants = plantLayer(-0.6), frontPlants = plantLayer(0.4);
let plants = [];
const PCOL = { trunk: '#5a4128', fern: '#2f8a43', cycad: '#4f9d3f', horse: '#7fae45', node: '#3f5f22', conifer: '#1f5e3c', cone: '#a0663a', back: '#123430' };
const tint = (hex, back, rng) => new THREE.Color(back ? PCOL.back : hex).multiplyScalar(0.85 + rng() * 0.3);
function addTri(b, ax, ay, bx, by, cx, cy, c) {
  b.pos.push(ax, ay, 0, bx, by, 0, cx, cy, 0);
  b.col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
}
function addStrip(b, pts, ws, c) {
  const n = pts.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], e = pts[Math.min(n - 1, i + 1)];
    let dx = e[0] - a[0], dy = e[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const w = ws[i] / 2;
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
    R.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  for (let i = 0; i < n - 1; i++) {
    addTri(b, L[i][0], L[i][1], R[i][0], R[i][1], R[i + 1][0], R[i + 1][1], c);
    addTri(b, L[i][0], L[i][1], R[i + 1][0], R[i + 1][1], L[i + 1][0], L[i + 1][1], c);
  }
}
function addBlob(b, cx, cy, rx, ry, c, seg = 10) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    addTri(b, cx, cy, cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, c);
  }
}
// A leaf or frond: a tapering, drooping strip with a serrated edge.
function addLeaf(b, x0, y0, ang, len, droop, width, c, n, serr) {
  const pts = [], ws = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x0 + Math.cos(ang) * len * t, y0 + Math.sin(ang) * len * t - droop * len * t * t]);
    ws.push(width * (1 - 0.9 * t) * (i % 2 ? 1 : serr) + 0.3);
  }
  addStrip(b, pts, ws, c);
}
function treeFern(b, x, y, rng, k, back) {
  const h = (40 + rng() * 55) * k, lean = (rng() - 0.5) * 0.3;
  const pts = [], ws = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push([x + lean * h * t * t, y + h * t]);
    ws.push((6.5 - 2.5 * t) * k);
  }
  addStrip(b, pts, ws, tint(PCOL.trunk, back, rng));
  const [tx, ty] = pts[6];
  for (let j = 0; j < 9; j++) {
    const a = Math.PI * (0.06 + 0.88 * j / 8) + (rng() - 0.5) * 0.15;
    addLeaf(b, tx, ty, a, (26 + rng() * 18) * k, 0.35 + 0.35 * Math.abs(Math.cos(a)), 6 * k, tint(PCOL.fern, back, rng), 16, 0.4);
  }
  addBlob(b, tx, ty, 4 * k, 3 * k, tint(PCOL.node, back, rng), 8);
}
function cycad(b, x, y, rng, k, back) {
  const h = (8 + rng() * 14) * k;
  addStrip(b, [[x, y], [x, y + h]], [12 * k, 10 * k], tint(PCOL.trunk, back, rng));
  for (let j = 0; j < 9; j++) {
    const a = Math.PI * (0.1 + 0.8 * j / 8) + (rng() - 0.5) * 0.12;
    addLeaf(b, x, y + h, a, (20 + rng() * 12) * k, 0.18, 5 * k, tint(PCOL.cycad, back, rng), 12, 0.5);
  }
  addBlob(b, x, y + h + 2 * k, 4 * k, 5 * k, tint(PCOL.cone, back, rng), 8);
}
function horsetails(b, x, y, rng, k, back) {
  const n = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const sx = x + (rng() - 0.5) * 16 * k, h = (26 + rng() * 44) * k, lean = (rng() - 0.5) * 0.25;
    const top = [sx + lean * h, y + h];
    addStrip(b, [[sx, y], top], [2.6 * k, 1.8 * k], tint(PCOL.horse, back, rng));
    const nodeC = tint(PCOL.node, back, rng);
    for (let yy = 7 * k; yy < h - 4 * k; yy += 7 * k) {
      const px = sx + lean * yy, py = y + yy;
      addBlob(b, px, py, 1.9 * k, 0.8 * k, nodeC, 6);
      addTri(b, px, py, px - 5 * k, py + 3 * k, px - 4.5 * k, py + 3.8 * k, nodeC);
      addTri(b, px, py, px + 5 * k, py + 3 * k, px + 4.5 * k, py + 3.8 * k, nodeC);
    }
    addBlob(b, top[0], top[1] + 2.5 * k, 1.7 * k, 3.6 * k, tint(PCOL.cone, back, rng), 8);
  }
}
function araucaria(b, x, y, rng, k, back) {
  const h = (110 + rng() * 90) * k;
  addStrip(b, [[x, y], [x, y + h * 0.5], [x, y + h]], [8 * k, 5.5 * k, 2.5 * k], tint(PCOL.trunk, back, rng));
  const green = tint(PCOL.conifer, back, rng);
  for (let yy = h * 0.45; yy < h; yy += (12 + rng() * 5) * k) {
    const f = (yy - h * 0.45) / (h * 0.55);
    const len = (30 * (1 - f * 0.6) + rng() * 8) * k;
    for (const side of [-1, 1]) {
      const pts = [], ws = [];
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        pts.push([x + side * len * u, y + yy - len * 0.12 * u + len * 0.4 * u * u * u]);
        ws.push((5 - 2.5 * u) * k);
      }
      addStrip(b, pts, ws, green);
      addBlob(b, pts[6][0], pts[6][1] + 1.5 * k, 4 * k, 3.2 * k, green, 8);
    }
  }
  addBlob(b, x, y + h + 2 * k, 6 * k, 5 * k, green, 10);
}
// Exotic plants: helpers
function addDome(b, cx, cy, rx, ry, c, seg = 16) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI, a1 = (i + 1) / seg * Math.PI;
    addTri(b, cx, cy, cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, c);
  }
}
const pickOf = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const lighter = (c, f) => c.clone().lerp(new THREE.Color('#ffffff'), f);
// Alien palm: a curved, ringed trunk, long drooping fronds in odd colors and glowing fruit.
function alienPalm(b, x, y, rng, k, back) {
  const h = (70 + rng() * 70) * k, bend = (rng() - 0.5) * 0.7;
  const pts = [], ws = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([x + bend * h * t * t, y + h * t]); ws.push((7 - 3 * t) * k); }
  addStrip(b, pts, ws, tint('#6b4a2e', back, rng));
  const ring = tint('#3e2a18', back, rng);
  for (let i = 1; i < 10; i++) addBlob(b, pts[i][0], pts[i][1], ws[i] * 0.55, 1.1 * k, ring, 6);
  const [tx, ty] = pts[10];
  const frond = tint(pickOf(rng, ['#1fb59a', '#d1489c', '#3ccf6e', '#8a4fd8', '#e0a020']), back, rng);
  if (!back) for (let j = 0; j < 4; j++) addBlob(b, tx + (rng() - 0.5) * 10 * k, ty - (2 + rng() * 5) * k, 3 * k, 3.6 * k, new THREE.Color(pickOf(rng, ['#ffd23c', '#ff6f3d', '#7ff0ff'])), 8);
  for (let j = 0; j < 8; j++) {
    const a = Math.PI * (0.02 + 0.96 * j / 7) + (rng() - 0.5) * 0.2;
    addLeaf(b, tx, ty, a, (38 + rng() * 26) * k, 0.55 + 0.4 * Math.abs(Math.cos(a)), 9 * k, frond.clone().multiplyScalar(0.85 + rng() * 0.3), 18, 0.15);
  }
  addBlob(b, tx, ty, 5 * k, 4 * k, ring, 8);
}
// Dragon tree: a stout trunk that forks again and again under a wide umbrella crown.
function dragonTree(b, x, y, rng, k, back) {
  const trunk = tint('#8a6a52', back, rng);
  const h = (40 + rng() * 30) * k;
  addStrip(b, [[x, y], [x, y + h]], [11 * k, 8 * k], trunk);
  const tips = [];
  const branch = (bx, by, ang, len, w, d) => {
    const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
    addStrip(b, [[bx, by], [ex, ey]], [w, w * 0.75], trunk);
    if (d === 0) { tips.push([ex, ey]); return; }
    for (const s of [-1, 1]) branch(ex, ey, ang + s * (0.35 + rng() * 0.25), len * 0.72, w * 0.72, d - 1);
  };
  for (const s of [-1, 1]) branch(x, y + h, Math.PI / 2 + s * (0.45 + rng() * 0.2), 22 * k, 7 * k, 2);
  const crown = tint(pickOf(rng, ['#2e8f5a', '#b83a5e', '#2f9e9a', '#6d8f2a']), back, rng);
  let minX = Infinity, maxX = -Infinity, topY = -Infinity;
  for (const [tx, ty] of tips) { minX = Math.min(minX, tx); maxX = Math.max(maxX, tx); topY = Math.max(topY, ty); }
  const cx = (minX + maxX) / 2, rx = (maxX - minX) / 2 + 14 * k;
  addDome(b, cx, topY - 4 * k, rx, 20 * k, crown, 20);
  addBlob(b, cx, topY - 4 * k, rx, 4 * k, crown.clone().multiplyScalar(0.7), 16);
  for (let i = 0; i < 5; i++) addBlob(b, cx + (rng() - 0.5) * rx * 1.2, topY + (6 + rng() * 6) * k, (8 + rng() * 6) * k, (5 + rng() * 4) * k, crown.clone().multiplyScalar(1.05 + rng() * 0.15), 10);
}
// Spiral tree: a wavy trunk with curling branches that end in bright puffballs.
function spiralTree(b, x, y, rng, k, back) {
  const trunk = tint('#5b3b5e', back, rng);
  const h = (55 + rng() * 45) * k, ph = rng() * 6;
  const pts = [], ws = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([x + Math.sin(t * 7 + ph) * 5 * k * t, y + h * t]); ws.push((6 - 3.5 * t) * k); }
  addStrip(b, pts, ws, trunk);
  const [tx, ty] = pts[12];
  const puff = pickOf(rng, ['#ff6fb5', '#ff8a3d', '#b07cff', '#5fe0c0', '#ffd23c']);
  const n = 3 + Math.floor(rng() * 3);
  for (let j = 0; j < n; j++) {
    const side = j % 2 ? 1 : -1;
    const len = (22 + rng() * 18) * k, cp = [], cw = [];
    let px = tx, py = ty - j * 4 * k, a = Math.PI / 2 + side * (0.3 + rng() * 0.9);
    for (let i = 0; i <= 10; i++) { cp.push([px, py]); cw.push((3 - 2 * i / 10) * k); px += Math.cos(a) * len / 10; py += Math.sin(a) * len / 10; a += side * 0.2; }
    addStrip(b, cp, cw, trunk);
    const c = tint(puff, back, rng), [ex, ey] = cp[10], r = (7 + rng() * 5) * k;
    addBlob(b, ex, ey, r, r, c, 12);
    if (!back) addBlob(b, ex - r * 0.25, ey + r * 0.25, r * 0.5, r * 0.5, lighter(c, 0.35), 10);
  }
  const c = tint(puff, back, rng), r = (10 + rng() * 5) * k;
  addBlob(b, tx, ty + r * 0.6, r, r, c, 14);
  if (!back) addBlob(b, tx - r * 0.25, ty + r * 0.85, r * 0.5, r * 0.5, lighter(c, 0.35), 10);
}
// Giant mushrooms: a big one, sometimes with a couple of little ones beside it. [cap, spots, stem]
const SHROOMS = [['#e8332e', '#fff4e8', '#f2d8c0'], ['#9b4dff', '#f0c6ff', '#e8dcf5'], ['#ff8a2a', '#fff1c2', '#f5e6c8'], ['#22c7b8', '#e6fffb', '#d8efe8'], ['#3d6bff', '#dfe8ff', '#e2e6f2']];
function mushroom(b, x, y, rng, k, back, pal) {
  const cap = tint(pal[0], back, rng), spot = tint(pal[1], back, rng), stem = tint(pal[2], back, rng);
  const h = (45 + rng() * 55) * k, lean = (rng() - 0.5) * 12 * k;
  const pts = [[x, y], [x + lean * 0.3, y + h * 0.5], [x + lean, y + h]];
  addStrip(b, pts, [13 * k, 9 * k, 8 * k], stem);
  addBlob(b, x + lean * 0.6, y + h * 0.72, 9 * k, 2.6 * k, stem.clone().multiplyScalar(0.85), 10);   // ring on the stem
  const [cx, cy] = pts[2];
  const rx = (28 + rng() * 18) * k, ry = rx * (0.5 + rng() * 0.2);
  addBlob(b, cx, cy, rx * 0.92, 4 * k, cap.clone().multiplyScalar(0.55), 16);   // gills underneath
  addDome(b, cx, cy, rx, ry, cap, 20);
  if (back) return;
  addBlob(b, cx - rx * 0.35, cy + ry * 0.62, rx * 0.22, ry * 0.12, lighter(cap, 0.35), 10);   // shine
  const ns = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < ns; i++) {
    const u = Math.PI * (0.15 + 0.7 * rng()), f = 0.35 + rng() * 0.5, r = (2.5 + rng() * 3) * k;
    addBlob(b, cx + Math.cos(u) * rx * f, cy + Math.sin(u) * ry * f, r, r * 0.8, spot, 8);
  }
}
function giantMushroom(b, x, y, rng, k, back) {
  const pal = pickOf(rng, SHROOMS);
  const n = 1 + Math.floor(rng() * 3);
  for (let m = n - 1; m >= 0; m--) {
    const s = m === 0 ? 1 : 0.35 + rng() * 0.25;
    const mx = m === 0 ? x : x + (m % 2 ? 1 : -1) * (16 + rng() * 10) * k;
    mushroom(b, mx, y, rng, k * s, back, pal);
  }
}
const PLANT_KINDS = [[0.12, cycad], [0.22, horsetails], [0.3, treeFern], [0.48, alienPalm], [0.63, dragonTree], [0.79, spiralTree], [1.01, giantMushroom]];
const SMALL_PLANTS = [cycad, horsetails, treeFern];

// World y of the ground top under x (scanning up from the bottom frame).
function surfaceY(x) {
  const c = clamp(Math.floor(x), 0, W - 1);
  let r = H - 17;
  while (r > 0 && level.mask[r * W + c] !== 0) r--;
  return H - r - 1;
}
function setLayer(mesh, b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.col), 3));
  mesh.geometry.dispose();
  mesh.geometry = g;
}
function rebuildFrontPlants() {
  const all = { pos: [], col: [] };
  for (const p of plants) {
    if (!p.alive) continue;
    for (const v of p.buf.pos) all.pos.push(v);
    for (const v of p.buf.col) all.col.push(v);
  }
  setLayer(frontPlants, all);
}
function buildPlants() {
  const rng = mulberry32((P.seed | 0) * 31 + 5);
  const back = { pos: [], col: [] };
  for (let x = 40; x < W - 40; x += 60 + rng() * 80) {
    pickOf(rng, [alienPalm, dragonTree, giantMushroom, spiralTree, araucaria])(back, x, surfaceY(x) - 30, rng, 1.5 + rng() * 0.6, true);
  }
  setLayer(backPlants, back);
  plants = [];
  for (let x = 30; x < W - 30; x += 26 + rng() * 50) {
    const y = surfaceY(x), r = rng();
    const make = PLANT_KINDS.find((kd) => r < kd[0])[1];
    const buf = { pos: [], col: [] };
    make(buf, x, y - 2, rng, 0.8 + rng() * 0.4, false);
    plants.push({ x, y, alive: true, buf });
  }
  // Smaller trees on the floating islands, leaving the minigun spot clear.
  for (const is of level.islands || []) {
    for (let x = is.x - is.hw + 18; x < is.x + is.hw - 18; x += 24 + rng() * 24) {
      if (Math.abs(x - W / 2) < 34) continue;
      const y = topBelow(x, is.top + 60);
      if (y < is.top - 40) continue;
      const r = rng();
      const make = PLANT_KINDS.find((kd) => r < kd[0])[1];
      const buf = { pos: [], col: [] };
      make(buf, x, y - 2, rng, SMALL_PLANTS.includes(make) ? 0.6 + rng() * 0.25 : 0.45 + rng() * 0.18, false);
      plants.push({ x, y, alive: true, buf });
    }
  }
  rebuildFrontPlants();
}
// World y of the first solid ground at or below (x, y).
function topBelow(x, y) {
  while (y > 0 && !solidAt(x, y)) y -= 1;
  return y + 1;
}
// A crater under a plant knocks it over in a burst of leaves.
function plantsAfterCarve(x, y, r) {
  let changed = false;
  for (const p of plants) {
    if (!p.alive || Math.abs(p.x - x) > r + 6 || Math.abs(p.y - y) > r + 8) continue;
    if (solidAt(p.x, p.y - 3)) continue;
    p.alive = false;
    changed = true;
    for (let i = 0; i < 12; i++) emit(p.x + (Math.random() - 0.5) * 16, p.y + Math.random() * 30, (Math.random() - 0.5) * 90, 40 + Math.random() * 90, 0.6 + Math.random() * 0.5, LEAF, 1, 3 + Math.random() * 3);
  }
  if (changed) rebuildFrontPlants();
}

// The dinosaur: a small cyan T-rex with black eyes, built from flat shapes. Faces +x; feet at y = 0.
const DINO_S = 0.85, DINO_SPEED = 330, DINO_EVERY = 10;
const dinoMats = {};
for (const [k, hex] of Object.entries({ body: '#2fe6f0', far: '#1aa3b4', stripe: '#1cb8c8', mouth: '#0b3640', eye: '#000000', tooth: '#f4fbff' })) {
  dinoMats[k] = new THREE.MeshBasicMaterial({ color: hex, transparent: true, side: THREE.DoubleSide });
}
function smoothGeo(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  s.splineThru(pts.slice(1).map((p) => new THREE.Vector2(p[0], p[1])));
  return new THREE.ShapeGeometry(s, 4);
}
function dMesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, dinoMats[mat]);
  m.position.set(x, y, z);
  return m;
}
function makeDinoLeg(mat, z) {
  const hip = new THREE.Group();
  hip.position.set(-2, 30, z);
  hip.add(dMesh(smoothGeo([[-7, 3], [0, 8], [7, 3], [6, -7], [3, -15], [-1, -16], [-5, -9], [-7, 3]]), mat));
  const knee = new THREE.Group();
  knee.position.set(1, -14, 0.001);
  knee.add(dMesh(shapeGeo([[-3, 1], [2.5, 1], [2.5, -12], [-1.5, -13]]), mat));
  const ankle = new THREE.Group();
  ankle.position.set(0.5, -12.5, 0.002);
  ankle.add(dMesh(shapeGeo([[-2.5, 1.5], [2, 1.5], [9, -1], [10, -3], [-3, -3]]), mat));
  knee.add(ankle);
  hip.add(knee);
  return { hip, knee, ankle };
}
const dinoRoot = new THREE.Group();
dinoRoot.visible = false;
scene.add(dinoRoot);
const dinoRig = new THREE.Group();
dinoRoot.add(dinoRig);
const dinoLegs = [makeDinoLeg('far', -0.03), makeDinoLeg('body', 0.03)];
const DINO_ARM = [[0, 0], [5, -3], [7, -6], [5, -7], [3, -4], [-1, -2]];
const dinoArms = [dMesh(shapeGeo(DINO_ARM), 'far', 21, 38, -0.02), dMesh(shapeGeo(DINO_ARM), 'body', 18, 37, 0.04)];
const dinoTorso = dMesh(smoothGeo([[-50, 31], [-34, 36], [-16, 41], [0, 45], [12, 48], [20, 54], [27, 52], [24, 42], [16, 32], [6, 26], [-6, 25], [-20, 28], [-36, 30], [-50, 31]]), 'body');
const dinoStripes = [[-34, 33.5, 3.2], [-22, 37, 3.6], [-10, 40.5, 3.8], [2, 43, 3.4]].map(([x, y, r]) => {
  const m = dMesh(new THREE.CircleGeometry(r, 12), 'stripe', x, y, 0.005);
  m.scale.y = 0.55;
  return m;
});
const dinoHead = new THREE.Group();
dinoHead.position.set(22, 50, 0.01);
dinoHead.add(dMesh(smoothGeo([[-6, 4], [0, 11], [10, 13], [19, 10], [23, 6], [22, 2], [12, 1], [2, 0], [-5, -2], [-6, 4]]), 'body'));
dinoHead.add(dMesh(shapeGeo([[3, 1.5], [22, 2], [20, -6], [6, -5]]), 'mouth', 0, 0, -0.005));
dinoHead.add(dMesh(new THREE.CircleGeometry(2.4, 16), 'eye', 9, 8, 0.01));
dinoHead.add(dMesh(new THREE.CircleGeometry(0.8, 8), 'mouth', 20, 7, 0.01));
for (let x = 8; x <= 20; x += 3) dinoHead.add(dMesh(shapeGeo([[x, 1.4], [x + 1.6, 1.4], [x + 0.8, -1.5]]), 'tooth', 0, 0, 0.004));
const dinoJaw = new THREE.Group();
dinoJaw.position.set(4, 0.5, 0.008);
dinoJaw.add(dMesh(smoothGeo([[-1, 0.8], [8, 0.9], [17, 0.8], [16, -2], [8, -5], [0, -4], [-2, -1], [-1, 0.8]]), 'body'));
for (let x = 5; x <= 15; x += 3) dinoJaw.add(dMesh(shapeGeo([[x, 0.6], [x + 1.4, 0.6], [x + 0.7, 2.6]]), 'tooth', 0, 0, -0.001));
dinoHead.add(dinoJaw);
dinoRig.add(dinoLegs[0].hip, dinoArms[0], dinoTorso, ...dinoStripes, dinoHead, dinoLegs[1].hip, dinoArms[1]);
// Rare mushroom dino (every fifth run): white dots, little mushrooms growing on its back and a mushroom hat.
for (const [k, hex] of Object.entries({ dot: '#ffffff', shCap: '#e8332e', shStem: '#f2e3c6', sh1: '#ff8a2a', sh2: '#9b4dff', sh3: '#22c7b8' })) {
  dinoMats[k] = new THREE.MeshBasicMaterial({ color: hex, transparent: true, side: THREE.DoubleSide });
}
const domeGeo = (r) => new THREE.CircleGeometry(r, 18, 0, Math.PI);
function tinyShroom(x, y, h, r, cap, tilt) {
  const g = new THREE.Group();
  g.position.set(x, y, 0.006); g.rotation.z = tilt;
  g.add(dMesh(shapeGeo([[-1.1, -1], [1.1, -1], [0.9, h], [-0.9, h]]), 'shStem'));
  const c = dMesh(domeGeo(r), cap, 0, h, 0.002); c.scale.y = 0.75; g.add(c);
  g.add(dMesh(new THREE.CircleGeometry(r * 0.22, 8), 'dot', -r * 0.35, h + r * 0.35, 0.004));
  g.add(dMesh(new THREE.CircleGeometry(r * 0.16, 8), 'dot', r * 0.3, h + r * 0.2, 0.004));
  return g;
}
const dinoShroom = new THREE.Group();
dinoShroom.visible = false;
for (const [x, y, r] of [[-40, 32, 1.3], [-28, 33.5, 1.8], [-14, 34, 2.1], [0, 37, 2.4], [-6, 30, 1.5], [12, 39, 1.9], [8, 44, 1.5]]) dinoShroom.add(dMesh(new THREE.CircleGeometry(r, 12), 'dot', x, y, 0.007));
dinoShroom.add(tinyShroom(-44, 31, 5, 4, 'sh1', 0.25), tinyShroom(-30, 34.5, 8, 6, 'sh2', 0.1), tinyShroom(-15, 39, 6, 5, 'sh3', -0.05), tinyShroom(-2, 43.5, 9, 6.5, 'sh1', -0.15));
dinoRig.add(dinoShroom);
const dinoHat = new THREE.Group();
dinoHat.position.set(10, 12.5, 0.02); dinoHat.rotation.z = 0.12; dinoHat.visible = false;
const hatGills = dMesh(new THREE.CircleGeometry(11, 16), 'shStem', 0, 0, -0.002); hatGills.scale.y = 0.16;
const hatCap = dMesh(domeGeo(13), 'shCap'); hatCap.scale.y = 0.8;
dinoHat.add(hatGills, hatCap);
for (const [x, y, r] of [[-6, 4, 1.8], [0, 7.5, 2.2], [6, 3.5, 1.9], [-1.5, 2.2, 1.1], [9.5, 1.3, 1]]) dinoHat.add(dMesh(new THREE.CircleGeometry(r, 10), 'dot', x, y, 0.003));
dinoHead.add(dinoHat);

const DINO = { active: false, x: 0, y: 0, px: 0, py: 0, dir: -1, next: 4, phase: 0, open: 0.1, chew: 0, burp: 0, alpha: 0 };
function resetDino() {
  DINO.active = false; DINO.next = 4; DINO.chew = 0; DINO.burp = 0;
  dinoRoot.visible = false;
  dinoCount = 0;
}
function groundUnder(x, y) {
  if (solidAt(x, y)) { for (let k = 0; k < 120 && solidAt(x, y); k++) y += 1; return y; }
  for (let k = 0; k < 900 && y > 0 && !solidAt(x, y - 1); k++) y -= 1;
  return y;
}
const dinoMouth = () => ({ x: DINO.x + DINO.dir * 46 * DINO_S, zx: DINO.x + DINO.dir * 54 * DINO_S, y: DINO.y + 53 * DINO_S });
function eatShip(s, m) {
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 160;
    emit(m.zx, m.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.5, i % 3 ? s.color : WHITE, 0.4, 2 + Math.random() * 4);
  }
  kill(s, true);
  addShake(s, 1.4);
  DINO.open = 0; DINO.chew = 0.7; DINO.burp = 0.9;
}
// One shot kills the dino: is the point (x, y) inside its body?
const DINO_COL = new THREE.Color('#2fe6f0');
// Each run the dino gets a new color: [body, far side, stripes, eye].
const DINO_PALETTES = [
  ['#ff4a4a', '#c22a2a', '#a51d1d', '#000000'],   // red
  ['#2fe6f0', '#1aa3b4', '#1cb8c8', '#000000'],   // cyan
  ['#4fdc5a', '#2e9e3a', '#2a8a34', '#000000'],   // green
  ['#2a2a2e', '#141416', '#46464f', '#ffd23c'],   // black (yellow eyes so you can see them)
  ['#f4f4f6', '#c4c4ca', '#d2d2d8', '#000000'],   // white
  ['#3d7bff', '#2552c2', '#2a5ad8', '#000000'],   // blue
  ['#a85cff', '#7434c4', '#8440d8', '#000000'],   // purple
  ['#9a9aa2', '#6c6c74', '#7e7e86', '#000000'],   // grey
  ['#ff9a2e', '#c96a14', '#d4761c', '#000000'],   // orange
];
const RARE_PAL = ['#d8342c', '#9e2420', '#d8342c', '#000000'];   // mushroom red, stripes hidden under the dots
let dinoPal = 1, dinoCount = 0;
function recolorDino() {
  dinoCount++;
  const rare = dinoCount % 5 === 0;
  dinoShroom.visible = dinoHat.visible = rare;
  if (!rare) {
    let k = Math.floor(Math.random() * (DINO_PALETTES.length - 1));
    if (k >= dinoPal) k++;   // never the same color twice in a row
    dinoPal = k;
  }
  const [body, far, stripe, eye] = rare ? RARE_PAL : DINO_PALETTES[dinoPal];
  dinoMats.body.color.set(body); dinoMats.far.color.set(far);
  dinoMats.stripe.color.set(stripe); dinoMats.eye.color.set(eye);
  DINO_COL.set(body);
}
function dinoHit(x, y) {
  if (level.theme !== 'forest' || !DINO.active || DINO.alpha < 0.3) return false;
  const lx = (x - DINO.x) * DINO.dir / DINO_S, ly = (y - DINO.y) / DINO_S;
  return lx > -52 && lx < 48 && ly > -2 && ly < 76;
}
function killDino() {
  const cx = DINO.x - DINO.dir * 4 * DINO_S, cy = DINO.y + 36 * DINO_S;
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 220;
    emit(cx + (Math.random() - 0.5) * 50 * DINO_S, cy + (Math.random() - 0.5) * 40 * DINO_S, Math.cos(a) * sp, Math.sin(a) * sp + 60, 0.5 + Math.random() * 0.6, i % 3 ? DINO_COL : WHITE, 0.6, 3 + Math.random() * 4);
  }
  emit(cx, cy, 0, 0, 0.2, WHITE, 0, 60);
  if (P.smoke) for (let i = 0; i < 8; i++) emitSmoke(cx, cy, (Math.random() - 0.5) * 60, 20 + Math.random() * 40, 1.2 + Math.random(), 8 + Math.random() * 6);
  for (const s of ships) if (s.active) addShake(s, 0.5);
  DINO.active = false; DINO.chew = 0; DINO.burp = 0;
  dinoRoot.visible = false;
}
function stepDino(h) {
  // A new run starts every DINO_EVERY seconds, alternating left and right.
  DINO.next -= h;
  if (DINO.next <= 0) {
    DINO.next += DINO_EVERY;
    DINO.dir = -DINO.dir;
    DINO.x = DINO.dir > 0 ? 24 : W - 24;
    DINO.y = groundUnder(DINO.x, 420);
    DINO.px = DINO.x; DINO.py = DINO.y;
    DINO.phase = 0; DINO.open = 0.1; DINO.chew = 0; DINO.alpha = 0;
    DINO.active = true;
    recolorDino();
  }
  if (DINO.burp > 0) {
    DINO.burp -= h;
    if (DINO.burp <= 0 && DINO.active) {
      const m = dinoMouth();
      for (let i = 0; i < 6; i++) emitSmoke(m.zx, m.y, DINO.dir * (20 + Math.random() * 30), 10 + Math.random() * 20, 1.6 + Math.random(), 6 + Math.random() * 5);
    }
  }
  if (!DINO.active) return;
  DINO.px = DINO.x; DINO.py = DINO.y;
  DINO.x += DINO.dir * DINO_SPEED * h;
  DINO.phase += h * 15;
  const target = groundUnder(DINO.x, DINO.y + 24);
  DINO.y += (target - DINO.y) * Math.min(1, h * 25);
  const fromWall = DINO.dir > 0 ? DINO.x - 16 : W - 16 - DINO.x;
  const toWall = DINO.dir > 0 ? W - 16 - DINO.x : DINO.x - 16;
  DINO.alpha = clamp(Math.min(fromWall, toWall) / 60, 0, 1);
  if (toWall <= 0) { DINO.active = false; return; }
  if (Math.random() < h * 18) {
    const g = groundRGB(DINO.y);
    DUST.setRGB(g[0] / 255 * 1.6, g[1] / 255 * 1.6, g[2] / 255 * 1.6, THREE.SRGBColorSpace);
    emit(DINO.x - DINO.dir * 8, DINO.y + 2, -DINO.dir * (30 + Math.random() * 50), 20 + Math.random() * 40, 0.4 + Math.random() * 0.3, DUST, 1, 3 + Math.random() * 3);
  }
  // Jaws open wide when a rocket is ahead; anything right in front of the mouth gets eaten.
  const m = dinoMouth();
  let threat = false;
  for (const s of ships) {
    if (!s.active || !s.alive) continue;
    const ahead = (s.x - m.x) * DINO.dir;
    if (ahead > -12 && ahead < 170 && Math.abs(s.y - m.y) < 80) threat = true;
    const R = 16 * DINO_S + SHIP_RADIUS * P.shipSize * 0.8;
    if (DINO.alpha > 0.5 && (s.x - m.zx) ** 2 + (s.y - m.y) ** 2 < R * R) eatShip(s, m);
  }
  if (DINO.chew > 0) { DINO.chew -= h; DINO.open = 0.12 * Math.abs(Math.sin(DINO.chew * 28)); }
  else DINO.open = approach(DINO.open, threat ? 0.75 : 0.1 + 0.06 * Math.sin(DINO.phase * 0.5), h * 6);
}
// The minigun pickup: floats on the middle island. Fly into it for 30 s of very fast fire.
const MINIGUN_TIME = 30, MINIGUN_RATE = 4, MINIGUN_BACK = 20;
const PU = { active: false, x: 0, y: 0, respawn: 0 };
const puGroup = new THREE.Group();
puGroup.visible = false;
scene.add(puGroup);
{
  const flat = (color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), glowMat(new THREE.Color('#ffcf4a'), 0.45));
  const ring = new THREE.Mesh(new THREE.RingGeometry(17, 19.5, 40, 1, 0, Math.PI * 1.6), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  const gun = new THREE.Group();
  gun.add(new THREE.Mesh(shapeGeo([[-7, -4], [-3, -4], [-5, -10], [-9, -10]]), flat('#2a2d3e')));
  gun.add(new THREE.Mesh(shapeGeo([[-4, -4], [0, -4], [-1, -9], [-3, -9]]), flat('#d9a43a')));
  const body = new THREE.Mesh(shapeGeo([[-10, -4], [4, -4], [6, -2], [6, 4], [-10, 4]]), flat('#3b3f55'));
  body.position.z = 0.01;
  const band = new THREE.Mesh(shapeGeo([[-1, -4.5], [2, -4.5], [2, 4.5], [-1, 4.5]]), flat('#ffcc33'));
  band.position.z = 0.02;
  gun.add(body, band);
  for (const y of [-2.6, 0, 2.6]) {
    const b = new THREE.Mesh(shapeGeo([[6, y - 0.9], [17, y - 0.9], [17, y + 0.9], [6, y + 0.9]]), flat('#b6bcd4'));
    b.position.z = 0.015;
    gun.add(b);
  }
  gun.scale.setScalar(1.25);
  gun.position.x = -3;
  glow.position.z = -0.02;
  ring.position.z = -0.01;
  puGroup.add(glow, ring, gun);
  PU.ring = ring;
  PU.gun = gun;
}
// Three little barrels on a ship's nose while it has the minigun.
for (const s of ships) {
  const g = new THREE.Group();
  for (const x of [-2.2, 0, 2.2]) {
    const b = new THREE.Mesh(shapeGeo([[x - 0.7, 6], [x + 0.7, 6], [x + 0.7, 18], [x - 0.7, 18]]), new THREE.MeshBasicMaterial({ color: '#c3c8dc', transparent: true }));
    g.add(b);
  }
  g.position.z = 0.05;
  g.visible = false;
  s.group.add(g);
  s.gunMesh = g;
}
const PU_SPARK = new THREE.Color('#ffe066');
function resetPickup() {
  PU.active = level.theme === 'forest';
  PU.respawn = 0;
  if (PU.active) { PU.x = W / 2; PU.y = topBelow(W / 2, H - 60) + 22; }
}
function stepPickup(h) {
  if (!PU.active) {
    if (PU.respawn > 0) {
      PU.respawn -= h;
      if (PU.respawn <= 0) {
        PU.active = true;
        for (let i = 0; i < 20; i++) { const a = Math.random() * Math.PI * 2; emit(PU.x, PU.y, Math.cos(a) * 90, Math.sin(a) * 90, 0.5, PU_SPARK, 0, 4); }
      }
    }
    return;
  }
  for (const s of ships) {
    if (!s.active || !s.alive || Math.hypot(s.x - PU.x, s.y - PU.y) > 26 * Math.max(1, P.shipSize)) continue;
    s.minigunT = MINIGUN_TIME;
    PU.active = false;
    PU.respawn = MINIGUN_BACK;
    for (let i = 0; i < 36; i++) { const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160; emit(PU.x, PU.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.4 + Math.random() * 0.4, i % 2 ? PU_SPARK : WHITE, 0, 3 + Math.random() * 4); }
    showToast(`${s.id === 0 ? 'Player 1' : 'Player 2'} got the minigun!`, '30 seconds of super-fast shooting.');
    break;
  }
}
function drawPickup(now) {
  puGroup.visible = PU.active && level.theme === 'forest';
  if (puGroup.visible) {
    puGroup.position.set(PU.x, PU.y + Math.sin(now / 400) * 3, 1.2);
    PU.ring.rotation.z = now / 500;
    PU.ring.material.opacity = 0.55 + 0.3 * Math.sin(now / 200);
    PU.gun.rotation.z = Math.sin(now / 700) * 0.15;
  }
  for (const s of ships) s.gunMesh.visible = s.alive && s.minigunT > 0;
}

function poseDinoLeg(L, ph) {
  const s = Math.sin(ph), c = Math.cos(ph);
  L.hip.rotation.z = 0.25 + s * 0.65;
  L.knee.rotation.z = -0.55 - Math.max(0, c) * 0.7;
  L.ankle.rotation.z = -(L.hip.rotation.z + L.knee.rotation.z) - 0.1 + Math.max(0, -c) * 0.4;
}
function drawDino(a) {
  dinoRoot.visible = DINO.active;
  if (!DINO.active) return;
  dinoRoot.position.set(DINO.px + (DINO.x - DINO.px) * a, DINO.py + (DINO.y - DINO.py) * a, 0.95);
  dinoRoot.scale.set(DINO.dir * DINO_S, DINO_S, 1);
  const ph = DINO.phase;
  poseDinoLeg(dinoLegs[1], ph);
  poseDinoLeg(dinoLegs[0], ph + Math.PI);
  dinoRig.position.y = Math.abs(Math.sin(ph)) * 2 - 1;
  dinoRig.rotation.z = 0.03 * Math.sin(ph * 2);
  dinoArms[0].rotation.z = 0.3 * Math.sin(ph + 1);
  dinoArms[1].rotation.z = 0.3 * Math.sin(ph + 1 + Math.PI);
  dinoHead.rotation.z = 0.05 * Math.sin(ph * 2) + DINO.open * 0.3;
  dinoJaw.rotation.z = -DINO.open;
  for (const mat of Object.values(dinoMats)) mat.opacity = DINO.alpha;
}

/* ------------------------------------------------------------------ *
 * Dune sea: cacti, bones and the giant sandworm
 * ------------------------------------------------------------------ */
const DESERT_SAND = [222, 170, 112];
const SAND = new THREE.Color('#e3b47c'), SAND_DK = new THREE.Color('#b98552'), FLESH = new THREE.Color('#ef8a96');
const dcol = (hex, back, rng) => new THREE.Color(back ? '#4c2c46' : hex).multiplyScalar(0.85 + rng() * 0.3);
function saguaro(b, x, y, rng, k, back) {
  const c = dcol('#3f8f52', back, rng), rib = back ? c : lighter(c, 0.2);
  const h = (70 + rng() * 60) * k, w = 12 * k;
  const arms = 1 + Math.floor(rng() * 2.4);
  for (let j = 0; j < arms; j++) {
    const s = j % 2 ? 1 : -1, ay = y + h * (0.32 + rng() * 0.3), up = (20 + rng() * 18) * k;
    addStrip(b, [[x, ay], [x + s * 10 * k, ay], [x + s * 16 * k, ay + 6 * k], [x + s * 16 * k, ay + up]], [9 * k, 9 * k, 9 * k, 8 * k], c);
    addBlob(b, x + s * 16 * k, ay + up, 4 * k, 4 * k, c, 10);
  }
  addStrip(b, [[x, y], [x, y + h]], [w, w * 0.9], c);
  addBlob(b, x, y + h, w * 0.45, w * 0.45, c, 12);
  if (back) return;
  for (const o of [-2.8, 0, 2.8]) addStrip(b, [[x + o * k, y + 4 * k], [x + o * k, y + h - 2 * k]], [1.3 * k, 1.1 * k], rib);
  if (rng() < 0.5) addBlob(b, x, y + h + 4 * k, 3.5 * k, 2.6 * k, new THREE.Color(pickOf(rng, ['#ff6fb5', '#fff1a8', '#ff8a3d'])), 10);
}
function pricklyPear(b, x, y, rng, k, back) {
  const c = dcol('#5aa05a', back, rng);
  const pads = [[0, 11, 8, 11]];
  const n = 2 + Math.floor(rng() * 3);
  for (let j = 0; j < n; j++) {
    const p = pads[Math.floor(rng() * pads.length)];
    const s = rng() < 0.5 ? -1 : 1;
    pads.push([p[0] + s * p[2] * (0.5 + rng() * 0.4), p[1] + p[3] * (0.8 + rng() * 0.3), p[2] * 0.85, p[3] * 0.85]);
  }
  for (const [px, py, rx, ry] of pads) {
    addBlob(b, x + px * k, y + py * k, rx * k, ry * k, c.clone().multiplyScalar(0.9 + rng() * 0.2), 14);
    if (!back) for (let q = 0; q < 3; q++) addBlob(b, x + (px + (rng() - 0.5) * rx) * k, y + (py + (rng() - 0.5) * ry) * k, 0.7 * k, 0.7 * k, new THREE.Color('#e9f2c8'), 5);
  }
  if (!back) for (const [px, py, , ry] of pads.slice(1)) if (rng() < 0.6) addBlob(b, x + px * k, y + (py + ry) * k, 2.2 * k, 2.8 * k, new THREE.Color('#e8334e'), 8);
}
function barrelCactus(b, x, y, rng, k, back) {
  const n = 1 + Math.floor(rng() * 3);
  for (let j = 0; j < n; j++) {
    const s = (j === 0 ? 1 : 0.6 + rng() * 0.25) * k, bx = x + (j === 0 ? 0 : (j % 2 ? 1 : -1) * 14 * k);
    const c = dcol('#4f9a5e', back, rng);
    addBlob(b, bx, y + 10 * s, 10 * s, 12 * s, c, 16);
    if (back) continue;
    for (const o of [-5, 0, 5]) addStrip(b, [[bx + o * s, y + 1 * s], [bx + o * 0.8 * s, y + 20 * s]], [1.2 * s, 1.2 * s], lighter(c, 0.22));
    addBlob(b, bx, y + 21 * s, 4.5 * s, 2.5 * s, new THREE.Color(pickOf(rng, ['#ffd23c', '#ff8a3d', '#ff5a7a'])), 10);
  }
}
function dryShrub(b, x, y, rng, k, back) {
  const c = dcol('#8a6a44', back, rng);
  for (let j = 0; j < 9; j++) {
    const a = Math.PI * (0.15 + 0.7 * rng()), len = (14 + rng() * 16) * k;
    const mx = x + Math.cos(a) * len * 0.5, my = y + Math.sin(a) * len * 0.5;
    addStrip(b, [[x, y], [mx, my], [x + Math.cos(a + 0.2) * len, y + Math.sin(a + 0.2) * len]], [2 * k, 1.4 * k, 0.6 * k], c);
    addStrip(b, [[mx, my], [mx + Math.cos(a - 0.6) * len * 0.4, my + Math.sin(a - 0.6) * len * 0.4]], [1.1 * k, 0.5 * k], c);
  }
}
// The bones of a long-dead sandworm: a spine with ribs arching over the sand and a big round skull.
function wormBones(b, x, y, rng, k, back) {
  const c = dcol('#efe4cc', back, rng), dark = back ? c : c.clone().multiplyScalar(0.75);
  const len = (90 + rng() * 40) * k, n = 6, s = rng() < 0.5 ? -1 : 1;
  const sp = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; sp.push([x - s * len / 2 + s * len * t, y + 3 * k + Math.sin(t * Math.PI) * 6 * k]); }
  for (let j = 0; j < n; j++) {
    const t = (j + 1) / (n + 1), rx = x - s * len / 2 + s * len * t, hgt = (30 - 12 * Math.abs(t - 0.4)) * k, wd = 9 * k;
    const pts = [];
    for (let i = 0; i <= 8; i++) { const u = i / 8 * Math.PI; pts.push([rx - Math.cos(u) * wd, y + Math.sin(u) * hgt]); }
    addStrip(b, pts, pts.map(() => 3 * k), c);
  }
  addStrip(b, sp, sp.map(() => 4 * k), dark);
  const hx = x + s * (len / 2 + 10 * k);
  addBlob(b, hx, y + 11 * k, 14 * k, 11 * k, c, 16);
  if (back) return;
  addBlob(b, hx + s * 8 * k, y + 9 * k, 4.5 * k, 6 * k, new THREE.Color('#3a2230'), 12);
  addBlob(b, hx - s * 2 * k, y + 14 * k, 2.4 * k, 2.4 * k, new THREE.Color('#3a2230'), 8);
}
function rockSpire(b, x, y, rng, k, back) {
  const h = (120 + rng() * 120) * k, w = (24 + rng() * 14) * k;
  const pts = [], ws = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([x + Math.sin(t * 3 + x) * 4 * k, y + h * t]); ws.push(w * (1 - 0.55 * t) * (i % 2 ? 1 : 0.88)); }
  addStrip(b, pts, ws, dcol('#9a5a44', back, rng));
  addBlob(b, pts[6][0], pts[6][1], ws[6] * 0.7, 5 * k, dcol('#9a5a44', back, rng), 10);
}
const DESERT_KINDS = [[0.3, saguaro], [0.48, barrelCactus], [0.66, pricklyPear], [0.9, dryShrub], [1.01, wormBones]];
function buildDesertPlants() {
  const rng = mulberry32((P.seed | 0) * 37 + 11);
  const back = { pos: [], col: [] };
  for (let x = 40; x < W - 40; x += 70 + rng() * 90) {
    pickOf(rng, [saguaro, saguaro, rockSpire, rockSpire, wormBones])(back, x, surfaceY(x) - 30, rng, 1.5 + rng() * 0.6, true);
  }
  setLayer(backPlants, back);
  plants = [];
  let bones = 0;
  for (let x = 30; x < W - 30; x += 34 + rng() * 60) {
    const y = surfaceY(x), r = rng();
    let make = DESERT_KINDS.find((kd) => r < kd[0])[1];
    if (make === wormBones && bones++ >= 2) make = dryShrub;
    const buf = { pos: [], col: [] };
    make(buf, x, y - 2, rng, 0.8 + rng() * 0.4, false);
    plants.push({ x, y, alive: true, buf });
  }
  rebuildFrontPlants();
}

// The sandworm: every WORM_EVERY seconds the sand rumbles, then it bursts out, arcs through the air and dives back in.
const WORM_N = 24, WORM_GAP = 13, WORM_R = 24, WORM_G = 820, WORM_EVERY = 12, WORM_RUMBLE = 1.6;
const WORM = { state: 'off', t: 7, x: 0, gy: 0, hx: 0, hy: 0, vx: 0, vy: 0, hp: 3, flash: 0, open: 0.4, gulp: 0, life: 0, air: false, entered: false, seg: [], prev: [] };
for (let i = 0; i < WORM_N; i++) { WORM.seg.push([0, 0]); WORM.prev.push([0, 0]); }
const wormR = (i) => WORM_R * (1 - 0.6 * i / (WORM_N - 1));
const wormMats = {};
for (const [k, hex] of Object.entries({ body: '#c98f6b', ring: '#a5674c', light: '#e8b892', head: '#b8735a', gum: '#a8384e', mouth: '#3a0f1c', tooth: '#fff4e0' })) wormMats[k] = new THREE.MeshBasicMaterial({ color: hex });
const WORM_HEAD = new THREE.Color('#b8735a');
const unitCircle = new THREE.CircleGeometry(1, 22);
const wormRoot = new THREE.Group();
wormRoot.position.z = -0.32;   // behind the terrain, so it really looks like it comes out of the sand
wormRoot.visible = false;
scene.add(wormRoot);
const wormSegs = [];
function wCircle(mat, r, x, y, z, sx = 1) {
  const m = new THREE.Mesh(unitCircle, wormMats[mat]);
  m.scale.set(r * sx, r, 1); m.position.set(x, y, z);
  return m;
}
for (let i = 0; i < WORM_N; i++) {
  const g = new THREE.Group(), r = wormR(i);
  g.position.z = (WORM_N - i) * 0.002;
  if (i === 0) {
    g.add(wCircle('head', r * 1.12, 0, 0, 0), wCircle('light', r * 0.45, -r * 0.25, r * 0.45, 0.0004));
    const mouth = new THREE.Group();
    mouth.position.set(r * 0.72, 0, 0.0008);
    mouth.add(wCircle('gum', r * 0.95, 0, 0, 0, 0.42), wCircle('mouth', r * 0.72, 0, 0, 0.0002, 0.38));
    for (let j = 0; j < 12; j++) {
      const a = j / 12 * Math.PI * 2, ex = Math.cos(a) * r * 0.36, ey = Math.sin(a) * r * 0.85;
      const t = new THREE.Mesh(shapeGeo([[ex - Math.sin(a) * 2.2, ey + Math.cos(a) * 2.2], [ex + Math.sin(a) * 2.2, ey - Math.cos(a) * 2.2], [ex * 0.55, ey * 0.55]]), wormMats.tooth);
      t.position.z = 0.0004;
      mouth.add(t);
    }
    g.add(mouth);
    g.userData.mouth = mouth;
  } else {
    g.add(wCircle(i % 2 ? 'body' : 'ring', r, 0, 0, 0), wCircle('light', r * 0.42, -r * 0.18, r * 0.42, 0.0004));
  }
  wormSegs.push(g);
  wormRoot.add(g);
}
function resetWorm() {
  WORM.state = 'off'; WORM.t = 7; WORM.flash = 0;
  wormRoot.visible = false;
}
function pickWormX() {
  const bad = (x) => x < 90 || x > W - 90 || level.spawns.some((p) => Math.abs(p.x - x) < 120) || (level.mesas || []).some((mx) => Math.abs(mx - x) < 130);
  const alive = ships.filter((s) => s.active && s.alive);
  for (let k = 0; k < 16; k++) {
    const x = alive.length && k < 8 && Math.random() < 0.7 ? alive[Math.floor(Math.random() * alive.length)].x + (Math.random() - 0.5) * 120 : 90 + Math.random() * (W - 180);
    if (!bad(x)) return x;
  }
  return W / 2;
}
const wormUnder = (x, y) => y < 0 || solidAt(x, y);
function sandBurst(x, y, n, up = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.1 + 0.8 * Math.random()), sp = 60 + Math.random() * 260;
    emit(x + (Math.random() - 0.5) * 40, y, Math.cos(a) * sp, Math.sin(a) * sp * up, 0.6 + Math.random() * 0.7, i % 4 ? SAND : SAND_DK, 1, 3 + Math.random() * 5);
  }
}
function launchWorm() {
  const x = WORM.x, gy = WORM.gy;
  let best = null, bd = Infinity;
  for (const s of ships) if (s.active && s.alive && Math.abs(s.x - x) < bd) { bd = Math.abs(s.x - x); best = s; }
  const peak = best && bd < 250 ? clamp(best.y - gy + 50, 200, 540) : 240 + Math.random() * 220;
  WORM.vy = Math.sqrt(2 * WORM_G * peak);
  let dir = x < W / 2 ? 1 : -1;
  if (Math.random() < 0.3) dir = -dir;
  WORM.vx = dir * (110 + Math.random() * 150);
  WORM.hx = x; WORM.hy = gy - 30;
  const sp = Math.hypot(WORM.vx, WORM.vy);
  for (let i = 0; i < WORM_N; i++) {
    WORM.seg[i][0] = x - WORM.vx / sp * i * WORM_GAP; WORM.seg[i][1] = WORM.hy - WORM.vy / sp * i * WORM_GAP;
    WORM.prev[i][0] = WORM.seg[i][0]; WORM.prev[i][1] = WORM.seg[i][1];
  }
  WORM.state = 'fly'; WORM.hp = 3; WORM.life = 0; WORM.air = false; WORM.entered = false; WORM.open = 0.4; WORM.gulp = 0;
  if (P.destructible) carve(x, gy - 6, 30);
  sandBurst(x, gy, 60);
  if (P.smoke) for (let i = 0; i < 6; i++) emitSmoke(x + (Math.random() - 0.5) * 50, gy + 10, (Math.random() - 0.5) * 60, 30 + Math.random() * 40, 1.4 + Math.random(), 9 + Math.random() * 6);
  for (const s of ships) if (s.active && Math.abs(s.x - x) < 500) addShake(s, 0.8);
}
function hurtWorm() {
  WORM.hp--; WORM.flash = 0.15;
  for (let i = 0; i < 10; i++) emit(WORM.hx, WORM.hy, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.4, i % 2 ? FLESH : WHITE, 0.5, 3 + Math.random() * 3);
  if (WORM.hp <= 0) killWorm();
}
function killWorm() {
  for (let i = 0; i < WORM_N; i += 2) {
    const [x, y] = WORM.seg[i];
    if (wormUnder(x, y)) continue;
    for (let j = 0; j < 7; j++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 200;
      emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp + 50, 0.5 + Math.random() * 0.6, j % 3 ? FLESH : SAND, 0.7, 3 + Math.random() * 5);
    }
  }
  emit(WORM.hx, WORM.hy, 0, 0, 0.25, WHITE, 0, 80);
  if (P.smoke) for (let i = 0; i < 8; i++) emitSmoke(WORM.hx, WORM.hy, (Math.random() - 0.5) * 60, 20 + Math.random() * 40, 1.2 + Math.random(), 8 + Math.random() * 6);
  for (const s of ships) if (s.active) addShake(s, 0.7);
  WORM.state = 'off'; WORM.t = WORM_EVERY;
  wormRoot.visible = false;
}
// 2 = the head (that's where it gets hurt), 1 = the body (shots just thud into it), 0 = a miss.
function wormHit(x, y) {
  if (level.theme !== 'desert' || WORM.state !== 'fly') return 0;
  const R = WORM_R * 1.15;
  if ((x - WORM.hx) ** 2 + (y - WORM.hy) ** 2 < R * R) return 2;
  for (let i = 1; i < WORM_N; i++) {
    const [sx, sy] = WORM.seg[i], r = wormR(i);
    if ((x - sx) ** 2 + (y - sy) ** 2 < r * r) return 1;
  }
  return 0;
}
function stepWorm(h) {
  for (const s of ships) s.wormT = Math.max(0, (s.wormT || 0) - h);
  if (WORM.state === 'off') {
    WORM.t -= h;
    if (WORM.t <= 0) { WORM.x = pickWormX(); WORM.gy = surfaceY(WORM.x); WORM.state = 'rumble'; WORM.t = WORM_RUMBLE; }
    return;
  }
  if (WORM.state === 'rumble') {
    WORM.t -= h;
    const f = 1 - WORM.t / WORM_RUMBLE;
    if (Math.random() < h * (20 + 60 * f)) {
      emit(WORM.x + (Math.random() - 0.5) * (30 + 50 * f), WORM.gy + 2, (Math.random() - 0.5) * 60, 50 + Math.random() * 150 * (0.4 + f), 0.4 + Math.random() * 0.4, Math.random() < 0.5 ? SAND : SAND_DK, 1, 2 + Math.random() * 4);
    }
    for (const s of ships) if (s.active && Math.abs(s.x - WORM.x) < 350) addShake(s, 0.1 + 0.25 * f);
    if (WORM.t <= 0) launchWorm();
    return;
  }
  // Flying: the head follows a big arc and the body follows the head.
  WORM.life += h;
  for (let i = 0; i < WORM_N; i++) { WORM.prev[i][0] = WORM.seg[i][0]; WORM.prev[i][1] = WORM.seg[i][1]; }
  WORM.vy -= WORM_G * h;
  WORM.hx += WORM.vx * h; WORM.hy += WORM.vy * h;
  WORM.seg[0][0] = WORM.hx; WORM.seg[0][1] = WORM.hy;
  for (let i = 1; i < WORM_N; i++) {
    const a = WORM.seg[i - 1], b = WORM.seg[i];
    const dx = a[0] - b[0], dy = a[1] - b[1], d = Math.hypot(dx, dy);
    if (d > WORM_GAP) { b[0] = a[0] - dx / d * WORM_GAP; b[1] = a[1] - dy / d * WORM_GAP; }
  }
  const headIn = wormUnder(WORM.hx, WORM.hy);
  if (!WORM.air && !headIn && WORM.hy > WORM.gy + 10) WORM.air = true;
  if (WORM.air && headIn && !WORM.entered && WORM.vy < 0) {
    WORM.entered = true;
    if (P.destructible) carve(WORM.hx, WORM.hy + 6, 28);
    sandBurst(WORM.hx, WORM.hy + 4, 40);
    for (const s of ships) if (s.active && Math.abs(s.x - WORM.hx) < 400) addShake(s, 0.5);
  }
  if (Math.random() < h * 25) {   // sand pouring off its back
    const i = 1 + Math.floor(Math.random() * (WORM_N - 1)), [sx, sy] = WORM.seg[i];
    if (!wormUnder(sx, sy)) emit(sx, sy, (Math.random() - 0.5) * 30, -20, 0.8, SAND, 1, 2 + Math.random() * 3);
  }
  let near = false;
  for (const s of ships) {
    if (!s.active || !s.alive) continue;
    const sr = SHIP_RADIUS * P.shipSize * 0.8;
    const dh = Math.hypot(s.x - WORM.hx, s.y - WORM.hy);
    if (dh < 220) near = true;
    if (!headIn && dh < WORM_R * 1.12 + sr) {
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 160;
        emit(s.x, s.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.5, i % 3 ? s.color : WHITE, 0.4, 2 + Math.random() * 4);
      }
      kill(s, true);
      addShake(s, 1.4);
      WORM.gulp = 0.6;
      continue;
    }
    for (let i = 2; i < WORM_N; i++) {
      const [sx, sy] = WORM.seg[i], r = wormR(i);
      if (wormUnder(sx, sy)) continue;
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < r + sr) {
        const nx = (s.x - sx) / (d || 1), ny = (s.y - sy) / (d || 1);
        s.vx += nx * 260 / shipMass(s); s.vy += (ny * 260 + 60) / shipMass(s);
        s.landed = false;
        if (!(s.wormT > 0)) { damage(s, 15); s.wormT = 0.5; addShake(s, 0.5); }
        break;
      }
    }
  }
  WORM.flash = Math.max(0, WORM.flash - h);
  if (WORM.gulp > 0) { WORM.gulp -= h; WORM.open = 0.15 * Math.abs(Math.sin(WORM.gulp * 25)); }
  else WORM.open = approach(WORM.open, near ? 1 : 0.4, h * 5);
  const done = WORM.life > 1 && WORM.seg.every(([sx, sy]) => wormUnder(sx, sy));
  if (done || WORM.life > 7) { WORM.state = 'off'; WORM.t = WORM_EVERY; wormRoot.visible = false; }
}
function drawWorm(a) {
  wormRoot.visible = level.theme === 'desert' && WORM.state === 'fly';
  if (!wormRoot.visible) return;
  for (let i = 0; i < WORM_N; i++) {
    const p = WORM.prev[i], q = WORM.seg[i];
    wormSegs[i].position.x = p[0] + (q[0] - p[0]) * a;
    wormSegs[i].position.y = p[1] + (q[1] - p[1]) * a;
  }
  const head = wormSegs[0];
  head.rotation.z = Math.atan2(WORM.vy, WORM.vx);
  head.userData.mouth.scale.y = 0.35 + 0.65 * WORM.open;
  wormMats.head.color.copy(WORM.flash > 0 ? WHITE : WORM_HEAD);
}

function applyTheme() {
  const f = level.theme === 'forest' ? 1 : 0, dz = level.theme === 'desert' ? 1 : 0;
  skyMat.uniforms.uForest.value = f;
  levelMat.uniforms.uForest.value = f;
  skyMat.uniforms.uDesert.value = dz;
  levelMat.uniforms.uDesert.value = dz;
  backPlants.visible = frontPlants.visible = !!(f || dz);
  if (f) buildPlants(); else if (dz) buildDesertPlants(); else plants = [];
  resetDino(); resetWorm();
  resetPickup();
  resetBoxes();
  levelMat.uniforms.uSteel.value = level.theme === 'floors' || level.theme === 'ship' ? 1 : 0;
  if (level.theme === 'ship') buildStarship(); else clearStarship();
  if (level.theme === 'floors') { buildFloors(); resetLava(0); resetLava(1); }
  else clearFloors();
}

/* ------------------------------------------------------------------ *
 * Floors: a race up two hallways with lava rising behind you
 * ------------------------------------------------------------------ */
const BLOCK_HP = 5;
const FL = { spec: null, lava: [-60, -60], v: [0, 0], delay: [0, 0], asteroids: [], blocks: [], wrecks: [], halls: [[0, 0], [0, 0]], finish: 1e9, toastTimer: 0 };
const FL_GROUP = new THREE.Group();
scene.add(FL_GROUP);
function canvasTex(w, h, draw) {
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
const girderMat = sharedMat({ map: hazardTex }), lipMat = sharedMat({ color: '#8a8fb0' }), finishMat = sharedMat({ map: finishTex });
const wreckMat = sharedMat({ color: '#5d6178', side: THREE.DoubleSide }), wreckDarkMat = sharedMat({ color: '#45485c', side: THREE.DoubleSide });
const rockMat = sharedMat({ color: '#7d6b5d', side: THREE.DoubleSide }), craterMat = sharedMat({ color: '#5c4e44' });
const CRATE_BITS = new THREE.Color('#ff8a3d');

// Lava: one animated sheet per hallway, with a glow above its surface.
const LAVA_VS = `varying vec2 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xy; gl_Position = projectionMatrix * viewMatrix * w; }`;
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
function resetLava(i) {
  FL.lava[i] = -60;
  FL.v[i] = P.lavaSpeed;
  FL.delay[i] = P.lavaDelay;
}

function clearFloors() {
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
function stripedPlane(w, h, tileW) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * w / tileW);
  return g;
}
function buildFloors() {
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
const bulletHitsRock = (x, y) => FL.asteroids.some((a) => (x - a.x) ** 2 + (y - a.y) ** 2 < a.r * a.r);
function hitBreakable(x, y) {
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
function showToast(title, text) {
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
function stepFloors(h) {
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
function drawFloors(now) {
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

/* ------------------------------------------------------------------ *
 * Starship: co-op waves of red robot ships, the raygun on the roof, the boss and the escape
 * ------------------------------------------------------------------ */
const ENEMY_RED = new THREE.Color('#ff4d5e');
const WAVES = [
  { bots: 1 }, { bots: 3 }, { bots: 5 }, { bots: 8 }, { bots: 10 },
  { bots: 5, juggs: 2 }, { bots: 5, juggs: 2, raygun: true }, { boss: true },
];
const EKIND = {
  bot: { hp: 24, r: 13, speed: 210, keep: 260, scale: 1.15, fire: [1.1, 1.8], laser: 0, shots: 1 },
  jugg: { hp: 160, r: 27, speed: 120, keep: 340, scale: 2.4, fire: [1.4, 2.0], laser: 5, shots: 2 },
  boss: { hp: 720, r: 50, speed: 85, keep: 420, scale: 4.4, fire: [0.5, 0.7], laser: 5, shots: 3 },
};
const LASER_WARN = 0.9, LASER_FIRE = 0.35, LASER_DAMAGE = 40;
const SH = { spec: null, wave: -1, state: 'off', timer: 0, pending: [], spawnT: 0, spawnIdx: 0, enemies: [], lasers: [], time: 0, deaths: 0, door: 0, doorOpen: false, lastText: '' };
const RG = { x: 900, y: 0, ang: -Math.PI / 2, active: false, cd: 3, laser: null, barrel: null, light: null };
const SHIP_GROUP = new THREE.Group();
scene.add(SHIP_GROUP);
const cargoTex = canvasTex(64, 64, (g) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#c9cfdb'; for (let x = 8; x < 60; x += 9) g.fillRect(x, 4, 4, 56);
  g.strokeStyle = '#59606f'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, 59, 59);
  g.fillStyle = '#ffcc33'; g.fillRect(5, 5, 10, 4); g.fillRect(49, 55, 10, 4);
});
// Ammo boxes: fly into one to refill your ammo; each comes back 12 seconds after it is taken.
const AMMO_BACK = 12;
const ammoTex = canvasTex(32, 24, (g) => {
  g.fillStyle = '#4f5d3a'; g.fillRect(0, 0, 32, 24);
  g.strokeStyle = '#2c3520'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 29, 21);
  g.fillStyle = '#ffcc33';
  for (const x of [8, 14, 20]) { g.fillRect(x, 9, 4, 9); g.beginPath(); g.arc(x + 2, 9, 2, Math.PI, 0); g.fill(); }
  g.fillStyle = '#c98a1e';
  for (const x of [8, 14, 20]) g.fillRect(x, 16, 4, 2);
});
const AMMO_SPARK = new THREE.Color('#ffcc33');
let AM = [];
function buildAmmo() {
  AM = SH.spec.ammo.map(([x, y]) => {
    const g = new THREE.Group();
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(56, 56), glowMat(AMMO_SPARK, 0.35));
    const box = new THREE.Mesh(new THREE.PlaneGeometry(26, 19), new THREE.MeshBasicMaterial({ map: ammoTex }));
    box.position.z = 0.01;
    g.add(glow, box);
    g.position.set(x, y + 16, 1.1);
    SHIP_GROUP.add(g);
    return { x, y: y + 16, g, on: true, t: 0 };
  });
}
function stepAmmo(h) {
  for (const a of AM) {
    if (!a.on) { a.t -= h; if (a.t <= 0) a.on = true; continue; }
    for (const s of ships) {
      if (!s.active || !s.alive || s.ammo >= P.ammoMax - 0.5) continue;
      if (Math.hypot(s.x - a.x, s.y - a.y) > 24 * Math.max(1, P.shipSize)) continue;
      s.ammo = P.ammoMax;
      s.msg = 'Ammo refilled!';
      s.msgUntil = game.time + 1.5;
      a.on = false;
      a.t = AMMO_BACK;
      for (let i = 0; i < 18; i++) { const ang = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 120; emit(a.x, a.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.4, i % 2 ? AMMO_SPARK : WHITE, 0.3, 3 + Math.random() * 3); }
      break;
    }
  }
}
// Medkits: only three on the ship. Fly into one to heal to full; each comes back 25 seconds after it is taken.
const MEDKIT_BACK = 25;
const medTex = canvasTex(32, 32, (g) => {
  g.fillStyle = '#c9ced9'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#f7f8fb'; g.fillRect(2, 2, 28, 28);
  g.fillStyle = '#e8283c'; g.fillRect(12, 6, 8, 20); g.fillRect(6, 12, 20, 8);
});
const MED_SPARK = new THREE.Color('#5dff8a');
let MK = [];
function buildMedkits() {
  MK = SH.spec.medkits.map(([x, y]) => {
    const g = new THREE.Group();
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), glowMat(MED_SPARK, 0.35));
    const box = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: medTex }));
    box.position.z = 0.01;
    g.add(glow, box);
    g.position.set(x, y + 17, 1.1);
    SHIP_GROUP.add(g);
    return { x, y: y + 17, g, on: true, t: 0 };
  });
}
function stepMedkits(h) {
  for (const k of MK) {
    if (!k.on) { k.t -= h; if (k.t <= 0) k.on = true; continue; }
    for (const s of ships) {
      if (!s.active || !s.alive || s.hp >= 99.5) continue;
      if (Math.hypot(s.x - k.x, s.y - k.y) > 24 * Math.max(1, P.shipSize)) continue;
      s.hp = 100;
      s.msg = 'Healed!';
      s.msgUntil = game.time + 1.5;
      k.on = false;
      k.t = MEDKIT_BACK;
      for (let i = 0; i < 22; i++) { const ang = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 120; emit(k.x, k.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.5, i % 2 ? MED_SPARK : WHITE, -0.2, 3 + Math.random() * 3); }
      break;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Floating supply boxes on every map: ammo, health (+50) and crosshair (30 s).
 * They hang in open air that both players can reach, bob gently, and come back at a new spot
 * a while after they are taken. If a player runs dry, or every ammo box is gone, new ammo boxes appear right away.
 * ------------------------------------------------------------------ */
const CROSS_TIME = 30, HEALTH_GAIN = 50;
const BOX_KINDS = {
  ammo: { n: 3, back: 12, glow: '#ffcc33' },
  health: { n: 2, back: 20, glow: '#5dff8a' },
  cross: { n: 1, back: 25, glow: '#6ee7ff' },
};
const boxTex = {
  ammo: canvasTex(64, 64, (g) => {
    g.fillStyle = '#4f5d3a'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#2c3520'; g.lineWidth = 6; g.strokeRect(3, 3, 58, 58);
    g.fillStyle = '#ffcc33';
    for (const x of [16, 28, 40]) { g.fillRect(x, 26, 8, 22); g.beginPath(); g.arc(x + 4, 26, 4, Math.PI, 0); g.fill(); }
    g.fillStyle = '#c98a1e';
    for (const x of [16, 28, 40]) g.fillRect(x, 44, 8, 4);
  }),
  health: canvasTex(64, 64, (g) => {
    g.fillStyle = '#2f9c55'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#f7f8fb'; g.fillRect(5, 5, 54, 54);
    g.fillStyle = '#e8283c'; g.fillRect(25, 12, 14, 40); g.fillRect(12, 25, 40, 14);
  }),
  cross: canvasTex(64, 64, (g) => {
    g.fillStyle = '#1b2a4a'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#3d5d8f'; g.lineWidth = 6; g.strokeRect(3, 3, 58, 58);
    g.strokeStyle = '#6ee7ff'; g.lineWidth = 4;
    g.beginPath(); g.arc(32, 32, 13, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(32, 10); g.lineTo(32, 22); g.moveTo(32, 42); g.lineTo(32, 54);
    g.moveTo(10, 32); g.lineTo(22, 32); g.moveTo(42, 32); g.lineTo(54, 32); g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(32, 32, 3, 0, Math.PI * 2); g.fill();
  }),
};
const BOX_GROUP = new THREE.Group();
scene.add(BOX_GROUP);
let BX = [], boxSpots = [];

// Open-air spots: points with clear space all round that a ship can fly to from a spawn.
function findBoxSpots() {
  const C = 8, gw = Math.ceil(W / C), gh = Math.ceil(H / C);
  const free = new Uint8Array(gw * gh), seen = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = i * C + C / 2, y = j * C + C / 2;
    free[j * gw + i] = (!solidAt(x, y) && !solidAt(x - 9, y) && !solidAt(x + 9, y) && !solidAt(x, y - 9) && !solidAt(x, y + 9)) ? 1 : 0;
  }
  // Flood from each spawn, so boxes never sit in sealed-off pockets.
  const q = [];
  for (const sp of level.spawns) {
    for (const dy of [20, 34, 50]) {
      const i = Math.floor(sp.x / C), j = Math.floor((sp.y + dy) / C);
      if (i >= 0 && j >= 0 && i < gw && j < gh && free[j * gw + i] && !seen[j * gw + i]) { seen[j * gw + i] = 1; q.push(j * gw + i); break; }
    }
  }
  for (let k = 0; k < q.length; k++) {
    const c = q[k], i = c % gw, j = (c / gw) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
      const n = nj * gw + ni;
      if (free[n] && !seen[n]) { seen[n] = 1; q.push(n); }
    }
  }
  // Floors: the orange blocks seal each hallway until they are shot, so the whole hallway counts.
  if (level.theme === 'floors') seen.set(free);
  const clear = (x, y, R) => {
    for (const r of [R * 0.35, R * 0.7, R]) for (let a = 0; a < 12; a++) {
      if (solidAt(x + Math.cos(a * Math.PI / 6) * r, y + Math.sin(a * Math.PI / 6) * r)) return false;
    }
    return !solidAt(x, y);
  };
  const farFromSpawns = (x, y) => level.spawns.every((sp) => Math.hypot(x - sp.x, y - sp.y) > 140);
  for (const R of [52, 38, 26]) {
    const out = [];
    for (let j = 1; j < gh - 1; j += 2) for (let i = 1; i < gw - 1; i += 2) {
      if (!seen[j * gw + i]) continue;
      const x = i * C + C / 2, y = j * C + C / 2;
      if (farFromSpawns(x, y) && clear(x, y, R)) out.push([x, y]);
    }
    if (out.length >= 30 || R === 26) return out;
  }
  return [];
}
function pickBoxSpot(near) {
  const taken = BX.filter((b) => b.on || b.placing);
  let ok = boxSpots.filter(([x, y]) =>
    taken.every((b) => Math.hypot(b.x - x, b.y - y) > 130) &&
    ships.every((s) => !s.active || !s.alive || Math.hypot(s.x - x, s.y - y) > 90));
  if (!ok.length) ok = boxSpots;
  if (!ok.length) return null;
  if (near) {   // someone ran dry: drop it in their part of the map
    ok = ok.slice().sort((a, b) => Math.hypot(a[0] - near.x, a[1] - near.y) - Math.hypot(b[0] - near.x, b[1] - near.y));
    ok = ok.slice(0, Math.max(1, Math.ceil(ok.length * 0.2)));
  }
  return ok[Math.floor(Math.random() * ok.length)];
}
function placeBox(b, near, sparkle) {
  b.placing = true;
  const p = pickBoxSpot(near);
  b.placing = false;
  if (!p) { b.on = false; b.t = 5; return; }
  b.x = p[0]; b.y = p[1]; b.on = true; b.t = 0; b.phase = Math.random() * 6.28;
  if (sparkle) for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2; emit(b.x, b.y, Math.cos(a) * 80, Math.sin(a) * 80, 0.45, b.spark, 0, 3.5); }
}
function makeBoxMesh(kind) {
  const K = BOX_KINDS[kind];
  const g = new THREE.Group();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), glowMat(new THREE.Color(K.glow), 0.4));
  const ring = new THREE.Mesh(new THREE.RingGeometry(19, 20.5, 40), new THREE.MeshBasicMaterial({ color: K.glow, transparent: true, opacity: 0.5, depthWrite: false }));
  ring.position.z = 0.005;
  const box = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ map: boxTex[kind] }));
  box.position.z = 0.01;
  g.add(glow, ring, box);
  g.visible = false;
  BOX_GROUP.add(g);
  return { g, ring, box };
}
function resetBoxes() {
  for (const b of BX) { b.g.removeFromParent(); b.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  BX = [];
  boxSpots = findBoxSpots();
  const scale = Math.max(1, Math.round((W * H) / (1800 * 1100)));
  for (const kind of Object.keys(BOX_KINDS)) {
    for (let i = 0; i < BOX_KINDS[kind].n * scale; i++) {
      const m = makeBoxMesh(kind);
      const b = { kind, ...m, x: 0, y: 0, on: false, t: 0, phase: 0, spark: new THREE.Color(BOX_KINDS[kind].glow) };
      BX.push(b);
      placeBox(b, null, false);
    }
  }
  for (const s of ships) s.crossT = 0;
}
const shipName = (s) => (isSolo() ? 'You' : s.id === 0 ? 'Player 1' : 'Player 2');
function stepBoxes(h) {
  for (const s of ships) if (s.crossT > 0) s.crossT = Math.max(0, s.crossT - h);
  for (const b of BX) {
    if (!b.on) { b.t -= h; if (b.t <= 0) placeBox(b, null, true); continue; }
    for (const s of ships) {
      if (!s.active || !s.alive) continue;
      if (Math.hypot(s.x - b.x, s.y - b.y) > 24 * Math.max(1, P.shipSize)) continue;
      if (b.kind === 'ammo') {
        if (s.ammo >= P.ammoMax - 0.5) continue;
        s.ammo = P.ammoMax; s.msg = 'Ammo refilled!';
      } else if (b.kind === 'health') {
        if (s.hp >= 99.5) continue;
        s.hp = Math.min(100, s.hp + HEALTH_GAIN); s.msg = `+${HEALTH_GAIN} health!`;
      } else {
        s.crossT = CROSS_TIME; s.msg = `Crosshair for ${CROSS_TIME} s!`;
      }
      s.msgUntil = game.time + 1.5;
      b.on = false; b.t = BOX_KINDS[b.kind].back;
      for (let i = 0; i < 22; i++) { const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 130; emit(b.x, b.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.45, i % 2 ? b.spark : WHITE, 0, 3 + Math.random() * 3); }
      break;
    }
  }
  // Never leave the map without ammo: if every ammo box is gone, or a player has run dry, bring new ones in now.
  const ammo = BX.filter((b) => b.kind === 'ammo');
  if (!ammo.length) return;
  const dry = ships.find((s) => s.active && s.alive && s.ammo < 1 && !(s.minigunT > 0) && !(isPractice() && PR.infiniteAmmo));
  const noneLeft = ammo.every((b) => !b.on);
  if (dry || noneLeft) {
    for (const b of ammo) if (!b.on) placeBox(b, dry || null, true);
  }
}
function drawBoxes(now) {
  for (const b of BX) {
    b.g.visible = b.on;
    if (!b.on) continue;
    const t = now / 1000 + b.phase;
    b.g.position.set(b.x, b.y + Math.sin(t * 2.2) * 4, 1.15);
    b.box.rotation.z = Math.sin(t * 1.3) * 0.18;
    b.ring.scale.setScalar(1 + 0.08 * Math.sin(t * 4));
    b.ring.material.opacity = 0.35 + 0.25 * Math.sin(t * 4);
  }
}

const backWallMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: LAVA_VS,
  fragmentShader: `uniform float uTime; varying vec2 vW;
void main() {
  vec2 q = abs(fract(vW / vec2(120.0, 80.0)) - 0.5) * vec2(120.0, 80.0);
  float seam = clamp(smoothstep(57.0, 59.0, q.x) + smoothstep(37.0, 39.0, q.y), 0.0, 1.0);
  vec3 col = vec3(0.075, 0.075, 0.125) * (1.0 - 0.35 * seam);
  float strip = smoothstep(3.0, 0.0, abs(mod(vW.y, 320.0) - 160.0));
  col += vec3(0.25, 0.45, 0.8) * strip * (0.35 + 0.15 * sin(uTime * 2.0 + vW.x * 0.01));
  gl_FragColor = vec4(col, 1.0);
}`,
});
// Big lasers: a thin flickering warning line first, then a thick beam that hurts.
const beamGeo = new THREE.PlaneGeometry(1, 1);
beamGeo.translate(0.5, 0, 0);
const beams = Array.from({ length: 10 }, () => {
  const add = (color, z) => {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.z = z; m.frustumCulled = false; m.visible = false;
    scene.add(m);
    return m;
  };
  return { glow: add('#ff2b3d', 2.4), core: add('#fff1f1', 2.45) };
});
const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
function nearestPlayer(x, y) {
  let best = null, bd = Infinity;
  for (const s of ships) {
    if (!s.active || !s.alive) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function lineOfSight(x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8);
  for (let i = 1; i < n; i++) { const t = i / n; if (solidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false; }
  return true;
}
function laserLength(ox, oy, ang) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let d = 0;
  while (d < 2600 && !solidAt(ox + dx * d, oy + dy * d)) d += 5;
  return d;
}
function segDist(px, py, ox, oy, ang, len) {
  const dx = Math.cos(ang), dy = Math.sin(ang), t = clamp((px - ox) * dx + (py - oy) * dy, 0, len);
  return Math.hypot(px - (ox + dx * t), py - (oy + dy * t));
}
function disposeTree(o) {
  o.traverse((c) => {
    if (c.geometry && c.geometry !== beamGeo) c.geometry.dispose();
    if (c.material && !c.material.userData.shared) c.material.dispose();
  });
}

// The red robot ships. Juggernauts and the boss get armour, extra wings and a health bar.
function makeEnemyMesh(kind) {
  const g = new THREE.Group(), K = EKIND[kind];
  const hull = new THREE.MeshBasicMaterial({ color: '#ff4d5e', side: THREE.DoubleSide });
  const dark = new THREE.MeshBasicMaterial({ color: '#a8233a', side: THREE.DoubleSide });
  const armor = new THREE.MeshBasicMaterial({ color: '#6e1626', side: THREE.DoubleSide });
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), glowMat(ENEMY_RED, 0.22));
  aura.position.z = -0.05;
  const flame = new THREE.Group();
  flame.position.set(0, -4.5, -0.01);
  const fo = new THREE.Mesh(new THREE.PlaneGeometry(10, 26), glowMat(new THREE.Color('#ff5a2e'), 0.9));
  fo.position.y = -9;
  flame.add(fo);
  g.add(aura, flame);
  if (kind !== 'bot') {
    const wing = kind === 'boss' ? [[7, -6], [22, -1], [25, -15], [9, -11]] : [[7, -6], [14, -3], [13, -12], [6, -10]];
    g.add(new THREE.Mesh(shapeGeo(wing), armor), new THREE.Mesh(shapeGeo(wing.map(([x, y]) => [-x, y])), armor));
    for (const sx of [1, -1]) {
      const gx = (kind === 'boss' ? 18 : 11) * sx;
      const gun = new THREE.Mesh(shapeGeo([[gx - 1, -4], [gx + 1, -4], [gx + 1, 7], [gx - 1, 7]]), dark);
      gun.position.z = 0.01;
      g.add(gun);
    }
    if (kind === 'boss') {
      g.add(new THREE.Mesh(shapeGeo([[0, 4], [5, -2], [0, 20], [-5, -2]]), armor));
      for (const sx of [1, -1]) g.add(new THREE.Mesh(shapeGeo([[sx * 24, -4], [sx * 30, -10], [sx * 24, -13]]), dark));
    }
  }
  const left = new THREE.Mesh(shapeGeo([[0, 12], [-8, -8], [-3, -4.5], [0, -4.5]]), hull);
  const right = new THREE.Mesh(shapeGeo([[0, 12], [0, -4.5], [3, -4.5], [8, -8]]), dark);
  left.position.z = right.position.z = 0.02;
  const cockpit = new THREE.Mesh(shapeGeo([[0, 7], [2.6, 0.5], [-2.6, 0.5]]), new THREE.MeshBasicMaterial({ color: '#1b0f1f' }));
  cockpit.position.z = 0.03;
  const eye = new THREE.Mesh(new THREE.CircleGeometry(1.3, 12), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
  eye.position.set(0, 3.2, 0.04);
  g.add(left, right, cockpit, eye);
  g.scale.setScalar(K.scale);
  g.position.z = 1.05;
  return { g, hull, flame };
}
function spawnEnemy(kind, at) {
  const K = EKIND[kind], sp = at || (kind === 'boss' ? SH.spec.bossSpawn : SH.spec.spawnPts[SH.spawnIdx++ % SH.spec.spawnPts.length]);
  const mesh = makeEnemyMesh(kind);
  SHIP_GROUP.add(mesh.g);
  let bar = null;
  if (K.hp > 30) {
    const w = kind === 'boss' ? 140 : 56;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(w, 5), new THREE.MeshBasicMaterial({ color: '#2a0f18' }));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(w, 5), new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
    bg.position.z = 1.3; fg.position.z = 1.31;
    SHIP_GROUP.add(bg, fg);
    bar = { bg, fg, w };
  }
  const e = { kind, K, x: sp[0], y: sp[1], px: sp[0], py: sp[1], vx: 0, vy: 0, a: Math.PI, hp: K.hp, fireCd: 1 + Math.random(), laserCd: K.laser ? 2.5 + Math.random() : 0, laser: null, orbit: Math.random() < 0.5 ? 1 : -1, flash: 0, thrust: 0, mesh, bar, dead: false };
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2, r = K.r * 2.2;
    emit(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, -Math.cos(a) * r * 2, -Math.sin(a) * r * 2, 0.45, i % 2 ? ENEMY_RED : WHITE, 0, 4);
  }
  SH.enemies.push(e);
}
function removeEnemyMesh(e) {
  for (const o of [e.mesh.g, e.bar && e.bar.bg, e.bar && e.bar.fg]) if (o) { SHIP_GROUP.remove(o); disposeTree(o); }
}
function killEnemy(e, by) {
  if (e.dead) return;
  e.dead = true;
  const n = Math.round(30 * Math.sqrt(e.K.scale));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 220 * Math.sqrt(e.K.scale);
    emit(e.x, e.y, e.vx * 0.3 + Math.cos(a) * sp, e.vy * 0.3 + Math.sin(a) * sp, 0.5 + Math.random() * 0.9, i % 3 ? ENEMY_RED : i % 2 ? FIRE : WHITE, 0.4, 3 + Math.random() * 5 * Math.sqrt(e.K.scale));
  }
  emit(e.x, e.y, 0, 0, 0.3, ENEMY_RED, 0, 40 * Math.sqrt(e.K.scale));
  for (let i = 0; i < 4 * e.K.scale; i++) emitSmoke(e.x, e.y, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 1.5 + Math.random(), 8 + Math.random() * 6 * e.K.scale);
  for (const s of ships) if (s.active && Math.hypot(s.x - e.x, s.y - e.y) < 500) addShake(s, 0.3 * e.K.scale);
  if (by) by.score++;
  if (e.laser) { SH.lasers = SH.lasers.filter((L) => L !== e.laser); e.laser = null; }
  removeEnemyMesh(e);
}
function bulletHitsEnemy(owner, x, y, dmg = P.bulletDamage, kind = 0) {
  if (SH.spec && SH.spec.mode === 'robot' && robotShot(x, y, dmg, ships[owner], kind)) return true;
  for (const e of SH.enemies) {
    if (e.dead) continue;
    const r = e.K.r + 2;
    if ((x - e.x) ** 2 + (y - e.y) ** 2 > r * r) continue;
    e.hp -= dmg;
    e.flash = 0.08;
    for (let j = 0; j < 5; j++) emit(x, y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.25, j % 2 ? ENEMY_RED : WHITE, 0.2, 3);
    if (e.hp <= 0) killEnemy(e, ships[owner]);
    return true;
  }
  return false;
}
function laserOrigin(L) {
  if (L.owner === RG) return [RG.x + Math.cos(L.ang) * 56, RG.y + Math.sin(L.ang) * 56];
  if (L.owner === RB) return robotEye();
  const e = L.owner;
  return [e.x + Math.cos(L.ang) * e.K.r, e.y + Math.sin(L.ang) * e.K.r];
}
function startLaser(owner, ang) {
  const L = { owner, ang, phase: 'warn', t: LASER_WARN, hit: new Set(), width: owner === RG ? 30 : owner === RB ? RB.beamW : owner.kind === 'boss' ? 36 : 26, ox: 0, oy: 0, len: 0 };
  owner.laser = L;
  SH.lasers.push(L);
}
function stepLasers(h) {
  for (const L of SH.lasers) {
    if (L.owner !== RG && L.owner.dead) { L.done = true; continue; }
    [L.ox, L.oy] = laserOrigin(L);
    L.len = laserLength(L.ox, L.oy, L.ang);
    L.t -= h;
    if (L.phase === 'warn') {
      if (L.t <= 0) {
        L.phase = 'fire'; L.t = L.fireT || LASER_FIRE;
        for (const s of ships) if (s.active) addShake(s, 0.35);
      }
      continue;
    }
    for (const s of ships) {
      if (!s.active || !s.alive || L.hit.has(s)) continue;
      if (segDist(s.x, s.y, L.ox, L.oy, L.ang, L.len) < L.width / 2 + SHIP_RADIUS * P.shipSize * 0.7) {
        L.hit.add(s);
        damage(s, LASER_DAMAGE);
        for (let j = 0; j < 14; j++) emit(s.x, s.y, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, 0.35, j % 2 ? ENEMY_RED : WHITE, 0.2, 4);
      }
    }
    if (Math.random() < 0.5) emit(L.ox + Math.cos(L.ang) * L.len, L.oy + Math.sin(L.ang) * L.len, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 0.3, Math.random() < 0.5 ? ENEMY_RED : WHITE, 0.3, 4);
    if (L.t <= 0) L.done = true;
  }
  for (const L of SH.lasers) if (L.done && L.owner.laser === L) L.owner.laser = null;
  SH.lasers = SH.lasers.filter((L) => !L.done);
}
function stepEnemy(e, h) {
  const K = e.K, s = nearestPlayer(e.x, e.y);
  e.px = e.x; e.py = e.y;
  e.flash = Math.max(0, e.flash - h);
  let dvx = 0, dvy = 0, tAng = e.a;
  if (s) {
    const dx = s.x - e.x, dy = s.y - e.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const radial = d > K.keep + 60 ? 1 : d < K.keep - 60 ? -0.8 : 0;
    dvx = (ux * radial - uy * e.orbit * 0.6) * K.speed;
    dvy = (uy * radial + ux * e.orbit * 0.6) * K.speed;
    tAng = Math.atan2(dy, dx) - Math.PI / 2;
  }
  for (let k = 0; k < 8; k++) {   // steer away from walls and boxes
    const a = k * Math.PI / 4;
    if (solidAt(e.x + Math.cos(a) * (K.r + 45), e.y + Math.sin(a) * (K.r + 45))) { dvx -= Math.cos(a) * K.speed * 0.9; dvy -= Math.sin(a) * K.speed * 0.9; }
  }
  for (const o of SH.enemies) {   // don't bunch up
    if (o === e || o.dead) continue;
    const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy), R = K.r + o.K.r + 10;
    if (d < R && d > 1e-6) { dvx += dx / d * K.speed * 0.8; dvy += dy / d * K.speed * 0.8; }
  }
  const k = Math.min(1, h * 2.2);
  e.vx += (dvx - e.vx) * k;
  e.vy += (dvy - e.vy) * k;
  const sp = Math.hypot(e.vx, e.vy), top = K.speed * 1.2;
  if (sp > top) { e.vx *= top / sp; e.vy *= top / sp; }
  e.x += e.vx * h;
  e.y += e.vy * h;
  for (let k2 = 0; k2 < 8; k2++) {
    const a = k2 * Math.PI / 4;
    if (solidAt(e.x + Math.cos(a) * K.r, e.y + Math.sin(a) * K.r)) { e.x = e.px; e.y = e.py; e.vx *= -0.4; e.vy *= -0.4; break; }
  }
  e.thrust = clamp(sp / K.speed, 0, 1);
  const want = e.laser ? e.laser.ang - Math.PI / 2 : tAng;
  e.a += clamp(wrapAngle(want - e.a), -3 * h, 3 * h);
  if (!s) return;
  const see = lineOfSight(e.x, e.y, s.x, s.y), dist = Math.hypot(s.x - e.x, s.y - e.y);
  e.fireCd -= h;
  if (e.fireCd <= 0 && see && dist < 800 && !(e.laser && e.laser.phase === 'fire')) {
    e.fireCd = K.fire[0] + Math.random() * (K.fire[1] - K.fire[0]);
    const base = Math.atan2(s.y - e.y, s.x - e.x);
    for (let i = 0; i < K.shots; i++) {
      const ang = base + (i - (K.shots - 1) / 2) * 0.14 + (Math.random() - 0.5) * 0.12;
      spawnBullet(2, e.x + Math.cos(base) * K.r, e.y + Math.sin(base) * K.r, Math.cos(ang) * 470, Math.sin(ang) * 470, 2.2);
    }
    emit(e.x + Math.cos(base) * K.r, e.y + Math.sin(base) * K.r, 0, 0, 0.09, ENEMY_RED, 0, 12);
  }
  if (K.laser) {
    e.laserCd -= h;
    if (e.laserCd <= 0 && see && !e.laser) { e.laserCd = K.laser; startLaser(e, Math.atan2(s.y - e.y, s.x - e.x)); }
  }
}
function stepRaygun(h) {
  if (!RG.active) return;
  const s = nearestPlayer(RG.x, RG.y);
  if (s && !RG.laser) {
    const want = clamp(Math.atan2(s.y - RG.y, s.x - RG.x), -Math.PI + 0.15, -0.15);
    RG.ang += clamp(want - RG.ang, -1.6 * h, 1.6 * h);
  }
  RG.cd -= h;
  if (RG.cd <= 0 && s && !RG.laser) { RG.cd = 3; startLaser(RG, RG.ang); }
}
function setRaygun(on) {
  RG.active = on;
  RG.cd = 3;
  if (!on && RG.laser) { SH.lasers = SH.lasers.filter((L) => L !== RG.laser); RG.laser = null; }
}
function setDoor(open) {
  if (!SH.spec || !SH.spec.door || SH.doorOpen === open) return;
  SH.doorOpen = open;
  const [x0, y0, x1, y1] = SH.spec.door, m = level.mask;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[(H - 1 - y) * W + x] = open ? 0 : 2;
  paintRegion(x0 - 3, H - y1 - 3, x1 + 3, H - y0 + 3);
}
function startWave(i) {
  SH.wave = i;
  if (i >= WAVES.length) {
    SH.state = 'escape';
    setDoor(true);
    showToast('The boss is down! The door is open!', 'Fly out through the door on the right to escape.');
    return;
  }
  const w = WAVES[i];
  SH.pending = [...Array(w.bots || 0).fill('bot'), ...Array(w.juggs || 0).fill('jugg'), ...(w.boss ? ['boss'] : [])];
  SH.state = 'fight';
  SH.spawnT = 0.3;
  setRaygun(!!w.raygun);
  if (w.boss) showToast('BOSS!', 'A giant red ship. Watch out for its big laser every 5 seconds!');
  else showToast(`Level ${i + 1} of ${WAVES.length - 1}`, w.juggs
    ? `${w.bots} robots and ${w.juggs} juggernauts with big lasers${w.raygun ? '. The raygun on the roof is ON!' : '!'}`
    : `${w.bots} red robot ship${w.bots > 1 ? 's' : ''}`);
}
function waveCleared() {
  const w = WAVES[SH.wave];
  if (w.raygun) setRaygun(false);
  if (w.boss) { startWave(SH.wave + 1); return; }
  SH.state = 'between';
  SH.timer = 3;
  const nw = WAVES[SH.wave + 1];
  showToast(w.raygun ? 'Level cleared! The raygun stopped.' : 'Level cleared!', nw.boss ? 'Get ready for the boss...' : `Level ${SH.wave + 2} is coming...`);
}
function finishRun() {
  SH.state = 'done';
  document.getElementById('finishTime').textContent = fmtTime(SH.time);
  const robo = SH.spec && SH.spec.mode === 'robot';
  document.getElementById('finishTitle').textContent = robo ? 'You beat the robot!' : 'You escaped the starship!';
  if (robo) cutscene(false);
  document.getElementById('finishSub').textContent = robo
    ? `Score (the giant robot counts 5): Player 1 ${ships[0].score}, Player 2 ${ships[1].score} · Times blown up: ${SH.deaths}`
    : `Started at level ${SH.startLevel} · Robots destroyed: Player 1 ${ships[0].score}, Player 2 ${ships[1].score} · Times blown up: ${SH.deaths}`;
  document.getElementById('finishPanel').hidden = false;
}
function resetStarship() {
  for (const e of SH.enemies) removeEnemyMesh(e);
  SH.enemies = [];
  SH.lasers = [];
  SH.pending = [];
  SH.wave = -1;
  SH.spawnIdx = 0;
  SH.time = 0;
  SH.deaths = 0;
  SH.door = 0;
  setRaygun(false);
  RG.ang = -Math.PI / 2;
  for (const a of AM) { a.on = true; a.t = 0; }
  for (const k of MK) { k.on = true; k.t = 0; }
  setDoor(false);
  document.getElementById('finishPanel').hidden = true;
  SH.state = level.theme === 'ship' ? 'choose' : 'off';
  SH.timer = 3;
  if (level.theme === 'ship' && SH.spec && SH.spec.mode === 'robot') {
    SH.state = 'between';
    resetRobot();
    showToast('Robot hangar', 'Something big is coming... Work together!');
  }
  document.getElementById('levelPanel').hidden = SH.state !== 'choose';
}
// The level chooser: start at level 1 to 5. The timer starts when you pick.
function chooseLevel(n) {
  if (SH.state !== 'choose') return;
  document.getElementById('levelPanel').hidden = true;
  SH.startLevel = n;
  SH.wave = n - 2;
  SH.state = 'between';
  SH.timer = 2;
  SH.time = 0;
  showToast(`Level ${n}`, 'Defend the starship! Work together!');
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
function restartStarship() {
  for (const s of ships) s.score = 0;
  rebuildCave();
}
function clearStarship() {
  for (const e of SH.enemies) removeEnemyMesh(e);
  SH.enemies = [];
  SH.lasers = [];
  for (const o of [...SHIP_GROUP.children]) { SHIP_GROUP.remove(o); disposeTree(o); }
  AM = [];
  MK = [];
  RG.barrel = RG.light = null;
  RG.active = false;
  cutscene(false);
  SH.state = 'off';
  SH.doorOpen = false;
  document.getElementById('levelPanel').hidden = true;
  document.getElementById('finishPanel').hidden = true;
}
function buildStarship() {
  clearStarship();
  const sp = SH.spec;
  SH.doorOpen = false;
  if (sp.mode === 'robot') { buildHangar(); return; }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(sp.hullX - 40, H - 112), backWallMat);
  back.position.set(40 + (sp.hullX - 40) / 2, H / 2, -0.7);
  SHIP_GROUP.add(back);
  const tints = ['#7a8aa6', '#a07a52', '#6f8f6a', '#9a5f5f', '#8a7fb0'];
  sp.boxes.forEach((b, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b[2] - b[0], b[3] - b[1]), new THREE.MeshBasicMaterial({ map: cargoTex, color: tints[i % tints.length] }));
    m.position.set((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0.3);
    SHIP_GROUP.add(m);
  });
  for (const c of sp.catwalks) {
    const m = new THREE.Mesh(stripedPlane(c[2] - c[0], c[3] - c[1], 2 * (c[3] - c[1])), girderMat);
    m.position.set((c[0] + c[2]) / 2, (c[1] + c[3]) / 2, 0.3);
    SHIP_GROUP.add(m);
  }
  buildAmmo();
  buildMedkits();
  const [dx0, dy0, dx1, dy1] = sp.door;   // the exit door, striped, with a light above it
  const door = new THREE.Mesh(stripedPlane(dy1 - dy0, dx1 - dx0, 2 * (dx1 - dx0)), girderMat);
  door.rotation.z = Math.PI / 2;
  door.position.set((dx0 + dx1) / 2, (dy0 + dy1) / 2, 0.32);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), glowMat(new THREE.Color('#ff3040'), 0.8));
  sign.position.set((dx0 + dx1) / 2, dy1 + 22, 0.33);
  SHIP_GROUP.add(door, sign);
  SH.doorMesh = door; SH.doorSign = sign;
  RG.y = H - 84;   // the raygun hangs from the roof
  const base = new THREE.Mesh(shapeGeo([[-46, 0], [46, 0], [30, -28], [-30, -28]]), new THREE.MeshBasicMaterial({ color: '#3a3f55' }));
  base.position.set(RG.x, H - 56, 0.4);
  const barrel = new THREE.Group();
  barrel.add(new THREE.Mesh(shapeGeo([[0, -8], [50, -6], [50, 6], [0, 8]]), new THREE.MeshBasicMaterial({ color: '#6b7290' })));
  const tip = new THREE.Mesh(shapeGeo([[48, -8], [58, -8], [58, 8], [48, 8]]), new THREE.MeshBasicMaterial({ color: '#ff4d5e' }));
  tip.position.z = 0.01;
  barrel.add(tip);
  barrel.position.set(RG.x, RG.y, 0.38);
  const light = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), glowMat(new THREE.Color('#ff2b3d'), 0));
  light.position.set(RG.x, RG.y, 0.41);
  const hub = new THREE.Mesh(new THREE.CircleGeometry(11, 20), new THREE.MeshBasicMaterial({ color: '#2a2e40' }));
  hub.position.set(RG.x, RG.y, 0.42);
  SHIP_GROUP.add(base, barrel, light, hub);
  RG.barrel = barrel; RG.light = light;
  resetStarship();
}
function stepStarship(h) {
  if (SH.state === 'off') return;
  if (SH.state !== 'done' && SH.state !== 'choose') SH.time += h;
  if (SH.spec.mode === 'robot') stepRobotFight(h);
  else if (SH.state === 'between') {
    SH.timer -= h;
    if (SH.timer <= 0) startWave(SH.wave + 1);
  } else if (SH.state === 'fight') {
    if (SH.pending.length) {
      SH.spawnT -= h;
      if (SH.spawnT <= 0) { spawnEnemy(SH.pending.shift()); SH.spawnT = 0.45; }
    } else if (!SH.enemies.length) waveCleared();
  } else if (SH.state === 'escape') {
    SH.door = Math.min(1, SH.door + h * 0.8);
    for (const s of ships) if (s.active && s.alive && s.x > SH.spec.exitX) { finishRun(); break; }
  }
  for (const e of SH.enemies) if (!e.dead) stepEnemy(e, h);
  SH.enemies = SH.enemies.filter((e) => !e.dead);
  stepRaygun(h);
  stepLasers(h);
  stepAmmo(h);
  stepMedkits(h);
  for (const e of SH.enemies) {   // bumping into a robot hurts
    for (const s of ships) {
      if (!s.active || !s.alive) continue;
      const dx = s.x - e.x, dy = s.y - e.y, d = Math.hypot(dx, dy), R = e.K.r + SHIP_RADIUS * P.shipSize * 0.8;
      if (d >= R || d < 1e-6) continue;
      s.x = e.x + dx / d * R; s.y = e.y + dy / d * R;
      s.vx += dx / d * 120; s.vy += dy / d * 120;
      s.landed = false;
      s.rockCd = Math.max(0, (s.rockCd || 0) - h);
      if (!(s.rockCd > 0)) { s.rockCd = 0.6; damage(s, 10); }
    }
  }
}
function drawStarship(now) {
  const on = level.theme === 'ship' && SH.state !== 'off';
  const bar = document.getElementById('waveBar');
  bar.hidden = !on;
  let bi = 0;
  if (on) {
    backWallMat.uniforms.uTime.value = now / 1000;
    if (SH.spec.mode === 'robot') drawRobot(now);
    for (const e of SH.enemies) {
      const g = e.mesh.g;
      g.position.x = e.x; g.position.y = e.y;
      g.rotation.z = e.a;
      e.mesh.flame.visible = e.thrust > 0.1;
      e.mesh.flame.scale.set(1, e.thrust * (0.8 + Math.random() * 0.4), 1);
      e.mesh.hull.color.set(e.flash > 0 ? '#ffffff' : '#ff4d5e');
      if (e.bar) {
        const y = e.y + e.K.r + 14, f = Math.max(0, e.hp / e.K.hp);
        e.bar.bg.position.set(e.x, y, 1.3);
        e.bar.fg.scale.x = Math.max(0.001, f);
        e.bar.fg.position.set(e.x - e.bar.w * (1 - f) / 2, y, 1.31);
      }
    }
    for (const a of AM) { a.g.visible = a.on; a.g.position.y = a.y + Math.sin(now / 350 + a.x) * 2.5; }
    for (const k of MK) { k.g.visible = k.on; k.g.position.y = k.y + Math.sin(now / 420 + k.x) * 2.5; }
    if (RG.barrel) {
      RG.barrel.rotation.z = RG.ang;
      const charging = RG.laser && RG.laser.phase === 'warn';
      RG.light.material.opacity = RG.active ? (charging ? 0.6 + 0.4 * Math.sin(now / 40) : 0.35 + 0.15 * Math.sin(now / 300)) : 0;
    }
    if (SH.doorMesh) {
      const [, dy0, , dy1] = SH.spec.door, hgt = dy1 - dy0, k = Math.max(0.001, 1 - SH.door);
      SH.doorMesh.scale.x = k;
      SH.doorMesh.position.y = dy1 - hgt * k / 2;
      SH.doorSign.material.color.set(SH.doorOpen ? '#3dff7a' : '#ff3040');
    }
    for (const L of SH.lasers) {
      const b = beams[bi++];
      if (!b) break;
      const warn = L.phase === 'warn';
      b.glow.visible = true;
      b.glow.position.set(L.ox, L.oy, 2.4);
      b.glow.rotation.z = L.ang;
      b.glow.scale.set(Math.max(1, L.len), warn ? (L.locked ? 6 + 2 * Math.sin(now / 20) : 3) : L.width + 14, 1);
      b.glow.material.opacity = warn ? (L.locked ? 0.95 : 0.35 + 0.35 * Math.sin(now / 35)) : 0.6;
      b.core.visible = !warn;
      if (!warn) {
        b.core.position.set(L.ox, L.oy, 2.45);
        b.core.rotation.z = L.ang;
        b.core.scale.set(Math.max(1, L.len), L.width * 0.35, 1);
      }
    }
    const left = SH.enemies.length + SH.pending.length;
    const boss = SH.enemies.find((e) => e.kind === 'boss');
    let text;
    if (SH.spec.mode === 'robot') text = robotText();
    else if (SH.state === 'choose') text = 'Choose a level: 1 to 5';
    else if (SH.state === 'between') text = SH.wave < 0 ? 'Get ready!' : WAVES[SH.wave + 1].boss ? 'Boss coming...' : `Level ${SH.wave + 2} coming...`;
    else if (SH.state === 'fight') text = WAVES[SH.wave].boss ? 'BOSS' : `Level ${SH.wave + 1} of ${WAVES.length - 1} · ${left} left`;
    else if (SH.state === 'escape') text = 'The door is open! Fly out on the right →';
    else text = 'Escaped!';
    text += `  ·  Time ${fmtTime(SH.time)}`;
    if (text !== SH.lastText) { document.getElementById('waveText').textContent = text; SH.lastText = text; }
    const track = document.getElementById('bossTrack');
    const robo = SH.spec.mode === 'robot' && RB.on && RB.state !== 'drop';
    track.hidden = !boss && !robo;
    if (robo) document.getElementById('bossFill').style.transform = `scaleX(${Math.max(0, RB.hp / ROBOT_MAXHP).toFixed(3)})`;
    else if (boss) document.getElementById('bossFill').style.transform = `scaleX(${Math.max(0, boss.hp / boss.K.hp).toFixed(3)})`;
  }
  for (; bi < beams.length; bi++) { beams[bi].glow.visible = false; beams[bi].core.visible = false; }
}

/* ------------------------------------------------------------------ *
 * Robot hangar: parked starships, and a giant robot that drops in from the roof.
 * It shoots a laser from its eye, punches with stretchy piston arms and sends out small robots.
 * ------------------------------------------------------------------ */
const HANGAR_SHIPS = [
  { hull: [[480, 92], [840, 92], [905, 120], [860, 160], [720, 192], [540, 192], [480, 160]], fin: [[480, 160], [545, 192], [520, 250], [486, 246]],
    posts: [[540, 56, 554, 92], [780, 56, 794, 92]], col: '#d8dbe6', under: '#9aa0b4', stripe: '#3d7bff', win: [[812, 138], [782, 148], [752, 155], [722, 160]], nozzle: [474, 124, 30] },
  { hull: [[960, 762], [1260, 762], [1325, 792], [1260, 822], [960, 822], [928, 792]], fin: null,
    posts: [[1050, 822, 1064, 1044], [1170, 822, 1184, 1044]], col: '#e8a23a', under: '#b0712a', stripe: '#3a3f55', win: [[1275, 796], [1245, 798]], nozzle: [934, 792, 26] },
  { hull: [[290, 578], [470, 578], [508, 598], [470, 614], [330, 622], [290, 606]], fin: [[290, 606], [330, 622], [312, 652], [292, 648]],
    posts: [], col: '#ff6a5a', under: '#b8403a', stripe: '#ffffff', win: [[470, 600]], nozzle: [286, 594, 18] },
];
const ROBOT_MAXHP = 1400, ROBOT_REACH = 480, ROBOT_XMIN = 1150, ROBOT_HIP = 200;
const RB = { on: false, state: 'off', x: 1450, y: 56, vy: 0, dir: -1, hp: ROBOT_MAXHP, flash: 0, phase: 0, bob: 0, laserCd: 3, punchCd: 2, spawnCd: 6, spawning: 0, hatch: 0, roof: 0, t: 0, laser: null, dead: false, beamW: 34, mesh: null, roofMesh: null,
  arms: [{ side: -1, fx: 0, fy: 0, mode: 'rest', t: 0, ux: 0, uy: -1, hit: false }, { side: 1, fx: 0, fy: 0, mode: 'rest', t: 0, ux: 0, uy: -1, hit: false }] };
const ROBOT_ORANGE = new THREE.Color('#ffb020'), ROBOT_DUST = new THREE.Color('#9aa0b4');
// Robot-local point to world, including the tilt when it falls over (it pivots on the edge it falls toward).
function rbLocal(lx, ly) {
  const px = (RB.fd || 1) * 112, c = Math.cos(RB.rot || 0), sn = Math.sin(RB.rot || 0), dx = lx - px;
  return [RB.x + px + dx * c - ly * sn, RB.y + dx * sn + ly * c];
}
const rbShoulder = (side) => rbLocal(side * 118, 385 + RB.bob);
const rbRest = (side) => { const [sx, sy] = rbShoulder(side); return [sx + side * 28, sy - 165 + 4 * Math.sin(RB.phase * 0.5 + side)]; };
function robotEye() { return rbLocal(RB.dir * 14, ROBOT_HIP + 252 + RB.bob); }
// It breaks a bit more at 80 %, 60 %, 45 %, 30 % and 15 % health.
const ROBOT_STAGES = [0.8, 0.6, 0.45, 0.3, 0.15];
const robotStage = () => ROBOT_STAGES.filter((f) => RB.hp < ROBOT_MAXHP * f).length;
const robotAngry = () => RB.hp < ROBOT_MAXHP * 0.5;

function terrainHangar(m) {
  const fill = (x0, y0, x1, y1, v) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
      const row = (H - 1 - y) * W;
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) m[row + x] = v;
    }
  };
  const HT = 56;
  fill(0, 0, W, HT, 2);           // deck
  fill(0, H - HT, W, H, 2);       // roof
  fill(0, 0, 40, H, 2); fill(W - 40, 0, W, H, 2);
  const catwalks = [[250, 560, 540, 578], [1380, 780, 1740, 798]];
  for (const c of catwalks) fill(...c, 2);
  for (const sh of HANGAR_SHIPS) {
    fillPolyMask(m, sh.hull, 2);
    if (sh.fin) fillPolyMask(m, sh.fin, 2);
    for (const p of sh.posts) fill(...p, 2);
  }
  for (const x of [150, 270]) fill(x - 38, 56, x + 38, 66, 3);
  SH.spec = {
    mode: 'robot', boxes: [], catwalks, spawnPts: [[1400, 600]], bossSpawn: [1400, 600],
    ammo: [[400, 622], [650, 192], [1117, 822], [1540, 798]],
    medkits: [[524, 578], [1700, 798]],
  };
  level.spawns = [{ x: 150, y: 66 }, { x: 270, y: 66 }];
}

const signTex = canvasTex(256, 64, (g) => {
  g.fillStyle = '#1a1d2e'; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#ffb020'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 56);
  g.fillStyle = '#ffb020'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('HANGAR 7', 128, 34);
});
function hPlane(w, h, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  return m;
}
function hPoly(pts, mat, z, dx = 0, dy = 0) {
  const m = new THREE.Mesh(shapeGeo(pts), mat);
  m.position.set(dx, dy, z);
  return m;
}
const bmat = (hex) => new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide });
// Weathering for the droid, drawn once: grime streaks running down, rust specks and light scratches.
const grimeTex = canvasTex(128, 128, (g) => {
  const r = mulberry32(77);
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(22,17,10,${(0.05 + r() * 0.13).toFixed(3)})`; g.fillRect(r() * 128, r() * 128, 2 + r() * 7, 10 + r() * 44); }
  for (let i = 0; i < 45; i++) { g.fillStyle = `rgba(125,62,28,${(0.12 + r() * 0.22).toFixed(3)})`; g.beginPath(); g.arc(r() * 128, r() * 128, 0.8 + r() * 2.6, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(255,248,230,0.2)'; g.lineWidth = 1;
  for (let i = 0; i < 28; i++) { const x = r() * 128, y = r() * 128; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 22, y + (r() - 0.5) * 8); g.stroke(); }
});
const stencilTex = canvasTex(128, 40, (g) => {
  g.fillStyle = 'rgba(30,26,20,0.75)'; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('KR-07', 64, 22);
});
const rivetGeo = new THREE.CircleGeometry(2.2, 8);

function makeRobotMesh() {
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

function buildHangar() {
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
function resetRobot() {
  clearDebris();
  cutscene(false);
  RB.stage = 0; RB.rot = 0; RB.rotV = 0; RB.fd = 1; RB.kneel = 0; RB.down = false; RB.ct = 0; RB.downT = 0; RB.titleShown = false; RB.finished = false; RB.combo = null; RB.camZ = RB.camZ || 1;
  const R = RB.mesh;
  if (R) {
    const D = R.dmg;
    for (const o of [D.chestPlate, D.ant1, D.ant2, D.finL, D.finR, D.crest, ...R.arms.map((a) => a.pad), ...R.arms.map((a) => a.fist)]) o.visible = true;
    D.tipGone = [false, false];
    R.g.rotation.z = 0; R.head.rotation.z = 0;
  }
  RB.on = false; RB.state = 'off'; RB.dead = false; RB.hp = ROBOT_MAXHP; RB.flash = 0; RB.x = 1450; RB.y = H + 40; RB.vy = 0; RB.dir = -1;
  RB.laser = null; RB.hatch = 0; RB.spawning = 0; RB.roof = 0; RB.bob = 0;
  RB.laserCd = 3; RB.punchCd = 2; RB.spawnCd = 7; RB.boot = 0; RB.lastStep = 0;
  for (const a of RB.arms) { a.mode = 'rest'; a.hits = 0; a.lost = false; a.hitFlash = 0; [a.fx, a.fy] = rbRest(a.side); }
}
function robotDrop() {
  RB.on = true; RB.state = 'drop'; RB.y = H + 40; RB.vy = -60;
  for (const a of RB.arms) [a.fx, a.fy] = rbRest(a.side);
  showToast('GIANT ROBOT!', 'It shoots a laser from its eye, punches and sends small robots. Work together, and aim for the head!');
}
// Where a shot lands on the robot: 'head' (extra damage), 'body', or 'armor' (legs and fists: no damage).
function robotPart(x, y) {
  if (!RB.on || RB.dead || RB.state === 'off') return null;
  const lx = x - RB.x, ly = y - RB.y - RB.bob;
  if (Math.abs(lx) < 54 && ly > ROBOT_HIP + 212 && ly < ROBOT_HIP + 292) return 'head';
  if (ly > 228 && ly < 404 && Math.abs(lx) < 95 + (ly - 228) * 0.1) return 'body';
  if (ly > ROBOT_HIP - 6 && ly < ROBOT_HIP + 36 && Math.abs(lx) < 64) return 'body';
  if (ly > -2 && ly < ROBOT_HIP && Math.abs(lx) < 78) return 'armor';
  for (const a of RB.arms) if ((x - a.fx) ** 2 + (y - a.fy) ** 2 < 34 * 34) return 'armor';
  const sh = rbShoulder(-1), sh2 = rbShoulder(1);
  if (Math.hypot(x - sh[0], y - sh[1]) < 30 || Math.hypot(x - sh2[0], y - sh2[1]) < 30) return 'armor';
  return null;
}
// Which arm (0 or 1) a shot hits, counting the fist and the piston arm; -1 for neither.
function robotArmAt(x, y) {
  for (let i = 0; i < 2; i++) {
    const a = RB.arms[i], [sx, sy] = rbShoulder(a.side);
    if (!a.lost && (x - a.fx) ** 2 + (y - a.fy) ** 2 < 36 * 36) return i;
    if (segDist(x, y, sx, sy, Math.atan2(a.fy - sy, a.fx - sx), Math.hypot(a.fx - sx, a.fy - sy)) < 16) return i;
  }
  return -1;
}
// Five Cannon hits on one arm and its hand falls off: that arm can't punch any more.
function loseHand(i) {
  const a = RB.arms[i], R = RB.mesh;
  a.lost = true; a.mode = 'back';
  if (R) spawnDebris([[-29, -27], [29, -27], [29, 27], [-29, 27]], R.M.plate, a.fx, a.fy, a.side * (150 + Math.random() * 150), 280);
  robotBoom(a.fx, a.fy, false);
  showToast('Hand blown off!', 'That arm can’t punch any more.');
}
function robotShot(x, y, dmg, by, kind = 0) {
  if (RB.on && !RB.dead && RB.state !== 'off') {
    const i = robotArmAt(x, y);
    if (i >= 0) {
      const a = RB.arms[i];
      if (kind === 1 && !a.lost) {
        a.hits = (a.hits || 0) + 1;
        a.hitFlash = 0.15;
        for (let j = 0; j < 10; j++) emit(x, y, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, 0.35, j % 2 ? FIRE : WHITE, 0.4, 3 + Math.random() * 3);
        if (a.hits >= 5) loseHand(i);
      } else {
        for (let j = 0; j < 4; j++) emit(x, y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.2, j % 2 ? ROBOT_ORANGE : WHITE, 0.3, 2.5);
      }
      return true;
    }
  }
  const part = robotPart(x, y);
  if (!part) return false;
  if (part === 'armor') {
    for (let j = 0; j < 4; j++) emit(x, y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.2, j % 2 ? ROBOT_ORANGE : WHITE, 0.3, 2.5);
    return true;
  }
  hurtRobot(dmg * (part === 'head' ? 1.5 : 1), by);
  for (let j = 0; j < 5; j++) emit(x, y, (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, 0.25, j % 2 ? ENEMY_RED : WHITE, 0.2, 3);
  return true;
}
function hurtRobot(dmg, by) {
  if (!RB.on || RB.dead) return;
  RB.hp -= dmg;
  RB.flash = 0.08;
  if (RB.hp > 0) { const st = robotStage(); while (RB.stage < st) breakRobot(++RB.stage); }
  if (RB.hp <= 0) {
    RB.hp = 0; RB.dead = true; RB.state = 'dying';
    RB.ct = 0; RB.rot = 0; RB.rotV = 0; RB.kneel = 0; RB.down = false; RB.downT = 0; RB.combo = null;
    RB.fd = (W - 40 - RB.x) >= (RB.x - 905) ? 1 : -1;   // fall toward the side with more room
    if (by) by.score += 5;
    if (RB.laser) { SH.lasers = SH.lasers.filter((L) => L !== RB.laser); RB.laser = null; }
    for (const e of SH.enemies) killEnemy(e, null);
    for (const a of RB.arms) a.mode = 'rest';
    cutscene(true);
  }
}
// Falling-off pieces: real little shapes that tumble, bounce and stay lying on the floor.
const DEBRIS = [];
function spawnDebris(pts, mat, x, y, vx, vy) {
  const m = new THREE.Mesh(shapeGeo(pts), mat);
  m.position.set(x, y, 0.97);
  SHIP_GROUP.add(m);
  DEBRIS.push({ m, x, y, vx, vy, a: Math.random() * 6, va: (Math.random() - 0.5) * 12, rest: false });
  if (DEBRIS.length > 50) { const d = DEBRIS.shift(); SHIP_GROUP.remove(d.m); d.m.geometry.dispose(); }
}
function clearDebris() { for (const d of DEBRIS) { SHIP_GROUP.remove(d.m); d.m.geometry.dispose(); } DEBRIS.length = 0; }
function stepDebris(h) {
  for (const d of DEBRIS) {
    if (d.rest) continue;
    d.vy -= 900 * h;
    const nx = d.x + d.vx * h, ny = d.y + d.vy * h;
    if (solidAt(nx, ny - 6)) {
      if (Math.abs(d.vy) < 90 && Math.abs(d.vx) < 60) d.rest = true;
      if (solidAt(nx, d.y - 6)) d.vx *= -0.4; else { d.vy *= -0.35; d.vx *= 0.6; }
      d.va *= 0.5;
      if (Math.abs(d.vy) > 60) for (let i = 0; i < 3; i++) emit(d.x, d.y - 4, (Math.random() - 0.5) * 80, Math.random() * 40, 0.4, ROBOT_DUST, 1, 2 + Math.random() * 2);
    } else { d.x = nx; d.y = ny; d.a += d.va * h; }
  }
}
function drawDebris() { for (const d of DEBRIS) { d.m.position.x = d.x; d.m.position.y = d.y; d.m.rotation.z = d.a; } }
// One more step of breaking: a small blast and a piece flies off.
function breakRobot(n) {
  const R = RB.mesh;
  if (!R) return;
  const D = R.dmg, M = R.M;
  const at = (lx, ly) => rbLocal(lx * RB.dir, ly + RB.bob);
  const fling = () => [(Math.random() - 0.5) * 380, 180 + Math.random() * 260];
  const shards = (lx, ly, k) => {
    const [x, y] = at(lx, ly);
    for (let i = 0; i < k; i++) { const s = 6 + Math.random() * 10, [vx, vy] = fling(); spawnDebris([[-s, -s * 0.6], [s, -s * 0.4], [0, s]], Math.random() < 0.5 ? M.plate : M.steel, x, y, vx, vy); }
  };
  const boom = (lx, ly) => { const [x, y] = at(lx, ly); robotBoom(x, y, false); };
  const piece = (obj, pts, mat, lx, ly) => { obj.visible = false; const [x, y] = at(lx, ly), [vx, vy] = fling(); spawnDebris(pts, mat, x, y, vx, vy); };
  const HY = ROBOT_HIP + 250;
  if (n === 1) { boom(-50, 340); shards(-50, 340, 5); }
  if (n === 2) {
    piece(D.ant2, [[-2, -11], [2, -11], [2, 11], [-2, 11]], M.joint, 32, HY + 46);
    D.tipGone[1] = true;
    boom(20, HY + 10); shards(20, HY, 3);
  }
  if (n === 3) {
    const sh = rbShoulder(-1);
    R.arms[0].pad.visible = false;
    spawnDebris([[-38, -8], [38, -8], [30, 28], [-30, 32]], M.plate, sh[0], sh[1] + 10, -200 + Math.random() * 100, 260);
    robotBoom(sh[0], sh[1], false);
    piece(D.crest, [[-14, -13], [14, -13], [5, 14], [-5, 14]], M.stripe, 0, HY + 50);
  }
  if (n === 4) {
    D.chestPlate.visible = false;
    const [x, y] = at(0, 316);
    spawnDebris([[-80, -74], [0, -74], [0, 76], [-92, 76]], M.plate, x - 30, y, -260 - Math.random() * 120, 300);
    spawnDebris([[0, -74], [80, -74], [92, 76], [0, 76]], M.plate, x + 30, y, 260 + Math.random() * 120, 320);
    boom(0, 320); boom(-40, 280); shards(0, 320, 6);
  }
  if (n === 5) {
    const sh = rbShoulder(1);
    R.arms[1].pad.visible = false;
    spawnDebris([[-38, -8], [38, -8], [30, 28], [-30, 32]], M.plate, sh[0], sh[1] + 10, 200 - Math.random() * 100, 260);
    robotBoom(sh[0], sh[1], false);
    piece(D.finL, [[9, 14], [9, -32], [-10, -4], [-8, 24]], M.dark, -62, HY);
    piece(D.ant1, [[-2, -15], [2, -15], [2, 15], [-2, 15]], M.joint, -32, HY + 50);
    D.tipGone[0] = true;
    boom(0, HY); shards(0, HY, 4);
  }
  for (const s of ships) if (s.active) addShake(s, 0.7);
}
function robotBoom(x, y, big) {
  const n = big ? 90 : 26;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * (big ? 420 : 220);
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.9, i % 3 ? FIRE : i % 2 ? EMBER : WHITE, 0.4, 3 + Math.random() * (big ? 9 : 5));
  }
  emit(x, y, 0, 0, 0.3, FIRE, 0, big ? 160 : 60);
  if (P.smoke) for (let i = 0; i < (big ? 14 : 3); i++) emitSmoke(x, y, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80 + 20, 1.5 + Math.random(), 10 + Math.random() * 10);
  for (const s of ships) if (s.active) addShake(s, big ? 1.6 : 0.5);
}
function stepRobotFight(h) {
  if (SH.state === 'between') {
    SH.timer -= h;
    if (SH.timer <= 0) { SH.state = 'robot'; robotDrop(); }
    return;
  }
  if (SH.state !== 'robot') return;
  stepRobot(h);
  if (RB.state === 'gone') {
    RB.t -= h;
    if (RB.t <= 0) finishRun();
  }
}
function stepRobot(h) {
  stepDebris(h);
  for (const s of ships) s.robotCd = Math.max(0, (s.robotCd || 0) - h);
  RB.flash = Math.max(0, RB.flash - h);
  RB.roof = approach(RB.roof, RB.state === 'drop' ? 1 : 0, h * 1.5);
  if (RB.state === 'drop') {
    RB.vy -= 700 * h;
    RB.y += RB.vy * h;
    if (RB.y <= 56) {
      RB.y = 56; RB.vy = 0; RB.state = 'fight'; RB.boot = 1.2;
      for (const fx of [-50, 50]) for (let i = 0; i < 25; i++) emit(RB.x + fx, 60, (Math.random() - 0.5) * 300, Math.random() * 160, 0.6 + Math.random() * 0.5, Math.random() < 0.5 ? WHITE : ROBOT_ORANGE, 1, 3 + Math.random() * 5);
      if (P.smoke) for (let i = 0; i < 10; i++) emitSmoke(RB.x + (Math.random() - 0.5) * 160, 70, (Math.random() - 0.5) * 120, 20 + Math.random() * 40, 1.6 + Math.random(), 10 + Math.random() * 8);
      for (const s of ships) if (s.active) addShake(s, 1.6);
    }
    for (const a of RB.arms) [a.fx, a.fy] = rbRest(a.side);
    return;
  }
  if (RB.state === 'dying') { stepRobotDeath(h); return; }
  if (RB.state !== 'fight') return;
  // After landing it powers up: the eye flickers on, then it roars into action.
  if (RB.boot > 0) {
    RB.boot -= h;
    for (const a of RB.arms) { const [rx, ry] = rbRest(a.side); a.fx += (rx - a.fx) * Math.min(1, h * 10); a.fy += (ry - a.fy) * Math.min(1, h * 10); }
    if (RB.boot <= 0) {
      const [bx, by] = robotEye();
      emit(bx, by, 0, 0, 0.35, ENEMY_RED, 0, 110);
      for (let j = 0; j < 24; j++) { const a = Math.random() * Math.PI * 2; emit(bx, by, Math.cos(a) * 220, Math.sin(a) * 220, 0.4, j % 2 ? ENEMY_RED : WHITE, 0, 3); }
      for (const s of ships) if (s.active) addShake(s, 0.9);
    }
    return;
  }
  const angry = robotAngry(), k = angry ? 0.7 : 1;
  const [ex, ey] = robotEye();
  const s = nearestPlayer(RB.x, RB.y + 300);
  RB.laserCd -= h; RB.punchCd -= h; RB.spawnCd -= h;
  const punching = RB.arms.some((a) => a.mode !== 'rest');
  const firing = RB.laser && RB.laser.phase === 'fire';
  // Small robots out of the chest hatch.
  const bots = SH.enemies.filter((e) => !e.dead).length;
  if (RB.spawnCd <= 0 && !RB.spawning && bots < 4) { RB.spawning = 1.6; RB.spawnCd = 11 * k; }
  if (RB.spawning > 0) {
    const before = RB.spawning;
    RB.spawning -= h;
    for (const at of angry ? [1.1, 0.8, 0.5] : [1.0, 0.6]) {
      if (before > at && RB.spawning <= at) {
        const hx = RB.x, hy = RB.y + 305 + RB.bob;
        spawnEnemy('bot', [hx, hy]);
        const e = SH.enemies[SH.enemies.length - 1];
        e.vx = RB.dir * (120 + Math.random() * 120) + (Math.random() - 0.5) * 120; e.vy = 120 + Math.random() * 120;
      }
    }
    if (RB.spawning < 0) RB.spawning = 0;
  }
  RB.hatch = approach(RB.hatch, RB.spawning > 0.25 ? 1 : 0, h * 3);
  // Eye laser: aims while it charges, then sweeps after you while it fires.
  // It aims, then LOCKS (the line goes thick and steady) and waits a moment before firing: that's your chance to dodge.
  if (s && !RB.laser && RB.laserCd <= 0 && !punching && (s.x - RB.x) * RB.dir >= 0) {   // its eye only sees forward
    startLaser(RB, Math.atan2(s.y - ey, s.x - ex));
    RB.laser.t = 1.3; RB.laser.fireT = 0.8;
    RB.laserCd = (angry ? 4.5 : 6.5) + Math.random();
  }
  if (RB.laser) {
    const L = RB.laser;
    if (L.phase === 'warn' && L.t > 0.45) {
      if (s) L.ang += clamp(wrapAngle(Math.atan2(s.y - ey, s.x - ex) - L.ang), -2.6 * h, 2.6 * h);
      if (Math.random() < h * 45) {   // energy gathering into the eye
        const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 30;
        emit(ex + Math.cos(a) * r, ey + Math.sin(a) * r, -Math.cos(a) * r * 3.2, -Math.sin(a) * r * 3.2, 0.3, Math.random() < 0.6 ? ENEMY_RED : WHITE, 0, 3 + Math.random() * 2);
      }
    } else if (L.phase === 'warn' && !L.locked) {
      L.locked = true;
      emit(ex, ey, 0, 0, 0.2, WHITE, 0, 60);
      for (let j = 0; j < 10; j++) { const a = Math.random() * Math.PI * 2; emit(ex, ey, Math.cos(a) * 160, Math.sin(a) * 160, 0.25, j % 2 ? ENEMY_RED : WHITE, 0, 3); }
    }
  }
  // Walk toward the nearest rocket when it is out of reach.
  let moving = false;
  if (s) {
    // It turns around slowly, so you can sneak behind it for a moment.
    const want = s.x < RB.x ? -1 : 1;
    if (want !== RB.dir) { RB.turnT = (RB.turnT || 0) + h; if (RB.turnT > (angry ? 0.9 : 1.4)) { RB.dir = want; RB.turnT = 0; } }
    else RB.turnT = 0;
    const gap = Math.abs(s.x - RB.x);
    if (!RB.laser && !punching && gap > 260 && want === RB.dir) {
      const nx = clamp(RB.x + RB.dir * (angry ? 95 : 70) * (RB.stage >= 4 ? 0.8 : 1) * h, ROBOT_XMIN, W - 170);
      moving = nx !== RB.x;
      RB.x = nx;
    }
  }
  if (moving) RB.phase += h * 5;
  else RB.phase = approach(RB.phase, Math.round(RB.phase / Math.PI) * Math.PI, h * 4);
  RB.bob = Math.abs(Math.sin(RB.phase)) * 5 + (RB.stage >= 4 && Math.sin(RB.phase) > 0 ? 7 * Math.sin(RB.phase) : 0);   // a limp once it's badly hurt
  // Heavy footsteps: dust and a little shake each time a foot comes down.
  const stepSign = Math.sin(RB.phase) >= 0 ? 1 : -1;
  if (moving && RB.lastStep && stepSign !== RB.lastStep) {
    const fx = RB.x + stepSign * 45;
    for (let i = 0; i < 10; i++) emit(fx + (Math.random() - 0.5) * 50, 60, (Math.random() - 0.5) * 160, 30 + Math.random() * 80, 0.5, i % 3 ? ROBOT_DUST : WHITE, 1, 3 + Math.random() * 3);
    for (const o of ships) if (o.active && Math.abs(o.x - RB.x) < 700) addShake(o, 0.25);
  }
  RB.lastStep = stepSign;
  if (P.smoke && Math.random() < h * 1.5) emitSmoke(RB.x + (Math.random() < 0.5 ? -64 : 64), RB.y + 470 + RB.bob, (Math.random() - 0.5) * 20, 40, 1.2, 6);
  robotDamageFx(h);
  // Punches: its right hand (on the screen's left) punches when you're in front of it; its LEFT hand (on the screen's right)
  // punches only when you're behind it. Random wind-up, aimed ahead of you or off to one side, sometimes a quick second jab.
  if (s && RB.punchCd <= 0 && !firing) {
    const behind = (s.x - RB.x) * RB.dir < 0;
    const side = behind ? 1 : -1;
    const a = RB.arms[side < 0 ? 0 : 1], [sx, sy] = rbShoulder(side);
    if (!a.lost && a.mode === 'rest' && Math.hypot(s.x - sx, s.y - sy) < ROBOT_REACH + 40) {
      startPunch(a, angry, false);
      RB.punchCd = (angry ? 0.5 : 0.9) + Math.random() * (angry ? 1.8 : 2.8);
      if (Math.random() < (angry ? 0.4 : 0.22)) RB.combo = { side, t: 0.25 + Math.random() * 0.35, wait: 2 };
    } else RB.punchCd = 0.2 + Math.random() * 0.5;
  }
  if (RB.combo) {
    const c = RB.combo, a = RB.arms[c.side < 0 ? 0 : 1];
    c.wait -= h;
    if (a.mode === 'rest') c.t -= h;
    const ok = s && ((s.x - RB.x) * RB.dir < 0) === (c.side > 0);   // the same rule: left hand only from behind
    if (c.t <= 0) { if (ok && !a.lost && !firing) startPunch(a, angry, true); RB.combo = null; }
    else if (c.wait <= 0) RB.combo = null;
  }
  for (const a of RB.arms) {
    const [sx, sy] = rbShoulder(a.side);
    if (a.mode === 'rest' || a.mode === 'back') {
      const [rx, ry] = rbRest(a.side);
      if (a.mode === 'rest') { a.fx += (rx - a.fx) * Math.min(1, h * 10); a.fy += (ry - a.fy) * Math.min(1, h * 10); }
      else {
        const dx = rx - a.fx, dy = ry - a.fy, d = Math.hypot(dx, dy), st = 900 * h;
        if (d <= st) { a.fx = rx; a.fy = ry; a.mode = 'rest'; } else { a.fx += dx / d * st; a.fy += dy / d * st; }
      }
    } else if (a.mode === 'wind') {
      const tgt = s ? { x: s.x + s.vx * (a.lead || 0) + (a.off || 0), y: s.y + s.vy * (a.lead || 0) + (a.offY || 0) } : { x: sx + a.side * 200, y: sy };
      const dx = tgt.x - sx, dy = tgt.y - sy, d = Math.hypot(dx, dy) || 1;
      a.ux = dx / d; a.uy = dy / d;
      a.fx += (sx - a.ux * 40 - a.fx) * Math.min(1, h * 12); a.fy += (sy - a.uy * 40 - 20 - a.fy) * Math.min(1, h * 12);
      a.t -= h;
      if (a.t <= 0) { a.mode = 'punch'; a.hit = false; a.fx = sx; a.fy = sy; }
    } else if (a.mode === 'punch') {
      a.fx += a.ux * (a.speed || 1700) * h; a.fy += a.uy * (a.speed || 1700) * h;
      for (const o of ships) {
        if (a.hit || !o.active || !o.alive) continue;
        if (Math.hypot(o.x - a.fx, o.y - a.fy) < 34 + SHIP_RADIUS * P.shipSize * 0.8) {
          a.hit = true;
          damage(o, 35);
          const m = shipMass(o);
          o.vx += a.ux * 560 / m; o.vy += (a.uy * 560 + 120) / m;
          o.landed = false;
          addShake(o, 1.2);
          for (let j = 0; j < 16; j++) emit(a.fx, a.fy, (Math.random() - 0.5) * 260, (Math.random() - 0.5) * 260, 0.35, j % 2 ? ROBOT_ORANGE : WHITE, 0.2, 4);
        }
      }
      const wall = solidAt(a.fx + a.ux * 28, a.fy + a.uy * 28);
      if (wall || Math.hypot(a.fx - sx, a.fy - sy) > ROBOT_REACH) {
        if (wall) {
          for (let j = 0; j < 14; j++) emit(a.fx, a.fy, (Math.random() - 0.5) * 220, (Math.random() - 0.5) * 220, 0.35, j % 2 ? ROBOT_ORANGE : WHITE, 0.6, 3);
          for (const o of ships) if (o.active && Math.hypot(o.x - a.fx, o.y - a.fy) < 400) addShake(o, 0.5);
        }
        a.mode = 'back';
      }
    }
  }
  // Bumping into its body hurts.
  const boxes = [[-112, 228, 112, 404], [-64, ROBOT_HIP - 6, 64, ROBOT_HIP + 36], [-54, ROBOT_HIP + 212, 54, ROBOT_HIP + 292], [-78, 0, 78, ROBOT_HIP]];
  for (const o of ships) {
    if (!o.active || !o.alive) continue;
    const r = SHIP_RADIUS * P.shipSize * 0.8, lx = o.x - RB.x, ly = o.y - RB.y - RB.bob;
    for (const [x0, y0, x1, y1] of boxes) {
      if (lx < x0 - r || lx > x1 + r || ly < y0 - r || ly > y1 + r) continue;
      const pen = [[lx - (x0 - r), -1, 0], [(x1 + r) - lx, 1, 0], [ly - (y0 - r), 0, -1], [(y1 + r) - ly, 0, 1]].sort((p, q) => p[0] - q[0])[0];
      o.x += pen[1] * pen[0]; o.y += pen[2] * pen[0];
      o.vx += pen[1] * 140; o.vy += pen[2] * 140;
      o.landed = false;
      if (!(o.robotCd > 0)) { o.robotCd = 0.6; damage(o, 10); }
      break;
    }
  }
}
function startPunch(a, angry, quick) {
  a.mode = 'wind';
  a.t = quick ? 0.16 + Math.random() * 0.12 : (angry ? 0.25 : 0.35) + Math.random() * (angry ? 0.35 : 0.55);
  a.lead = Math.random() * 0.35;
  a.off = (Math.random() - 0.5) * 120; a.offY = (Math.random() - 0.5) * 90;
  a.speed = 1300 + Math.random() * 700;
}
// The more it is hurt, the more sparks, smoke and fire come out of it.
function robotDamageFx(h) {
  const st = RB.stage, at = (lx, ly) => rbLocal(lx * RB.dir, ly + RB.bob);
  for (const a of RB.arms) {   // a hand-less arm sparks at the end; a badly hit one smokes
    if (a.lost && Math.random() < h * 14) for (let j = 0; j < 3; j++) emit(a.fx, a.fy, (Math.random() - 0.5) * 160, Math.random() * 120, 0.35, j % 2 ? EMBER : WHITE, 0.8, 2 + Math.random() * 2);
    else if (!a.lost && a.hits >= 3 && P.smoke && Math.random() < h * 4) emitSmoke(a.fx, a.fy, 0, 20, 0.9, 5);
  }
  if (st >= 1 && Math.random() < h * st * 2.5) {
    const [px, py] = at((Math.random() - 0.5) * 180, 240 + Math.random() * 220);
    for (let j = 0; j < 6; j++) emit(px, py, (Math.random() - 0.5) * 200, Math.random() * 160, 0.4, j % 2 ? EMBER : WHITE, 0.8, 2 + Math.random() * 2);
  }
  if (P.smoke && st >= 2 && Math.random() < h * st * 0.9) {
    const [px, py] = at((Math.random() - 0.5) * 160, 300 + Math.random() * 120);
    emitSmoke(px, py, (Math.random() - 0.5) * 30, 30 + Math.random() * 30, 1.4, 7 + Math.random() * 5);
  }
  if (RB.mesh) for (const f of RB.mesh.dmg.fires) {
    if (st < f.st || Math.random() > h * 10) continue;
    const [px, py] = at(f.lx, f.ly);
    emit(px + (Math.random() - 0.5) * 20, py, (Math.random() - 0.5) * 30, 60 + Math.random() * 80, 0.5, Math.random() < 0.5 ? FIRE : EMBER, -0.3, 3 + Math.random() * 4);
  }
}
// The end: it staggers, sparks and burns, topples over with a huge crash, its eye fades out... You beat the robot!
function stepRobotDeath(h) {
  RB.ct += h;
  const t = RB.ct, at = (lx, ly) => rbLocal(lx * RB.dir, ly);
  if (!RB.down) {
    if (t < 1.8) {
      RB.rot = Math.sin(t * 9) * 0.035 * (1 + t) - RB.fd * 0.04 * t;
      RB.kneel = Math.min(0.5, t * 0.35);
      if (Math.random() < h * 7) { const [x, y] = at((Math.random() - 0.5) * 200, 120 + Math.random() * 380); robotBoom(x, y, false); }
    } else {
      RB.rotV += (2.8 * Math.sin(Math.abs(RB.rot)) + 0.5) * h;
      RB.rot -= RB.fd * RB.rotV * h;
      RB.kneel = approach(RB.kneel, 0.2, h);
      if (Math.random() < h * 4) { const [x, y] = at((Math.random() - 0.5) * 200, 150 + Math.random() * 300); robotBoom(x, y, false); }
      if (Math.abs(RB.rot) >= Math.PI / 2) {
        RB.rot = -RB.fd * Math.PI / 2; RB.down = true; RB.downT = 0;
        const [cx, cy] = at(0, 260);
        for (const s of ships) if (s.active) addShake(s, 2.4);
        for (let k = 0; k < 90; k++) {
          const x = cx + (Math.random() - 0.5) * 620;
          emit(x, 62, (x - cx) * 1.6 + (Math.random() - 0.5) * 80, 30 + Math.random() * 140, 0.8 + Math.random() * 0.6, k % 3 ? ROBOT_DUST : WHITE, 0.6, 4 + Math.random() * 6);
        }
        if (P.smoke) for (let k = 0; k < 18; k++) emitSmoke(cx + (Math.random() - 0.5) * 560, 80, (Math.random() - 0.5) * 160, 20 + Math.random() * 60, 2 + Math.random() * 1.5, 12 + Math.random() * 10);
        robotBoom(cx, cy, true);
        const [hx, hy] = at(0, 460); robotBoom(hx, hy, true);
        for (let i = 0; i < 12; i++) { const s = 6 + Math.random() * 12; spawnDebris([[-s, -s * 0.6], [s, -s * 0.4], [0, s]], Math.random() < 0.5 ? RB.mesh.M.plate : RB.mesh.M.steel, cx + (Math.random() - 0.5) * 400, 90, (Math.random() - 0.5) * 500, 200 + Math.random() * 300); }
      }
    }
  } else {
    RB.downT += h;
    const b = RB.downT < 0.45 ? Math.sin(RB.downT / 0.45 * Math.PI) * 0.07 : 0;   // a little bounce on impact
    RB.rot = -RB.fd * (Math.PI / 2 - b);
    if (RB.downT < 1.6 && Math.random() < h * 3) { const [x, y] = at((Math.random() - 0.5) * 200, 150 + Math.random() * 300); robotBoom(x, y, false); }
    if (P.smoke && Math.random() < h * 5) { const [x, y] = at((Math.random() - 0.5) * 180, 100 + Math.random() * 380); emitSmoke(x, y, (Math.random() - 0.5) * 20, 30 + Math.random() * 30, 2, 9 + Math.random() * 6); }
    if (RB.downT > 2.4 && !RB.titleShown) { RB.titleShown = true; showCutTitle(); }
    if (RB.downT > 6 && !RB.finished) { RB.finished = true; finishRun(); }
  }
  // Arms go limp: the fists drop and drag on the floor.
  for (const a of RB.arms) {
    const [sx, sy] = rbShoulder(a.side);
    const tx = sx + a.side * 20, ty = Math.max(84, sy - 160);
    a.fx += (tx - a.fx) * Math.min(1, h * 4); a.fy += (ty - a.fy) * Math.min(1, h * 4);
  }
  robotDamageFx(h * 0.6);
}
// Cutscene overlay: black bars slide in, then the big title.
const cutUI = (() => {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:30;display:none;';
  const bar = (top) => {
    const b = document.createElement('div');
    b.style.cssText = `position:absolute;left:0;right:0;${top ? 'top' : 'bottom'}:0;height:0;background:#000;transition:height 0.8s ease;`;
    wrap.appendChild(b);
    return b;
  };
  const top = bar(true), bot = bar(false);
  const title = document.createElement('div');
  title.textContent = 'You beat the robot!';
  title.style.cssText = 'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%) scale(0.5);text-align:center;font:900 clamp(34px,7vw,88px)/1.1 system-ui,-apple-system,"Segoe UI",sans-serif;color:#ffd23f;letter-spacing:0.02em;text-shadow:0 0 28px rgba(255,140,40,0.85),0 5px 0 #7a3a00;opacity:0;transition:opacity 0.6s ease,transform 0.9s cubic-bezier(.2,1.6,.4,1);padding:0 16px;';
  wrap.appendChild(title);
  stage.appendChild(wrap);
  return { wrap, top, bot, title };
})();
function cutscene(on) {
  RB.cut = on;
  cutUI.wrap.style.display = on ? 'block' : 'none';
  cutUI.title.style.opacity = '0';
  cutUI.title.style.transform = 'translateY(-50%) scale(0.5)';
  cutUI.top.style.height = cutUI.bot.style.height = '0';
  if (on) requestAnimationFrame(() => requestAnimationFrame(() => { cutUI.top.style.height = cutUI.bot.style.height = '11%'; }));
}
function showCutTitle() { cutUI.title.style.opacity = '1'; cutUI.title.style.transform = 'translateY(-50%) scale(1)'; }
function robotText() {
  if (SH.state === 'between') return 'Something big is coming...';
  if (SH.state === 'done') return 'Robot destroyed!';
  if (RB.state === 'drop') return 'GIANT ROBOT!';
  if (RB.state === 'dying' || RB.state === 'gone') return RB.down ? 'You beat the robot!' : 'The robot is going down!';
  const hurt = ['', ' · cracked', ' · damaged', ' · badly damaged', ' · falling apart', ' · almost broken'][RB.stage || 0];
  const bots = SH.enemies.length;
  return `GIANT ROBOT${robotAngry() ? ' (angry!)' : ''}${hurt}${bots ? ` · ${bots} small robot${bots > 1 ? 's' : ''}` : ''}`;
}
function drawRobot(now) {
  const R = RB.mesh;
  if (!R) return;
  const vis = RB.on && RB.state !== 'off' && RB.state !== 'gone';
  R.g.visible = vis;
  for (const a of R.arms) a.g.visible = vis;
  if (RB.roofMesh) { RB.roofMesh.hl.position.x = -75 - RB.roof * 150; RB.roofMesh.hr.position.x = 75 + RB.roof * 150; }
  if (!vis) return;
  const dying = RB.state === 'dying', px = (RB.fd || 1) * 112;
  drawDebris();
  R.g.position.set(RB.x + px + (dying && !RB.down ? (Math.random() - 0.5) * 5 : 0), RB.y, 0.9);
  R.g.rotation.z = RB.rot || 0;
  R.body.scale.x = RB.dir;
  R.body.position.set(-px, RB.bob, 0);
  R.head.rotation.z = dying ? -0.3 : RB.stage >= 4 ? -0.2 : 0;
  const D = R.dmg, st = RB.stage || 0;
  D.cracks.forEach((m, i) => { m.visible = st >= i + 1; });
  D.visorCrack.visible = st >= 2;
  for (const f of D.scorch) f.m.visible = st >= f.st;
  for (const f of D.fires) { f.m.visible = st >= f.st; if (f.m.visible) { f.m.material.opacity = 0.5 + Math.random() * 0.4; f.m.scale.set(0.85 + Math.random() * 0.3, 0.8 + Math.random() * 0.5, 1); } }
  for (const L of R.legs) {
    const sw = Math.sin(RB.phase + (L.side > 0 ? Math.PI : 0));
    L.hip.rotation.z = dying ? RB.kneel * 0.5 : sw * 0.32;
    L.knee.rotation.z = dying ? -RB.kneel * 1.1 : -Math.max(0, -sw) * 0.5;
    L.foot.rotation.z = -L.hip.rotation.z - L.knee.rotation.z;
    L.flame.visible = RB.state === 'drop';
    if (L.flame.visible) L.flame.scale.y = 0.7 + Math.random() * 0.5;
  }
  R.doorL.position.x = -19 - RB.hatch * 36; R.doorR.position.x = 19 + RB.hatch * 36;
  R.hatchGlow.material.opacity = 0.15 + 0.6 * RB.hatch;
  const L = RB.laser, warn = L && L.phase === 'warn';
  const locked = !!(L && warn && L.locked), booting = RB.state === 'fight' && RB.boot > 0;
  let eo = L ? (warn ? (locked ? 1 : 0.6 + 0.4 * Math.sin(now / 35)) : 1) : 0.35 + 0.1 * Math.sin(now / 300);
  if (booting) eo = RB.boot > 0.5 ? 0.05 : (Math.sin(now / 25) > 0 ? 0.95 : 0.1);
  if (RB.state === 'drop') eo = 0.05;
  if (st >= 4 && !dying && Math.random() < 0.1) eo *= 0.15;   // a damaged, flickering eye
  if (dying) eo = !RB.down ? (Math.random() < 0.3 ? 0.1 : 0.9) : RB.downT < 1.8 ? (Math.sin(now / 45) > 0.2 ? 0.7 * (1 - RB.downT / 1.8) : 0.03) : 0;
  R.eyeGlow.material.opacity = eo;
  R.eyeGlow.scale.setScalar(L && !warn ? 1.9 : locked ? 1.4 : 1);
  R.scan.position.x = Math.sin(now / 260) * 36;
  R.scan.material.opacity = eo > 0.2 ? 0.85 : 0;
  const angryNow = robotAngry();
  R.M.energy.color.copy(angryNow ? ENEMY_RED : ROBOT_ORANGE);
  R.M.energy.opacity = RB.state === 'drop' || booting ? 0.15 : 0.3 + 0.22 * Math.sin(now / (angryNow ? 70 : 220));
  for (const ex of R.exhaust) { ex.material.opacity = (RB.state === 'drop' ? 0.9 : 0.3) + Math.random() * 0.3; ex.scale.y = RB.state === 'drop' ? 1.8 : 1; }
  R.tips.forEach((t, i) => { t.visible = !D.tipGone[i] && !(dying && RB.down) && Math.sin(now / 180 + i * 2.5) > -0.3; });
  if (dying && RB.down) { R.M.energy.opacity = Math.max(0, 0.5 - RB.downT * 0.25); R.scan.material.opacity = 0; }
  R.coreGlow.material.opacity = (robotAngry() ? 0.6 + 0.4 * Math.sin(now / 90) : 0.45 + 0.15 * Math.sin(now / 400));
  const white = RB.flash > 0 || (dying && !RB.down && Math.sin(now / 50) > 0.6);
  R.M.steel.color.copy(white ? WHITE : R.base.steel);
  R.M.plate.color.copy(white ? WHITE : R.base.plate);
  RB.arms.forEach((a, i) => {
    const A = R.arms[i], [sx, sy] = rbShoulder(a.side);
    const dx = a.fx - sx, dy = a.fy - sy, len = Math.max(1, Math.hypot(dx, dy)), ang = Math.atan2(dy, dx);
    for (const [m, l, w] of [[A.rod, len, 20], [A.coil, len, 6], [A.piston, Math.min(len, 150), 40], [A.band, Math.min(len, 150) * 0.2, 42]]) {
      m.position.set(sx, sy, m.position.z); m.rotation.z = ang; m.scale.set(Math.max(1, l), w, 1);
    }
    A.band.position.set(sx + Math.cos(ang) * Math.min(len, 150) * 0.6, sy + Math.sin(ang) * Math.min(len, 150) * 0.6, A.band.position.z);
    A.shoulder.position.set(sx, sy, A.shoulder.position.z);
    A.pad.position.set(sx, sy + 6, A.pad.position.z);
    A.pad.scale.x = a.side;
    A.pad.rotation.z = RB.rot || 0;
    A.fist.position.set(a.fx, a.fy, A.fist.position.z);
    A.fist.visible = !a.lost;
    if (a.hitFlash > 0) a.hitFlash -= 1 / 60;
    A.fist.rotation.z = ang;
    A.fistGlow.material.opacity = a.mode === 'wind' ? 0.5 + 0.4 * Math.sin(now / 30) : a.mode === 'punch' ? 0.8 : 0;
  });
}

/* ------------------------------------------------------------------ *
 * The Big laser: weapon 4. One shot per match, and dying does not give it back.
 * ------------------------------------------------------------------ */
const BIG = { charge: 0.35, fire: 0.75, width: 44, damage: 90, enemyDamage: 260, push: 380 };
const LASER_IDX = WEAPONS.findIndex((w) => w.id === 'laser');
const bigFree = () => isPractice() && PR.infiniteAmmo;   // Practice with infinite ammo: fire it as often as you like
const pbeams = ships.map((s) => {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0.5, 0, 0);
  const add = (mat, z) => { const m = new THREE.Mesh(geo, mat); m.position.z = z; m.frustumCulled = false; m.visible = false; scene.add(m); return m; };
  const glow = add(new THREE.MeshBasicMaterial({ color: s.hex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 2.5);
  const core = add(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 2.55);
  const orb = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat(s.color, 0.95));
  orb.position.z = 2.6; orb.frustumCulled = false; orb.visible = false;
  scene.add(orb);
  return { glow, core, orb };
});
function fireBigLaser(s) {
  if (s.beam || (!(s.bigLaser > 0) && !bigFree())) return;
  if (!bigFree()) s.bigLaser = 0;
  sfx.laserCharge(s);
  s.beam = { phase: 'charge', t: BIG.charge, hit: new Set(), len: 0, ox: s.x, oy: s.y, ang: s.a + Math.PI / 2, carveT: 0 };
  s.fireCd = 0.4;
  updateWeaponButtons();
}
function stepBigLaser(s, h) {
  const b = s.beam;
  if (!b) return;
  const nose = localToWorld(s, 0, 13);
  b.ox = nose.x; b.oy = nose.y; b.ang = s.a + Math.PI / 2;   // follows the nose, so you can sweep it
  b.t -= h;
  s.fireCd = Math.max(s.fireCd, 0.1);
  if (b.phase === 'charge') {
    const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 20;
    emit(b.ox + Math.cos(a) * r, b.oy + Math.sin(a) * r, -Math.cos(a) * r * 3 + s.vx, -Math.sin(a) * r * 3 + s.vy, 0.3, Math.random() < 0.5 ? s.color : WHITE, 0, 3 + Math.random() * 3);
    if (b.t <= 0) {
      b.phase = 'fire';
      b.t = BIG.fire;
      sfx.laserFire(s);
      addShake(s, 1.4);
      for (const o of ships) if (o !== s && o.active) addShake(o, 0.6);
      const m = shipMass(s);
      s.vx -= Math.cos(b.ang) * BIG.push / m; s.vy -= Math.sin(b.ang) * BIG.push / m;
      s.landed = false;
    }
    return;
  }
  // The beam burns through rock (digging a tunnel) and stops at hard walls and pads.
  const dx = Math.cos(b.ang), dy = Math.sin(b.ang);
  let d = 0;
  while (d < 2200) {
    const v = maskAt(b.ox + dx * d, b.oy + dy * d);
    if (v === 2 || v === 3 || (v === 1 && !P.destructible)) break;
    d += 5;
  }
  b.len = d;
  if (level.theme === 'floors') hitBreakable(b.ox + dx * (d + 3), b.oy + dy * (d + 3));
  b.carveT -= h;
  if (b.carveT <= 0 && P.destructible && level.theme !== 'floors') {
    b.carveT = 0.06;
    for (let t = 8; t < d; t += 14) {
      const x = b.ox + dx * t, y = b.oy + dy * t;
      if (solidAt(x, y) || solidAt(x + dy * 18, y - dx * 18) || solidAt(x - dy * 18, y + dx * 18)) { if (Math.random() < 0.05) terrainDebris(x, y, 0.5); carve(x, y, BIG.width * 0.5); }
    }
  }
  const half = BIG.width / 2;
  if (level.theme === 'desert' && WORM.state === 'fly' && segDist(WORM.hx, WORM.hy, b.ox, b.oy, b.ang, d) < half + WORM_R) killWorm();
  if (level.theme === 'forest' && DINO.active && segDist(DINO.x, DINO.y + 36 * DINO_S, b.ox, b.oy, b.ang, d) < half + 40 * DINO_S) killDino();
  for (const o of ships) {
    if (o === s || !o.active || !o.alive || b.hit.has(o) || level.theme === 'floors' || level.theme === 'ship') continue;
    if (segDist(o.x, o.y, b.ox, b.oy, b.ang, d) < half + SHIP_RADIUS * P.shipSize * 0.8) {
      b.hit.add(o);
      damage(o, BIG.damage);
      const m = shipMass(o);
      o.vx += dx * 320 / m; o.vy += dy * 320 / m;
      o.landed = false;
      for (let j = 0; j < 20; j++) emit(o.x, o.y, (Math.random() - 0.5) * 260, (Math.random() - 0.5) * 260, 0.4, j % 2 ? s.color : WHITE, 0.2, 4);
    }
  }
  if (level.theme === 'ship') {
    for (const e of SH.enemies) {
      if (e.dead || b.hit.has(e)) continue;
      if (segDist(e.x, e.y, b.ox, b.oy, b.ang, d) < half + e.K.r) {
        b.hit.add(e);
        e.hp -= BIG.enemyDamage;
        e.flash = 0.15;
        if (e.hp <= 0) killEnemy(e, s);
      }
    }
    if (SH.spec && SH.spec.mode === 'robot' && RB.on && !RB.dead && !b.hit.has(RB) && segDist(RB.x, RB.y + 300, b.ox, b.oy, b.ang, d) < half + 120) {
      b.hit.add(RB);
      hurtRobot(BIG.enemyDamage, s);
    }
  }
  const ex = b.ox + dx * d, ey = b.oy + dy * d;
  for (let j = 0; j < 3; j++) emit(ex, ey, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, 0.35, j % 2 ? s.color : WHITE, 0.3, 4 + Math.random() * 4);
  if (b.t <= 0) {
    s.beam = null;
    if (s.weapon === LASER_IDX && !bigFree()) { s.weapon = 0; animateWeaponBox(s.id, LASER_IDX, 0); updateWeaponButtons(); }
  }
}
function drawBigLasers(now) {
  ships.forEach((s, i) => {
    const pb = pbeams[i], b = s.alive ? s.beam : null;
    pb.orb.visible = !!b;
    pb.glow.visible = pb.core.visible = !!b && b.phase === 'fire';
    if (!b) return;
    const k = b.phase === 'charge' ? 1 - b.t / BIG.charge : 1;
    pb.orb.position.set(b.ox, b.oy, 2.6);
    pb.orb.scale.setScalar(b.phase === 'charge' ? 14 + 50 * k : 70 + 10 * Math.sin(now / 30));
    if (b.phase !== 'fire') return;
    const fade = Math.min(1, b.t / 0.15);
    for (const [m, w, op] of [[pb.glow, BIG.width + 26, 0.6], [pb.core, BIG.width * 0.42, 1]]) {
      m.position.set(b.ox, b.oy, m.position.z);
      m.rotation.z = b.ang;
      m.scale.set(Math.max(1, b.len), w * (0.85 + 0.15 * Math.sin(now / 25)) * fade, 1);
      m.material.opacity = op;
    }
  });
}

/* ------------------------------------------------------------------ *
 * Input: keyboard and gamepads merged into one action state per player
 * ------------------------------------------------------------------ */
const KEYMAP = [
  { left: ['KeyA'], right: ['KeyD'], thrust: ['KeyW'], fire: ['ShiftLeft'] },
  // "-" sits at a different physical key per layout: beside right Shift on Nordic/German (Slash), beside Backspace on US (Minus).
  { left: ['ArrowLeft'], right: ['ArrowRight'], thrust: ['ArrowUp'], fire: ['Slash', 'Minus', 'NumpadSubtract'] },
];
const GAME_CODES = new Set(KEYMAP.flatMap((m) => Object.values(m).flat()));
const keysDown = new Set();
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target) || document.getElementById('jsonDialog').open) return;
  if (!startEl.hidden) { startKey(e); return; }
  if (picker.open) { pickerKey(e); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (GAME_CODES.has(e.code)) {
    e.preventDefault();
    keysDown.add(e.code);
    return;
  }
  if ((e.code === 'KeyS' || e.code === 'ArrowDown') && !e.repeat) {
    e.preventDefault();
    if (!game.paused) cycleWeapon(ships[isSolo() || e.code === 'KeyS' ? 0 : 1]);
    return;
  }
  if (e.code === 'KeyP' && !e.repeat) { e.preventDefault(); togglePause(); }
  if (e.code === 'KeyM' && !e.repeat) { e.preventDefault(); P.sound = !P.sound; pane.refresh(); }
  if (e.code === 'KeyH' && !e.repeat) { e.preventDefault(); togglePanel(); }
  if (e.code === 'KeyU' && !e.repeat) { e.preventDefault(); toggleUI(); }
  if (e.code === 'KeyN' && !e.repeat) { e.preventDefault(); openStart(); }
  if (e.code === 'KeyR' && !e.repeat && isPractice()) { e.preventDefault(); restartMatch(); }
  if (e.code === 'KeyR' && !e.repeat && level.theme === 'ship' && SH.state === 'done') { e.preventDefault(); restartStarship(); }
  const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
  if (digit && !e.repeat && level.theme === 'ship' && SH.state === 'choose') { e.preventDefault(); chooseLevel(+digit[1]); }
  if (e.code === 'KeyQ' && !e.repeat && !isPractice()) { e.preventDefault(); nextMap(); }
});
window.addEventListener('keyup', (e) => { keysDown.delete(e.code); });
window.addEventListener('blur', () => keysDown.clear());

const held = (codes) => codes.some((c) => keysDown.has(c));
const padsSeen = [];

function readInputs() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const s of ships) {
    const map = KEYMAP[s.id];
    let turn = (held(map.left) ? 1 : 0) - (held(map.right) ? 1 : 0);
    let thrust = held(map.thrust) ? 1 : 0;
    let fireBtn = held(map.fire);
    const idx = s.id === 0 ? P.p1Pad : P.p2Pad;
    const gp = idx >= 0 ? pads[idx] : null;
    s.padActive = !!(gp && gp.connected);
    if (s.padActive) {
      const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const val = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      let ax = gp.axes[0] || 0;
      const dz = P.deadzone;
      ax = Math.abs(ax) < dz ? 0 : Math.sign(ax) * (Math.abs(ax) - dz) / (1 - dz);
      let padTurn = -ax;
      if (btn(14)) padTurn = 1;
      if (btn(15)) padTurn = -1;
      turn = clamp(turn + padTurn, -1, 1);
      thrust = Math.max(thrust, btn(0) ? 1 : 0, btn(12) ? 1 : 0, val(7));
      fireBtn = fireBtn || btn(2) || btn(1) || btn(5);
      // Y (or the left bumper) switches weapon, once per press
      const sw = btn(3) || btn(4);
      if (sw && !s.padSwitch && !game.paused) cycleWeapon(isSolo() ? ships[0] : s);
      s.padSwitch = sw;
    }
    s.input.turn = turn;
    s.input.thrust = thrust;
    s.input.fire = fireBtn;
  }
  if (isSolo()) {
    // One ship: both key clusters and both pads fly it.
    const a = ships[0].input, b = ships[1].input;
    a.turn = clamp(a.turn + b.turn, -1, 1);
    a.thrust = Math.max(a.thrust, b.thrust);
    a.fire = a.fire || b.fire;
    ships[0].padActive = ships[0].padActive || ships[1].padActive;
  }
  padsSeen.length = 0;
  for (let i = 0; i < pads.length; i++) if (pads[i]) padsSeen.push(`Gamepad ${i + 1}: ${pads[i].id.replace(/\s*\(.*\)\s*/g, ' ').trim().slice(0, 30)}`);
}

const KEY_NAMES = { Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter', NumpadEnter: 'Enter', Numpad0: 'Num 0', ShiftLeft: 'L Shift', Slash: '-', Minus: '-', NumpadSubtract: '-' };
const prettyKey = (c) => KEY_NAMES[c] || c.replace(/^Key/, '').replace(/^Digit/, '');

/* ------------------------------------------------------------------ *
 * Cameras, split screen and the loop
 * ------------------------------------------------------------------ */
const cams = [0, 1].map(() => new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10));
// Layer 1 is seen only by Player 1's camera and layer 2 only by Player 2's (used for the opponent pointers).
cams.forEach((c, i) => c.layers.enable(i + 1));
let viewW = 1, viewH = 1;
new ResizeObserver(() => {
  viewW = Math.max(1, stage.clientWidth);
  viewH = Math.max(1, stage.clientHeight);
  renderer.setSize(viewW, viewH, false);
}).observe(stage);

function viewRects() {
  if (isSolo()) return [{ x: 0, y: 0, w: viewW, h: viewH }];
  if (P.split === 'stacked') {
    const top = Math.floor(viewH / 2);
    return [{ x: 0, y: viewH - top, w: viewW, h: top }, { x: 0, y: 0, w: viewW, h: viewH - top }];
  }
  const left = Math.floor(viewW / 2);
  return [{ x: 0, y: 0, w: left, h: viewH }, { x: left, y: 0, w: viewW - left, h: viewH }];
}

// Clear space only: an arrow in each player's view that points at the opponent.
// Off screen it sits on the edge of the view; on screen it hovers over the opponent, pointing down.
const pointerGeo = shapeGeo([[0, 9], [8, -6], [0, -2.5], [-8, -6]]);
const pointers = [0, 1].map((i) => {
  const hex = i === 0 ? P2HEX : P1HEX;   // Player 1 sees Player 2's colour, and the other way round
  const g = new THREE.Group();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), glowMat(new THREE.Color(hex), 0.35));
  const arrow = new THREE.Mesh(pointerGeo, new THREE.MeshBasicMaterial({ color: hex, transparent: true, side: THREE.DoubleSide }));
  arrow.position.z = 0.01;
  g.add(glow, arrow);
  g.visible = false;
  g.traverse((o) => o.layers.set(i + 1));
  scene.add(g);
  return { g, arrow, glow };
});
function updatePointer(i, cx, cy, hw, hh, a) {
  const { g, arrow } = pointers[i], me = ships[i], o = ships[1 - i];
  const on = level.builtMap === 'clear' && !isPractice() && me.active && o.active && o.alive;
  g.visible = on;
  if (!on) return;
  const ox = o.px + (o.x - o.px) * a, oy = o.py + (o.y - o.py) * a;
  const k = 1 / P.zoom, m = 26 * k;
  const dx = ox - cx, dy = oy - cy;
  g.scale.setScalar(k * 1.3);
  if (Math.abs(dx) < hw - m && Math.abs(dy) < hh - m) {
    g.position.set(ox, oy + 22 * P.shipSize + 16 * k, 3);
    g.rotation.z = Math.PI;
  } else {
    const t = Math.min((hw - m) / Math.max(Math.abs(dx), 1e-6), (hh - m) / Math.max(Math.abs(dy), 1e-6));
    g.position.set(cx + dx * t, cy + dy * t, 3);
    g.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
  }
  arrow.material.opacity = 0.75 + 0.25 * Math.sin(game.time * 6);
}

// Starship only: red arrows on the edge of each player's view, pointing at every red robot that is off screen.
const enemyArrows = [0, 1].map((i) => Array.from({ length: 14 }, () => {
  const g = new THREE.Group();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), glowMat(ENEMY_RED, 0.4));
  const arrow = new THREE.Mesh(pointerGeo, new THREE.MeshBasicMaterial({ color: '#ff4d5e', side: THREE.DoubleSide }));
  arrow.position.z = 0.01;
  g.add(glow, arrow);
  g.visible = false;
  g.traverse((o) => o.layers.set(i + 1));
  scene.add(g);
  return g;
}));
function updateEnemyArrows(i, cx, cy, hw, hh) {
  const list = enemyArrows[i];
  let n = 0;
  if (level.theme === 'ship' && ships[i].active) {
    const k = 1 / P.zoom, m = 22 * k;
    for (const e of SH.enemies) {
      if (e.dead || n >= list.length) continue;
      const dx = e.x - cx, dy = e.y - cy;
      if (Math.abs(dx) < hw && Math.abs(dy) < hh) continue;   // already on screen
      const t = Math.min((hw - m) / Math.max(Math.abs(dx), 1e-6), (hh - m) / Math.max(Math.abs(dy), 1e-6));
      const g = list[n++];
      g.visible = true;
      g.position.set(cx + dx * t, cy + dy * t, 3.1);
      g.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
      g.scale.setScalar(k * (e.kind === 'boss' ? 1.9 : e.kind === 'jugg' ? 1.4 : 1));
    }
  }
  for (; n < list.length; n++) list[n].visible = false;
}

function updateCamera(i, rect, dt, alpha) {
  const s = ships[i], cam = cams[i], c = s.cam;
  let tx, ty;
  if (s.alive) {
    tx = s.px + (s.x - s.px) * alpha + s.vx * P.lookahead;
    ty = s.py + (s.y - s.py) * alpha + s.vy * P.lookahead;
  } else { tx = s.deathX; ty = s.deathY; }
  const cut = level.theme === 'ship' && RB.cut;
  if (cut) [tx, ty] = rbLocal(0, 260);   // the robot's last moments: every camera turns to watch it fall
  RB.camZ = approach(RB.camZ || 1, cut ? 0.78 : 1, dt * 0.6);
  const k = P.cameraLag > 0.001 ? 1 - Math.exp(-dt / (cut ? Math.max(P.cameraLag, 0.35) : P.cameraLag)) : 1;
  c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
  const zz = P.zoom * RB.camZ;
  const hw = rect.w / zz / 2, hh = rect.h / zz / 2;
  const cx = hw * 2 >= W ? W / 2 : clamp(c.x, hw, W - hw);
  const cy = hh * 2 >= H ? H / 2 : clamp(c.y, hh, H - hh);
  c.x = cx; c.y = cy;
  skyMesh.position.set(W / 2 + (cx - W / 2) * 0.55, H / 2 + (cy - H / 2) * 0.55, -1);
  let sx = 0, sy = 0;
  if (c.shake > 0.05) {
    sx = (Math.random() - 0.5) * 2 * c.shake;
    sy = (Math.random() - 0.5) * 2 * c.shake;
    c.shake *= Math.exp(-dt * 9);
  } else c.shake = 0;
  cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
  cam.position.set(cx + sx, cy + sy, 5);
  cam.updateProjectionMatrix();
  updatePointer(i, cx, cy, hw, hh, alpha);
  updateEnemyArrows(i, cx, cy, hw, hh);
}

function step(h) {
  game.time += h;
  matchClock += h;
  for (const s of ships) { s.px = s.x; s.py = s.y; s.pa = s.a; }
  for (const s of ships) if (s.active) updateShip(s, h);
  shipVsShip();
  stepBullets(h);
  stepParticles(h);
  stepTerrainBits(h);
  stepSmoke(h);
  if (level.theme === 'forest') { stepDino(h); stepPickup(h); }
  if (level.theme === 'desert') stepWorm(h);
  if (level.theme === 'floors') stepFloors(h);
  if (level.theme === 'ship') stepStarship(h);
  stepBoxes(h);
}

function drawPools() {
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

function drawDebug(s, alpha) {
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

/* HUD */
const floorOf = (s) => clamp(Math.floor((s.y - 300) / 400) + 2, 1, 10);
// The small top-centre panel shown while the UI is hidden: health bar, ammo strip and level.
const mini = {
  players: [0, 1].map((i) => {
    const el = document.querySelector(`.mh-p[data-p="${i}"]`);
    return { el, tag: el.querySelector('.mh-tag'), hp: el.querySelector('.mh-hp > i'), ammo: el.querySelector('.mh-ammo > i'), note: el.querySelector('.mh-note'), last: {} };
  }),
  level: document.getElementById('miniLevel'), last: {},
};
function setMini(key, value) {
  if (mini.last[key] === value) return;
  mini.last[key] = value;
  mini[key].textContent = value;
}
function setMP(m, key, value, apply) {
  if (m.last[key] === value) return;
  m.last[key] = value;
  apply(value);
}
function updateMiniHud() {
  const prac = isSolo();
  for (let i = 0; i < 2; i++) {
    const m = mini.players[i], s = ships[i];
    const show = !!s && !(prac && i === 1);
    setMP(m, 'show', show, (v) => { m.el.hidden = !v; });
    if (!show) continue;
    setMP(m, 'tag', prac ? '' : `P${i + 1}`, (v) => { m.tag.textContent = v; });
    const hp = s.alive ? Math.round(clamp(s.hp / 100, 0, 1) * 1000) / 10 : 0;
    // hue 120 = green at full health, 60 = yellow at half, 0 = red when empty
    setMP(m, 'hp', hp, (v) => { m.hp.style.width = `${v}%`; m.hp.style.backgroundColor = `hsl(${Math.round(v * 1.2)} 78% 50%)`; });
    const gun = s.alive && s.minigunT > 0;
    const am = gun ? s.minigunT / MINIGUN_TIME : clamp(s.ammo / P.ammoMax, 0, 1);
    setMP(m, 'ammo', Math.round(am * 1000) / 10, (v) => { m.ammo.style.width = `${v}%`; });
    setMP(m, 'gun', gun, (v) => { m.el.classList.toggle('minigun', v); });
    setMP(m, 'dead', !s.alive, (v) => { m.el.classList.toggle('dead', v); });
    setMP(m, 'note', !s.alive ? 'Respawning' : gun ? 'Minigun' : s.crossT > 0 ? `Crosshair ${Math.ceil(s.crossT)} s` : '', (v) => { m.note.textContent = v; });
  }
  let lv;
  if (level.theme === 'ship' && SH.state !== 'off') {
    const next = SH.wave + 1;
    if (SH.spec.mode === 'robot') lv = SH.state === 'done' ? 'Level: robot destroyed!' : 'Level: giant robot';
    else if (SH.state === 'fight') lv = WAVES[SH.wave].boss ? 'Level: boss' : `Level ${SH.wave + 1} of ${WAVES.length - 1}`;
    else if (SH.state === 'choose') lv = 'Level: choose 1 to 5';
    else if (SH.state === 'escape') lv = 'Level: escape!';
    else if (SH.state === 'done') lv = 'Level: escaped!';
    else lv = WAVES[next] && WAVES[next].boss ? 'Level: boss next' : `Level ${next + 1} next`;
  } else if (level.theme === 'floors') lv = `Level: floor ${floorOf(ships[0])} · floor ${floorOf(ships[1])}`;
  else lv = `Level: ${isPractice() ? 'Practice' : (MAPS[level.builtMap] || MAPS.cave).name}`;
  setMini('level', lv);
}
const huds = [...document.querySelectorAll('.hud')].map((el) => ({
  score: el.querySelector('.hud-score'), hull: el.querySelector('.meter-fill.hull'), ammo: el.querySelector('.meter-fill.ammo'),
  status: el.querySelector('.hud-status'), pad: el.querySelector('.hud-pad'), tele: el.querySelector('.hud-tele'), last: {},
}));
function setIfChanged(h, key, el, prop, value) {
  if (h.last[key] === value) return;
  h.last[key] = value;
  if (prop === 'text') el.textContent = value; else el.style[prop] = value;
}
function updateHud() {
  if (appEl.classList.contains('ui-hidden')) updateMiniHud();
  for (const s of ships) {
    const h = huds[s.id];
    setIfChanged(h, 'score', h.score, 'text', String(s.score));
    setIfChanged(h, 'hull', h.hull, 'transform', `scaleX(${(s.hp / 100).toFixed(3)})`);
    setIfChanged(h, 'ammo', h.ammo, 'transform', `scaleX(${clamp(s.ammo / P.ammoMax, 0, 1).toFixed(3)})`);
    let status = '';
    const back = `Back in ${Math.max(0, s.respawnT).toFixed(1)} s`;
    if (!s.alive) status = s.eaten ? `${level.theme === 'desert' ? 'Swallowed by the sandworm!' : 'Eaten by the dino!'} ${back}` : s.lava ? `Burned in the lava! ${back}` : back;
    else if (s.landed && s.onPad) status = (s.hp < 99.5 || s.ammo < P.ammoMax - 0.5) ? 'Rearming on the pad' : 'Ready on the pad';
    else if (s.landed) status = 'Landed';
    else if (s.invulnT > 0) status = 'Shielded';
    if (s.alive && level.theme === 'floors') {
      status = `Floor ${floorOf(s)} of 10 · lava ${Math.max(0, Math.round(s.y - FL.lava[s.id]))} below`;
    }
    if (s.alive && s.minigunT > 0) status = `Minigun! ${Math.ceil(s.minigunT)} s left`;
    if (s.alive && s.crossT > 0 && !status.startsWith('Minigun')) status = status ? `${status} · crosshair ${Math.ceil(s.crossT)} s` : `Crosshair ${Math.ceil(s.crossT)} s left`;
    if (s.alive && s.frozenT > 0) status = `Frozen! ${s.frozenT.toFixed(1)} s`;
    if (s.alive && s.ballT > 0) status = `Trapped in a ball! ${s.ballT.toFixed(1)} s`;
    if (s.alive && s.msgUntil > game.time) status = s.msg;
    setIfChanged(h, 'status', h.status, 'text', status);
    if (isPractice() && h.tele) {
      const tilt = Math.round(wrapAngle(s.a) / DEG);
      setIfChanged(h, 'tele', h.tele, 'text',
        `Speed ${Math.round(Math.hypot(s.vx, s.vy))}  ·  vx ${Math.round(s.vx)}  ·  vy ${Math.round(s.vy)}\n` +
        `Tilt ${tilt}°  ·  Thrust ${Math.round(s.thrust * 100)} %\n` +
        `Last impact ${Math.round(s.lastImpact)}  ·  safe ≤ ${P.safeImpact}`);
    }
    const idx = s.id === 0 ? P.p1Pad : P.p2Pad;
    setIfChanged(h, 'pad', h.pad, 'text', s.padActive ? `Gamepad ${idx + 1}: stick turns, A thrusts, X fires, Y switches weapon` : '');
  }
}

/* ------------------------------------------------------------------ *
 * Sound: every effect is synthesized live with the Web Audio API (no audio files).
 * Browsers only allow audio after a click or key press, so the engine starts on the first one.
 * ------------------------------------------------------------------ */
const sfx = (() => {
  let ctx = null, master = null, noiseBuf = null, verb = null;
  const lastAt = {}, engines = [];
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = P.sound ? P.volume : 0;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // A short synthetic cave echo, so blasts ring out a little.
    const len = Math.floor(ctx.sampleRate * 1.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    verb.connect(wet); wet.connect(master);
    for (let i = 0; i < 2; i++) engines.push(makeEngine(i));
  }
  // Engine: looping noise and a low buzz through a filter that opens up with thrust.
  function makeEngine(i) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 0.8;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 44 + i * 4;
    const og = ctx.createGain(); og.gain.value = 0.16;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(lp); osc.connect(og); og.connect(lp); lp.connect(g); g.connect(master);
    src.start(0, i * 0.7); osc.start();
    return { g, lp, osc };
  }
  const now = () => ctx.currentTime;
  // Gate: skip when muted or not started, and keep rapid repeats of one sound from piling up.
  function ready(name, gap) {
    if (!ctx || !P.sound || ctx.state !== 'running') return false;
    const t = now();
    if (lastAt[name] !== undefined && t - lastAt[name] < gap) return false;
    lastAt[name] = t;
    return true;
  }
  // Louder close to a ship, quieter across the map.
  function near(x, y) {
    let d = Infinity;
    for (const s of ships) if (s.active && s.alive) d = Math.min(d, Math.hypot(s.x - x, s.y - y));
    return d === Infinity ? 1 : clamp(1.15 - d / 900, 0.18, 1);
  }
  function voice(t, peak, a, dec, wet = 0) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
    g.connect(master);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(verb); }
    return g;
  }
  function tone(type, f0, f1, t, dur, dest) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    o.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, dest, type, f0, f1, q = 0.8) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    src.connect(f); f.connect(dest);
    src.start(t, Math.random() * 1.8); src.stop(t + dur + 0.05);
  }
  function filter(type, freq, q, dest) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; f.connect(dest); return f; }
  // Small bits of falling debris after an impact.
  function grit(t, v, n, spread) {
    for (let k = 0; k < n; k++) {
      const tk = t + 0.04 + Math.random() * spread;
      noise(tk, 0.04, voice(tk, 0.05 * v, 0.001, 0.04, 0.15), 'bandpass', 900 + Math.random() * 2600, 600, 2.5);
    }
  }
  function boom(x, y, big) {
    const t = now(), v = near(x, y);
    noise(t, 1.3 * big, voice(t, 0.75 * v * big, 0.004, 1.3 * big, 0.45), 'lowpass', 3200, 90, 0.6);
    tone('sine', 110, 28, t, 0.7 * big, voice(t, 0.7 * v * big, 0.003, 0.7 * big, 0.2));
    noise(t, 0.08, voice(t, 0.2 * v, 0.001, 0.08), 'highpass', 3000, 1500);
    grit(t + 0.1, v, 6, 0.6);
  }
  return {
    init,
    // Blaster: a quick downward zap. Player 2's is pitched a little higher, so you can tell them apart.
    shoot(s) {
      if (!ready('shoot' + s.id, 0.035)) return;
      const t = now(), v = near(s.x, s.y), p = (s.id ? 1.12 : 1) * (0.94 + Math.random() * 0.12);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.1);
      lp.connect(voice(t, 0.14 * v, 0.003, 0.11, 0.05));
      tone('square', 1500 * p, 220 * p, t, 0.1, lp);
      tone('sawtooth', 760 * p, 140 * p, t, 0.1, lp);
    },
    cannon(s) {
      if (!ready('cannon', 0.05)) return;
      const t = now(), v = near(s.x, s.y);
      tone('sine', 160, 38, t, 0.4, voice(t, 0.5 * v, 0.004, 0.45, 0.25));
      noise(t, 0.25, voice(t, 0.25 * v, 0.002, 0.25, 0.2), 'lowpass', 2400, 200);
    },
    freezer(s) {
      if (!ready('ice' + s.id, 0.05)) return;
      const t = now(), v = near(s.x, s.y), g = voice(t, 0.11 * v, 0.005, 0.22, 0.2);
      tone('triangle', 700, 2400, t, 0.2, g);
      tone('sine', 1400, 4200, t, 0.2, g);
      noise(t, 0.15, voice(t, 0.05 * v, 0.002, 0.15, 0.2), 'highpass', 5000, 8000);
    },
    // A round chipping the rock: a dull crack, a thud and a little falling grit.
    rock(x, y) {
      if (!ready('rock', 0.03)) return;
      const t = now(), v = near(x, y);
      noise(t, 0.16, voice(t, 0.22 * v, 0.002, 0.16, 0.12), 'lowpass', 2600 * (0.8 + Math.random() * 0.4), 260);
      tone('sine', 120, 50, t, 0.12, voice(t, 0.18 * v, 0.002, 0.12));
      grit(t, v, 3, 0.14);
    },
    tink(x, y) {
      if (!ready('tink', 0.04)) return;
      const t = now(), v = near(x, y);
      tone('sine', 3100 + Math.random() * 600, 2600, t, 0.12, voice(t, 0.06 * v, 0.001, 0.12, 0.25));
    },
    blast(x, y) { if (ready('blast', 0.06)) boom(x, y, 1); },
    // A round striking a ship: a short metallic clank.
    hit(x, y) {
      if (!ready('hit', 0.04)) return;
      const t = now(), v = near(x, y), g = voice(t, 0.26 * v, 0.001, 0.2, 0.15);
      const bp = filter('bandpass', 1800, 1.2, g);
      tone('square', 523, 470, t, 0.2, bp);
      tone('square', 787, 700, t, 0.2, bp);
      tone('triangle', 1330, 1200, t, 0.2, g);
      noise(t, 0.05, voice(t, 0.2 * v, 0.001, 0.05), 'highpass', 2500, 2000);
    },
    frost(s) {
      if (!ready('frost', 0.1)) return;
      const t = now(), v = near(s.x, s.y);
      [2093, 2637, 3136, 3951].forEach((f, k) => { const tk = t + k * 0.03; tone('sine', f, f * 0.98, tk, 0.6, voice(tk, 0.07 * v, 0.002, 0.6, 0.35)); });
      noise(t, 0.4, voice(t, 0.12 * v, 0.003, 0.4, 0.3), 'highpass', 6000, 3000);
    },
    death(s) {
      if (!ready('death', 0.1)) return;
      boom(s.x, s.y, 1.25);
      const t = now(), v = near(s.x, s.y);
      tone('sawtooth', 620, 45, t, 0.9, filter('lowpass', 1800, 0.7, voice(t, 0.13 * v, 0.01, 0.9, 0.3)));
    },
    // Hitting a wall or landing: a thud that grows with the impact speed.
    boing(s, impact) {
      if (!ready('boing' + s.id, 0.06)) return;
      const t = now(), v = near(s.x, s.y), k = clamp(impact / 400, 0.2, 1);
      tone('sine', 160 + 100 * k, 480 + 260 * k, t, 0.22, voice(t, 0.22 * v * k, 0.002, 0.22, 0.2));
      tone('triangle', 90, 60, t, 0.12, voice(t, 0.14 * v * k, 0.002, 0.12));
    },
    bump(s, impact) {
      if (!ready('bump' + s.id, 0.08)) return;
      const t = now(), v = near(s.x, s.y), k = clamp(impact / 300, 0.15, 1);
      tone('sine', 90 + 60 * k, 40, t, 0.3, voice(t, 0.35 * v * k, 0.002, 0.18 + 0.2 * k, 0.15));
      noise(t, 0.1, voice(t, 0.15 * v * k, 0.001, 0.1, 0.1), 'lowpass', 1400, 200);
    },
    swap() {
      if (!ready('swap', 0.05)) return;
      const t = now();
      tone('square', 660, 660, t, 0.05, filter('lowpass', 2500, 0.7, voice(t, 0.06, 0.002, 0.05)));
      tone('square', 990, 990, t + 0.06, 0.06, filter('lowpass', 2500, 0.7, voice(t + 0.06, 0.06, 0.002, 0.06)));
    },
    respawn(s) {
      if (!ready('respawn' + s.id, 0.2)) return;
      const t = now();
      [392, 523, 784].forEach((f, k) => { const tk = t + k * 0.07; tone('triangle', f, f, tk, 0.25, voice(tk, 0.06, 0.005, 0.25, 0.3)); });
    },
    laserCharge(s) {
      if (!ready('laserC', 0.2)) return;
      const t = now(), v = near(s.x, s.y), d = BIG.charge;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(4000, t + d);
      lp.connect(voice(t, 0.16 * v, d * 0.9, 0.08, 0.2));
      tone('sawtooth', 110, 880, t, d, lp);
      tone('sawtooth', 112, 900, t, d, lp);
    },
    laserFire(s) {
      if (!ready('laserF', 0.2)) return;
      const t = now(), v = near(s.x, s.y), d = BIG.fire;
      const g = voice(t, 0.38 * v, 0.01, d + 0.2, 0.4), lp = filter('lowpass', 2600, 2, g);
      tone('sawtooth', 72, 60, t, d, lp);
      tone('square', 145, 120, t, d, lp);
      tone('sawtooth', 220, 180, t, d, lp);
      noise(t, d, voice(t, 0.2 * v, 0.01, d, 0.3), 'bandpass', 1800, 700, 1.5);
      tone('sine', 90, 30, t, 0.5, voice(t, 0.5 * v, 0.003, 0.5, 0.2));
    },
    // Called every frame: engine volume and tone follow each ship's thrust; mutes while paused or in menus.
    frame() {
      if (!ctx) return;
      const t = now();
      master.gain.setTargetAtTime(P.sound ? P.volume : 0, t, 0.05);
      const quiet = game.paused || !startEl.hidden;
      ships.forEach((s, i) => {
        const e = engines[i];
        if (!e) return;
        const th = quiet || !s.active || !s.alive || s.frozenT > 0 ? 0 : s.thrust;
        e.g.gain.setTargetAtTime(th * 0.2, t, 0.04);
        e.lp.frequency.setTargetAtTime(220 + th * 900, t, 0.05);
        e.osc.frequency.setTargetAtTime(44 + i * 4 + th * 30, t, 0.08);
      });
    },
  };
})();
window.addEventListener('pointerdown', () => sfx.init(), { capture: true });
window.addEventListener('keydown', () => sfx.init(), { capture: true });

/* Game state and loop */
const game = { time: 0, paused: false, mode: 'duel' };
let matchClock = 0;   // time since the map or match started (Starship keeps its own run timer)
const mon = { p1Speed: 0, p1Mass: 1, keys: '', pads: '', fps: 0, presetStatus: 'Nothing saved yet.' };
let last = performance.now(), acc = 0, fpsAcc = 0, fpsFrames = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  fpsAcc += dt; fpsFrames++;
  sfx.frame();
  if (fpsAcc > 0.5) { mon.fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }

  readInputs();
  const h = 1 / P.physicsHz;
  if (!game.paused && !game.picking) {
    acc += dt * P.timeScale;
    let n = 0;
    while (acc >= h && n < 40) { step(h); acc -= h; n++; }
    if (n >= 40) acc = 0;
  }
  const alpha = clamp(acc / h, 0, 1);

  if (level.dirty) { level.tex.needsUpdate = true; level.dirty = false; }
  for (const s of ships) {
    if (!s.alive) { s.group.visible = false; s.flame.visible = false; drawDebug(s, alpha); continue; }
    s.group.visible = true;
    s.group.position.set(s.px + (s.x - s.px) * alpha, s.py + (s.y - s.py) * alpha, 1);
    s.group.rotation.z = s.pa + (s.a - s.pa) * alpha;
    s.group.scale.setScalar(P.shipSize);
    s.shield.visible = s.invulnT > 0;
    if (s.shield.visible) s.shield.material.opacity = (0.45 + 0.25 * Math.sin(game.time * 9)) * Math.min(1, s.invulnT / 0.4);
    s.aura.material.opacity = 0.16 + 0.18 * s.thrust + (s.minigunT > 0 ? 0.15 + 0.1 * Math.sin(game.time * 12) : 0);
    s.flame.visible = s.thrust > 0.02;
    s.flame.scale.set(0.85 + 0.15 * s.thrust, s.thrust * (0.8 + Math.random() * 0.4), 1);
    // No crosshair by default: only while a crosshair box is running (it blinks in the last 3 s).
    s.aim.visible = s.active && s.crossT > 0 && (s.crossT > 3 || Math.sin(game.time * 16) > -0.3);
    s.ice.visible = s.frozenT > 0;
    if (s.ice.visible) {
      const fade = Math.min(1, s.frozenT / 0.6);   // thaws over the last moment
      const blink = s.frozenT < 1.2 ? 0.75 + 0.25 * Math.sin(game.time * 22) : 1;
      s.ice.userData.shell.material.opacity = 0.55 * fade * blink;
      s.ice.userData.ring.material.opacity = 0.6 * fade;
      s.ice.userData.ring.rotation.z = game.time * 0.6 - s.group.rotation.z;
    }
    s.ball.visible = s.ballT > 0;
    if (s.ball.visible) {
      const u = s.ball.userData, age = WEAPONS[BALL_IDX].ball - s.ballT;
      const fade = Math.min(1, s.ballT / 0.4);   // pops at the end
      const blink = s.ballT < 1.2 ? 0.7 + 0.3 * Math.sin(game.time * 22) : 1;
      u.mats.forEach((m, k) => { m.opacity = u.base[k] * fade * blink; });
      s.ball.scale.setScalar(Math.min(1, 0.4 + age * 5) * (1 + 0.04 * Math.sin(game.time * 9)));
      u.shine.rotation.z = -s.group.rotation.z;   // the highlight stays put while the ball spins
    }
    drawDebug(s, alpha);
  }
  drawDino(alpha);
  drawWorm(alpha);
  drawPickup(now);
  drawBoxes(now);
  drawFloors(now);
  drawStarship(now);
  drawBigLasers(now);
  gridMesh.visible = isPractice() && PR.grid;
  pointScale.value = P.zoom * renderer.getPixelRatio();
  skyMat.uniforms.uTime.value = reducedMotion ? 0 : now / 1000;
  drawPools();

  const rects = viewRects();
  renderer.setScissorTest(true);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    renderer.setViewport(r.x, r.y, r.w, r.h);
    renderer.setScissor(r.x, r.y, r.w, r.h);
    updateCamera(i, r, dt, alpha);
    renderer.render(scene, cams[i]);
  }

  updateWeaponBoxes(rects);
  updateHud();
  const s0 = ships[0];
  mon.p1Speed = Math.hypot(s0.vx, s0.vy);
  mon.p1Mass = shipMass(s0);
  mon.keys = keysDown.size ? `${keysDown.size} held: ${[...keysDown].map(prettyKey).join('  ')}` : 'None';
  mon.pads = padsSeen.length ? padsSeen.join('\n') : 'None connected. Press a button on the pad.';
}

/* ------------------------------------------------------------------ *
 * Weapon box: rounded square next to the ship; old icon slides out left, new one slides in from the right
 * ------------------------------------------------------------------ */
const WICON = {
  basic: (c) => `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 16 H18" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity="0.45"/><circle cx="22" cy="16" r="5" fill="${c}"/><circle cx="23.5" cy="14.5" r="1.8" fill="#fff" opacity="0.8"/></svg>`,
  heavy: () => `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 9 L9 12 M3 16 H8 M5 23 L9 20" stroke="#ffd166" stroke-width="2.2" stroke-linecap="round"/><path d="M11 10.5 H21 C26 10.5 29 13 29 16 C29 19 26 21.5 21 21.5 H11 Z" fill="#ff9a3c"/><rect x="10" y="10" width="3.5" height="12" rx="1" fill="#c45a1e"/><path d="M17 13 H23" stroke="#ffe2b8" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/></svg>`,
  ice: () => `<svg viewBox="0 0 32 32" aria-hidden="true"><g stroke="#9fe7ff" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M16 4 V28 M5.6 10 L26.4 22 M5.6 22 L26.4 10"/><path d="M12.5 6 L16 9 L19.5 6 M12.5 26 L16 23 L19.5 26 M4.5 14 L8.6 12.3 L7.6 8 M27.5 18 L23.4 19.7 L24.4 24 M4.5 18 L8.6 19.7 L7.6 24 M27.5 14 L23.4 12.3 L24.4 8"/></g><circle cx="16" cy="16" r="2.4" fill="#e8fbff"/></svg>`,
  ball: () => `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="#ff5fd2" opacity="0.3"/><g stroke="#ff5fd2" stroke-width="1.8" opacity="0.75"><path d="M5 16 H27 M10.5 6.5 L21.5 25.5 M21.5 6.5 L10.5 25.5"/></g><circle cx="16" cy="16" r="12" fill="none" stroke="#ff5fd2" stroke-width="2.4"/><circle cx="11.5" cy="10.5" r="2.4" fill="#fff" opacity="0.8"/></svg>`,
  laser: (c) => `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="10.5" width="8" height="11" rx="2" fill="#6b7290"/><rect x="9" y="11.5" width="21" height="9" rx="4.5" fill="${c}" opacity="0.55"/><rect x="9" y="14.4" width="21" height="3.2" rx="1.6" fill="#ffffff"/><circle cx="10" cy="16" r="3.4" fill="#ffffff"/></svg>`,
};
const weaponIcon = (s, k) => WICON[WEAPONS[k].id](s.hex);
const weaponColor = (s, k) => WEAPONS[k].color || s.hex;
const wbox = [0, 1].map((i) => ({ el: document.getElementById('wsel' + i), until: 0, cur: null }));
const wbtns = [...document.querySelectorAll('.hud-wbtn')];
wbtns.forEach((b) => b.addEventListener('click', () => {
  const i = Number(b.dataset.p);
  cycleWeapon(ships[isSolo() ? 0 : i]);
}));
function updateWeaponButtons() {
  for (const b of wbtns) {
    const s = ships[Number(b.dataset.p)];
    const w = WEAPONS[s.weapon];
    b.querySelector('.wname').textContent = w.id === 'laser' ? (s.bigLaser > 0 || bigFree() ? 'Big laser ×1' : 'Big laser (used)') : w.name;
    b.querySelector('.wico').innerHTML = weaponIcon(s, s.weapon);
    b.setAttribute('aria-label', `Change weapon. Current: ${w.name}`);
  }
}
function animateWeaponBox(i, from, to) {
  const s = ships[i], box = wbox[i];
  box.el.style.setProperty('--wc', weaponColor(s, to));
  box.el.classList.add('on');
  box.until = performance.now() + 1500;
  // Drop any icons still sliding from a quick earlier press, keep only the one showing
  for (const c of [...box.el.children]) if (c !== box.cur) c.remove();
  const old = box.cur || Object.assign(document.createElement('div'), { className: 'wsel-icon', innerHTML: weaponIcon(s, from) });
  if (!old.parentNode) box.el.appendChild(old);
  const nu = Object.assign(document.createElement('div'), { className: 'wsel-icon', innerHTML: weaponIcon(s, to) });
  box.el.appendChild(nu);
  box.cur = nu;
  const opts = { duration: reducedMotion ? 1 : 260, easing: 'cubic-bezier(.25, .8, .3, 1)', fill: 'forwards' };
  old.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-110%)', opacity: 0.2 }], opts).onfinish = () => old.remove();
  nu.animate([{ transform: 'translateX(110%)', opacity: 0.2 }, { transform: 'translateX(0)', opacity: 1 }], opts);
}
// Keep each box beside its ship in that player's view, and hide it a moment after the last switch.
function updateWeaponBoxes(rects) {
  const now = performance.now();
  for (let i = 0; i < 2; i++) {
    const s = ships[i], box = wbox[i], r = rects[i];
    const show = box.until > now && s.alive && s.active && r;
    if (!show) { if (box.el.classList.contains('on')) box.el.classList.remove('on'); continue; }
    const cam = cams[i];
    const sx = r.x + (s.group.position.x - (cam.position.x + cam.left)) / (cam.right - cam.left) * r.w;
    const sy = r.y + (s.group.position.y - (cam.position.y + cam.bottom)) / (cam.top - cam.bottom) * r.h;
    const off = 18 * P.shipSize * P.zoom + 10;
    let left = sx + off, top = viewH - sy - 20;
    if (left + 40 > r.x + r.w - 4) left = sx - off - 40;   // flip to the left side near the view edge
    const cssTop = viewH - (r.y + r.h);
    top = clamp(top, cssTop + 4, cssTop + r.h - 44);
    box.el.style.left = `${Math.round(left)}px`;
    box.el.style.top = `${Math.round(top)}px`;
  }
}
updateWeaponButtons();

function restartMatch() {
  matchClock = 0;
  for (const s of ships) { s.bigLaser = 1; s.beam = null; }   // a new match: one Big laser shot each
  for (const s of ships) { s.score = 0; respawn(s); }
  resetDino(); resetWorm();
  resetPickup();
  resetBoxes();
  if (level.theme === 'ship') resetStarship();
  if (isSolo()) deactivate(ships[1]);
  clearBullets();
  PT.on.fill(0); DB.on.fill(0);
}
function deactivate(s) {
  s.active = false; s.alive = false; s.thrust = 0;
  s.group.visible = false; s.traj.visible = false; s.hullPts.visible = false; s.arrow.visible = false;
}
function rebuildCave() {
  matchClock = 0;
  for (const s of ships) { s.bigLaser = 1; s.beam = null; }
  buildLevel();
  for (const s of ships) respawn(s);
  if (isSolo()) deactivate(ships[1]);
  clearBullets();
  PT.on.fill(0); DB.on.fill(0);
}

/* ------------------------------------------------------------------ *
 * Header buttons
 * ------------------------------------------------------------------ */
const mainEl = document.getElementById('main');
const btnPause = document.getElementById('btnPause');
const btnPanel = document.getElementById('btnPanel');
function togglePause() {
  game.paused = !game.paused;
  btnPause.setAttribute('aria-pressed', String(game.paused));
  document.getElementById('pauseOverlay').hidden = !game.paused;
}
function togglePanel() {
  const hidden = mainEl.classList.toggle('panel-hidden');
  btnPanel.setAttribute('aria-pressed', String(!hidden));
}
document.getElementById('btnRestart').addEventListener('click', restartMatch);
document.getElementById('finishRestart').addEventListener('click', restartStarship);
// The five level buttons on the Starship's level chooser.
WAVES.slice(0, 5).forEach((w, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lvl-btn';
  b.innerHTML = `<b>${i + 1}</b><span>${w.bots} robot${w.bots > 1 ? 's' : ''}</span>`;
  b.setAttribute('aria-label', `Level ${i + 1}: ${w.bots} robot${w.bots > 1 ? 's' : ''}`);
  b.addEventListener('click', () => chooseLevel(i + 1));
  document.getElementById('levelRow').append(b);
});

/* Modes: the duel, or practice with one ship in an empty arena. #practice links straight to it. */
const MODE_TEXT = {
  duel: {
    sub: 'Two ships, one cave, every constant on a slider.', restart: 'Restart match', name: 'Player 1',
    keys: '<kbd>W</kbd>thrust <kbd>A</kbd><kbd>D</kbd>turn <kbd>L Shift</kbd>fire <kbd>S</kbd>weapon <kbd>Q</kbd>all maps <kbd>M</kbd>sound',
    aria: 'Game view. Player 1 uses W, A, D and left Shift. Player 2 uses the arrow keys and the minus key.',
  },
  solo: {
    sub: 'One ship, your pick of map.', restart: 'Restart match', name: 'Player 1',
    keys: '<kbd>W</kbd><kbd>↑</kbd>thrust <kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd>turn <kbd>L Shift</kbd><kbd>-</kbd>fire <kbd>S</kbd><kbd>↓</kbd>weapon <kbd>Q</kbd>next map <kbd>M</kbd>sound',
    aria: 'Game view, one player. W or Up thrusts, A and D or Left and Right turn, left Shift or minus fires.',
  },
  practice: {
    sub: 'One ship, empty space, just the walls. Try the physics.', restart: 'Reset ship <kbd>R</kbd>', name: 'Practice',
    keys: '<kbd>W</kbd><kbd>↑</kbd>thrust <kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd>turn <kbd>L Shift</kbd><kbd>-</kbd>fire <kbd>S</kbd><kbd>↓</kbd>weapon <kbd>R</kbd>reset <kbd>M</kbd>sound',
    aria: 'Practice view. One ship in an empty arena. W or Up thrusts, A and D or Left and Right turn, left Shift or minus fires, R resets the ship.',
  },
};
function applyLayout() { stage.dataset.split = isSolo() ? 'single' : P.split; }
function setMode(mode, force = false) {
  closePicker();
  if (mode !== 'practice' && mode !== 'solo') mode = 'duel';
  const changed = mode !== game.mode;
  game.mode = mode;
  const t = MODE_TEXT[mode];
  document.querySelector('.sub').textContent = t.sub;
  document.getElementById('btnRestart').innerHTML = t.restart;
  document.querySelector('.hud[data-p="0"] .hud-name').textContent = t.name;
  document.querySelector('.hud[data-p="0"] .hud-keys').innerHTML = t.keys;
  stage.setAttribute('aria-label', t.aria);
  applyLayout();
  fLevel.hidden = isPractice();
  fPractice.hidden = !isPractice();
  if ((location.hash || '#duel').slice(1) !== mode) location.hash = mode;
  if (changed || force) { buildLevel(); restartMatch(); }
}
window.addEventListener('hashchange', () => setMode(location.hash.slice(1)));

/* Player 1's map picker: the Map button or Q opens it over Player 1's view and pauses the game. */
const picker = { el: document.getElementById('picker'), grid: document.getElementById('mapGrid'), open: false, sel: 0, cards: [], thumbs: new Map(), job: 0 };
function updateMapButton() {
  const keys = Object.keys(MAPS), cur = MAPS[level.builtMap] ? level.builtMap : 'cave';
  const next = MAPS[keys[(keys.indexOf(cur) + 1) % keys.length]].name;
  const btn = document.getElementById('btnMaps');
  btn.innerHTML = `Map: ${MAPS[cur].name} <kbd>Q</kbd>`;
  btn.title = `Next: ${next}`;
  btn.setAttribute('aria-label', `Map: ${MAPS[cur].name}. Press to switch to ${next}.`);
}
// Each press of the Map button (or Q) goes to the next map in the list.
let toastTimer = 0;
function nextMap() {
  if (isPractice()) return;
  const keys = Object.keys(MAPS);
  P.map = keys[(keys.indexOf(level.builtMap) + 1) % keys.length];
  rebuildCave();
  pane.refresh();
  const el = document.getElementById('mapToast');
  el.querySelector('.toast-name').textContent = MAPS[P.map].name;
  el.querySelector('.toast-desc').textContent = MAPS[P.map].desc;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
}
const thumbKey = (k) => [k, SKIN[0], SKIN[1], P.seed, P.rockAmount, P.noiseScale, P.tunnelRadius].join('|');
// Build a map into the mask, copy a small picture of it, then put the real level back untouched.
function drawThumb(canvas, k) {
  const key = thumbKey(k);
  let img = picker.thumbs.get(key);
  if (!img) {
    const keepMask = level.mask.slice(), keepSpawns = level.spawns, keepMap = P.map, keepBuilt = level.builtMap;
    P.map = k;
    generateLevel(false);
    const tw = canvas.width, th = canvas.height, sx = W / tw, sy = H / th;
    const p1 = hexRGB(SKIN[0]), p2 = hexRGB(SKIN[1]);
    img = new ImageData(tw, th);
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        const r = Math.floor((j + 0.5) * sy), c = Math.floor((i + 0.5) * sx);
        const v = level.mask[r * W + c];
        const col = v === 0 ? (MAPS[k].thumbSky || [14, 10, 34]) : v === 2 ? [30, 24, 54] : v === 3 ? (c < W / 2 ? p1 : p2) : (MAPS[k].thumbRock || rowColor[r]);
        const o = (j * tw + i) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    level.mask.set(keepMask); level.spawns = keepSpawns; P.map = keepMap; level.builtMap = keepBuilt;
    picker.thumbs.set(key, img);
  }
  canvas.getContext('2d').putImageData(img, 0, 0);
}
/* Map pictures for the All maps picker: one small SVG drawing per map, in a 180 × 110 box. */
const svgPts = (pts, dx = 0, dy = 0, ang = 0) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map(([x, y]) => `${(x * c - y * s + dx).toFixed(1)},${(x * s + y * c + dy).toFixed(1)}`).join(' ');
};
const artPoly = (pts, fill, dx = 0, dy = 0, ang = 0) => `<polygon points="${svgPts(pts, dx, dy, ang)}" fill="${fill}"/>`;
function artStarPath(cx, cy, R, r) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R;
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(1) + ' ' + (cy + Math.sin(a) * rr).toFixed(1);
  }
  return d + 'Z';
}
function artStars(n, seed, maxY = 110) {
  const rng = mulberry32(seed);
  let s = '';
  for (let i = 0; i < n; i++) s += `<circle cx="${(rng() * 180).toFixed(1)}" cy="${(rng() * maxY).toFixed(1)}" r="${(0.5 + rng() * 0.9).toFixed(2)}" fill="#e8e6ff" opacity="${(0.35 + rng() * 0.6).toFixed(2)}"/>`;
  return s;
}
const artRocket = (x, y, a, c, s = 0.75) => `<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})"><path d="M-3.5 7 L0 19 L3.5 7Z" fill="#ff8f3d"/><path d="M-1.6 7 L0 13 L1.6 7Z" fill="#fff1c2"/><path d="M0 -12 L8 8 L0 4.5 L-8 8Z" fill="${c}"/><path d="M0 -6 L2.6 1 L-2.6 1Z" fill="#1b1640"/></g>`;
const svgWrap = (id, body) => `<svg viewBox="0 0 180 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid slice">${body}</svg>`;

// The cyan T-rex, in the same proportions as the one in the game (y up, feet at 0).
function artDino(x, y, s) {
  const B = '#2fe6f0', F = '#1aa3b4';
  let g = `<g transform="translate(${x} ${y}) scale(${s} ${-s})">`;
  g += artPoly([[-12, 33], [-5, 38], [1, 33], [0, 23], [-6, 15], [-10, 16], [-12, 24]], F);
  g += artPoly([[-8, 17], [-4, 15], [-12, 5], [-15, 6]], F) + artPoly([[-16, 4], [-12, 4], [-6, 0], [-17, 0]], F);
  g += artPoly([[0, 0], [5, -3], [7, -6], [5, -7], [3, -4], [-1, -2]], F, 21, 38);
  g += artPoly([[-50, 31], [-34, 36], [-16, 41], [0, 45], [12, 48], [20, 54], [27, 52], [24, 42], [16, 32], [6, 26], [-6, 25], [-20, 28], [-36, 30]], B);
  for (const [cx, cy, r] of [[-34, 33.5, 3.2], [-22, 37, 3.6], [-10, 40.5, 3.8], [2, 43, 3.4]]) g += `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${(r * 0.55).toFixed(2)}" fill="#1cb8c8"/>`;
  g += artPoly([[3, 1.5], [22, 2], [20, -6], [6, -5]], '#0b3640', 22, 50);
  g += artPoly([[-6, 4], [0, 11], [10, 13], [19, 10], [23, 6], [22, 2], [12, 1], [2, 0], [-5, -2]], B, 22, 50);
  for (let tx = 8; tx <= 20; tx += 3) g += artPoly([[tx, 1.4], [tx + 1.6, 1.4], [tx + 0.8, -1.8]], '#f4fbff', 22, 50);
  const jawAng = -0.5;
  g += artPoly([[-1, 0.8], [8, 0.9], [17, 0.8], [16, -2], [8, -5], [0, -4], [-2, -1]], B, 26, 50.5, jawAng);
  for (let tx = 5; tx <= 15; tx += 3) g += artPoly([[tx, 0.6], [tx + 1.4, 0.6], [tx + 0.7, 3]], '#f4fbff', 26, 50.5, jawAng);
  g += `<circle cx="31" cy="58" r="2.6" fill="#000000"/>`;
  g += artPoly([[-9, 33], [-2, 38], [5, 33], [4, 23], [1, 15], [-3, 14], [-7, 21]], B);
  g += artPoly([[-2, 16], [3, 16], [6, 4], [2, 3]], B) + artPoly([[1, 4.5], [6, 4.5], [13, 0], [0, 0]], B);
  g += artPoly([[0, 0], [5, -3], [7, -6], [5, -7], [3, -4], [-1, -2]], B, 18, 37);
  return g + '</g>';
}
function artAraucaria(x, base, h, trunk, green) {
  let g = `<rect x="${x - 2}" y="${base - h}" width="4" height="${h}" fill="${trunk}"/>`;
  for (let i = 0; i < 5; i++) {
    const yy = base - h * 0.45 - i * h * 0.12, len = 22 - i * 3.5;
    for (const sd of [-1, 1]) {
      g += `<path d="M${x} ${yy} Q ${x + sd * len * 0.6} ${yy + 3} ${x + sd * len} ${yy - 4}" stroke="${green}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      g += `<ellipse cx="${x + sd * len}" cy="${yy - 5}" rx="4" ry="3" fill="${green}"/>`;
    }
  }
  return g + `<ellipse cx="${x}" cy="${base - h - 2}" rx="5" ry="4" fill="${green}"/>`;
}
function artFern(x, base, h) {
  let g = `<path d="M${x} ${base} Q ${x + 2} ${base - h / 2} ${x - 1} ${base - h}" stroke="#5a4128" stroke-width="4" fill="none"/>`;
  for (let j = 0; j < 7; j++) {
    const a = Math.PI * (0.08 + 0.84 * j / 6), len = 20;
    const ex = x - 1 + Math.cos(a) * len, ey = base - h - Math.sin(a) * len * 0.7 + 9 * (1 - Math.sin(a) * 0.6);
    g += `<path d="M${x - 1} ${base - h} Q ${(x - 1 + Math.cos(a) * len * 0.5).toFixed(1)} ${(base - h - Math.sin(a) * len * 0.75).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" stroke="#3aa14c" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="3 1.2"/>`;
  }
  return g;
}

const MAP_ART = {
  cave: () => svgWrap('cave', `
    <defs><linearGradient id="artCaveRock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a1f4e"/><stop offset="1" stop-color="#b8633f"/></linearGradient></defs>
    <rect width="180" height="110" fill="url(#artCaveRock)"/>
    <path d="M18 102 C 18 44, 58 16, 90 16 C 122 16, 162 44, 162 102 Z" fill="#120f2e"/>
    <path d="M18 102 C 18 44, 58 16, 90 16 C 122 16, 162 44, 162 102" fill="none" stroke="#f0a35e" stroke-width="2" opacity="0.55"/>
    ${artStars(10, 5, 60).replace(/opacity="[^"]+"/g, 'opacity="0.25"')}
    <polygon points="44,36 54,30 50,56" fill="#6e3654"/><polygon points="70,22 82,19 77,48" fill="#6e3654"/>
    <polygon points="98,18 110,20 104,42" fill="#6e3654"/><polygon points="124,28 134,33 128,54" fill="#6e3654"/>
    <polygon points="36,102 50,102 43,78" fill="#9a4f45"/><polygon points="118,102 134,102 126,72" fill="#9a4f45"/>
    <polygon points="92,102 100,102 96,88" fill="#9a4f45"/>
    <rect y="100" width="180" height="10" fill="#b8633f"/>
    ${artRocket(78, 62, 35, '#ffe066')}`),
  clear: () => svgWrap('clear', `
    <defs><radialGradient id="artClearGlow"><stop offset="0" stop-color="#ffe066" stop-opacity="0.55"/><stop offset="1" stop-color="#ffe066" stop-opacity="0"/></radialGradient></defs>
    <rect width="180" height="110" fill="#0b0a24"/>
    ${artStars(34, 11)}
    <circle cx="90" cy="55" r="48" fill="url(#artClearGlow)"/>
    <path d="${artStarPath(90, 57, 32, 13)}" fill="#ffe066" stroke="#fff6c8" stroke-width="2" stroke-linejoin="round"/>
    <path d="${artStarPath(90, 57, 20, 8)}" fill="#fff1a8" opacity="0.6"/>
    <rect x="3" y="3" width="174" height="104" rx="4" fill="none" stroke="#2b2650" stroke-width="6"/>`),
  open: () => svgWrap('open', `
    <defs><linearGradient id="artOpenSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1b4a"/><stop offset="1" stop-color="#0b1230"/></linearGradient></defs>
    <rect width="180" height="110" fill="url(#artOpenSky)"/>
    ${artStars(18, 23, 70)}
    <circle cx="150" cy="22" r="10" fill="#f3e6c4"/><circle cx="154" cy="19" r="9" fill="#2a1b4a"/>
    <path d="M38 38 Q 58 26 78 38 Q 70 44 62 56 Q 56 46 38 38Z" fill="#8a4a4f"/><path d="M38 38 Q 58 26 78 38" stroke="#f0a35e" stroke-width="2" fill="none"/>
    <path d="M100 56 Q 116 47 132 56 Q 124 61 118 72 Q 112 62 100 56Z" fill="#8a4a4f"/><path d="M100 56 Q 116 47 132 56" stroke="#f0a35e" stroke-width="2" fill="none"/>
    <path d="M14 68 Q 24 62 34 68 Q 28 72 24 80 Q 20 72 14 68Z" fill="#7a3d55"/>
    <path d="M0 92 Q 30 82 60 90 T 120 88 T 180 90 V110 H0Z" fill="#9a4f45"/>
    ${artRocket(140, 40, -40, '#6ee7ff')}`),
  forest: () => svgWrap('forest', `
    <defs><linearGradient id="artForestSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#301c40"/><stop offset="1" stop-color="#0b2a28"/></linearGradient></defs>
    <rect width="180" height="110" fill="url(#artForestSky)"/>
    ${artStars(14, 41, 50)}
    <circle cx="36" cy="22" r="13" fill="#f2cf9c"/><circle cx="32" cy="19" r="3" fill="#d9b07c"/><circle cx="41" cy="27" r="2" fill="#d9b07c"/>
    <circle cx="96" cy="14" r="5" fill="#9fe0db"/>
    ${artAraucaria(18, 90, 52, '#143633', '#143633')}${artAraucaria(70, 90, 44, '#143633', '#143633')}${artAraucaria(118, 90, 56, '#143633', '#143633')}
    <path d="M0 88 Q 45 80 90 86 T 180 84 V110 H0Z" fill="#3f2f20"/>
    <path d="M0 88 Q 45 80 90 86 T 180 84" fill="none" stroke="#3c8c3a" stroke-width="3"/>
    ${artAraucaria(152, 86, 64, '#5a4128', '#1f6b3f')}
    ${artFern(22, 88, 24)}
    <path d="M118 88 l-3 -12 M121 88 l0 -15 M124 88 l3 -11" stroke="#7fae45" stroke-width="2"/>
    ${artDino(80, 88, 0.62)}`),
  desert: () => svgWrap('desert', `
    <defs><linearGradient id="artDesertSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#24133a"/><stop offset="0.55" stop-color="#8a3f55"/><stop offset="1" stop-color="#f28c4c"/></linearGradient></defs>
    <rect width="180" height="110" fill="url(#artDesertSky)"/>
    ${artStars(10, 97, 30)}
    <circle cx="150" cy="66" r="22" fill="#ffd08a" opacity="0.35"/><circle cx="150" cy="66" r="14" fill="#fff0c4"/>
    <ellipse cx="96" cy="18" rx="17" ry="4.5" fill="none" stroke="#efd3b0" stroke-width="2" transform="rotate(-18 96 18)"/>
    <circle cx="96" cy="18" r="7.5" fill="#9cc6d8"/>
    <path d="M89 22 A17 4.5 -18 0 0 113 13" fill="none" stroke="#efd3b0" stroke-width="2"/>
    <polygon points="14,110 22,44 46,44 54,110" fill="#9a5a44"/><rect x="22" y="44" width="24" height="4" fill="#c98a5e"/>
    <path d="M0 92 Q 30 80 60 89 T 120 87 T 180 89 V110 H0Z" fill="#d9a066"/>
    <path d="M0 92 Q 30 80 60 89 T 120 87 T 180 89" fill="none" stroke="#f5d29a" stroke-width="2"/>
    <path d="M80 92 Q 98 18 122 52" fill="none" stroke="#c98f6b" stroke-width="11" stroke-linecap="round"/>
    <path d="M80 92 Q 98 18 122 52" fill="none" stroke="#a5674c" stroke-width="11" stroke-dasharray="3 5"/>
    <circle cx="122" cy="52" r="8" fill="#b8735a"/>
    <ellipse cx="126" cy="57" rx="2.8" ry="6" fill="#a8384e" transform="rotate(-36 126 57)"/>
    <ellipse cx="126.4" cy="57.4" rx="1.8" ry="4.4" fill="#3a0f1c" transform="rotate(-36 126.4 57.4)"/>
    <circle cx="74" cy="88" r="2" fill="#f5d29a"/><circle cx="86" cy="84" r="1.6" fill="#f5d29a"/><circle cx="79" cy="80" r="1.3" fill="#f5d29a"/>
    <rect x="162" y="62" width="6" height="28" rx="3" fill="#3f8f52"/>
    <path d="M162 76 h-5 v-8" fill="none" stroke="#3f8f52" stroke-width="4" stroke-linecap="round"/><path d="M168 72 h5 v-7" fill="none" stroke="#3f8f52" stroke-width="4" stroke-linecap="round"/>
    ${artRocket(140, 30, -40, '#6ee7ff')}`),
  hangar: () => svgWrap('hangar', `
    <rect width="180" height="110" fill="#14152a"/>
    <path d="${Array.from({ length: 7 }, (_, i) => `M${i * 30} 8V102`).join('')}M0 40H180M0 72H180" stroke="#22243e" stroke-width="1.5"/>
    <rect y="0" width="180" height="8" fill="#3a3e52"/><rect y="102" width="180" height="8" fill="#3a3e52"/>
    <rect x="96" y="6" width="38" height="4" fill="#ffb020"/>
    <path d="M8 98 L60 98 L70 92 L62 84 L44 80 L14 80 Z" fill="#d8dbe6"/><rect x="18" y="88" width="34" height="2" fill="#3d7bff"/>
    <path d="M70 30 L104 30 L110 34 L104 38 L70 38 L66 34 Z" fill="#e8a23a"/><rect x="80" y="8" width="2" height="22" fill="#4a5068"/><rect x="94" y="8" width="2" height="22" fill="#4a5068"/>
    <g transform="translate(138 102)">
      <rect x="-14" y="-38" width="7" height="34" fill="#3f465e"/><rect x="7" y="-38" width="7" height="34" fill="#3f465e"/>
      <rect x="-17" y="-5" width="13" height="5" fill="#3f465e"/><rect x="5" y="-5" width="13" height="5" fill="#3f465e"/>
      <rect x="-14" y="-46" width="28" height="9" fill="#272c3e"/>
      <polygon points="-22,-46 22,-46 26,-80 -26,-80" fill="#7a83a0"/><polygon points="-18,-48 18,-48 21,-78 -21,-78" fill="#a3abc4"/>
      <rect x="-8" y="-66" width="16" height="12" fill="#121522"/><rect x="-8" y="-66" width="16" height="12" fill="#ff2b3d" opacity="0.35"/>
      <rect x="-12" y="-96" width="24" height="15" fill="#7a83a0"/><rect x="-10" y="-92" width="20" height="7" fill="#121522"/>
      <circle cx="-4" cy="-88.5" r="2.6" fill="#ff2b3d"/>
      <circle cx="-26" cy="-76" r="6" fill="#3f465e"/><circle cx="26" cy="-76" r="6" fill="#3f465e"/>
      <rect x="-60" y="-80" width="34" height="7" fill="#7a83a0" transform="rotate(-18 -26 -76)"/>
      <rect x="-70" y="-86" width="12" height="12" fill="#a3abc4" transform="rotate(-18 -26 -76)"/>
      <rect x="22" y="-72" width="6" height="30" fill="#7a83a0"/><rect x="19" y="-44" width="12" height="11" fill="#a3abc4"/>
    </g>
    <path d="M134 13.5 L60 50" stroke="#ff2b3d" stroke-width="3" opacity="0.85"/><path d="M134 13.5 L60 50" stroke="#fff1f1" stroke-width="1"/>
    <path d="${artStarPath(60, 50, 6, 2.5)}" fill="#ffb020"/>
    ${artRocket(48, 58, 60, '#ffe066', 0.7)}${artRocket(30, 40, 70, '#6ee7ff', 0.7)}
    <g transform="translate(150 52)">${'<path d="M0 -4 L4 3 L-4 3Z" fill="#ff4d5e"/>'}</g><g transform="translate(160 62)"><path d="M0 -4 L4 3 L-4 3Z" fill="#ff4d5e"/></g>`),
  pillars: () => svgWrap('pillars', `
    <defs><linearGradient id="artPillar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b8633f"/><stop offset="1" stop-color="#6e3654"/></linearGradient></defs>
    <rect width="180" height="110" fill="#120f2e"/>
    ${artStars(16, 57)}
    <rect x="30" y="-8" width="16" height="66" rx="8" fill="url(#artPillar)"/>
    <rect x="66" y="42" width="16" height="70" rx="8" fill="url(#artPillar)"/>
    <rect x="102" y="-8" width="16" height="74" rx="8" fill="url(#artPillar)"/>
    <rect x="138" y="38" width="16" height="74" rx="8" fill="url(#artPillar)"/>
    <rect y="102" width="180" height="8" fill="#9a4f45"/>
    <path d="M10 30 C 40 92, 58 92, 74 30 S 110 92, 128 86 S 150 20, 172 26" fill="none" stroke="#ffe066" stroke-width="1.6" stroke-dasharray="3 4" opacity="0.6"/>
    ${artRocket(92, 34, 40, '#ffe066')}`),
  maze: () => svgWrap('maze', `
    <rect width="180" height="110" fill="#7a3d55"/>
    <path d="M18 20 H70 V50 H36 V86 H96 V58 H134 V20 H104 M134 58 V90 H162 M70 20 H96 V40 M162 90 V40 H150" fill="none" stroke="#120f2e" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="3" y="3" width="174" height="104" rx="4" fill="none" stroke="#2b2650" stroke-width="6"/>
    ${artRocket(30, 20, 90, '#ffe066', 0.6)}${artRocket(150, 90, -90, '#6ee7ff', 0.6)}`),
  divide: () => svgWrap('divide', `
    <rect width="180" height="110" fill="#120f2e"/>
    ${artStars(16, 71)}
    <rect y="100" width="180" height="10" fill="#9a4f45"/>
    <rect x="84" y="0" width="12" height="20" fill="#8a4a4f"/><rect x="84" y="34" width="12" height="14" fill="#8a4a4f"/>
    <rect x="84" y="62" width="12" height="14" fill="#8a4a4f"/><rect x="84" y="90" width="12" height="20" fill="#8a4a4f"/>
    <ellipse cx="50" cy="30" rx="9" ry="6" fill="#7a3d55"/><ellipse cx="130" cy="30" rx="9" ry="6" fill="#7a3d55"/>
    <ellipse cx="58" cy="78" rx="7" ry="5" fill="#7a3d55"/><ellipse cx="122" cy="78" rx="7" ry="5" fill="#7a3d55"/>
    ${artRocket(40, 56, 90, '#ffe066')}${artRocket(140, 56, -90, '#6ee7ff')}`),
  floors: () => svgWrap('floors', `
    <defs>
      <linearGradient id="artFloorsGlow" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff6a1a" stop-opacity="0.8"/><stop offset="0.6" stop-color="#ff6a1a" stop-opacity="0"/></linearGradient>
      <linearGradient id="artFloorsLava" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd25a"/><stop offset="0.35" stop-color="#ff7a1a"/><stop offset="1" stop-color="#8a1206"/></linearGradient>
    </defs>
    <rect width="180" height="110" fill="#120f2e"/>
    ${artStars(10, 83, 70)}
    <rect x="0" y="0" width="34" height="110" fill="#3a3e52"/><rect x="146" y="0" width="34" height="110" fill="#3a3e52"/>
    <path d="M34 0 V110 M146 0 V110" stroke="#5a5f7a" stroke-width="2"/>
    <path d="M0 26 H34 M0 58 H34 M146 26 H180 M146 58 H180" stroke="#2a2d3d" stroke-width="2"/>
    <rect x="34" y="18" width="60" height="10" fill="#1d1a2c"/>
    ${[36, 46, 56, 66, 76, 86].map((x) => `<polygon points="${x},28 ${x + 4},28 ${x + 8},18 ${x + 4},18" fill="#ffcc33"/>`).join('')}
    <rect width="180" height="110" fill="url(#artFloorsGlow)"/>
    ${artRocket(112, 50, 0, '#ffe066', 1.1)}
    <path d="M0 110 V84 Q 12 70 22 82 Q 30 62 42 80 Q 52 66 60 82 Q 72 58 84 80 Q 94 68 104 82 Q 116 60 126 80 Q 136 70 146 82 Q 160 62 170 80 Q 176 74 180 78 V110Z" fill="url(#artFloorsLava)"/>
    <path d="M0 110 V94 Q 14 86 24 94 Q 36 80 48 92 Q 60 84 70 94 Q 84 78 96 92 Q 108 84 118 94 Q 132 80 144 92 Q 158 84 168 94 Q 174 90 180 92 V110Z" fill="#ffd25a" opacity="0.85"/>
    <circle cx="40" cy="64" r="1.6" fill="#ffb347"/><circle cx="78" cy="52" r="1.3" fill="#ffd25a"/><circle cx="132" cy="58" r="1.7" fill="#ff8a3d"/><circle cx="158" cy="48" r="1.2" fill="#ffd25a"/>`),
  starship: () => svgWrap('starship', `
    <rect width="180" height="110" fill="#15142a"/>
    <path d="M0 40 H180 M0 72 H180 M45 0 V110 M90 0 V110 M135 0 V110" stroke="#22213a" stroke-width="2"/>
    <rect y="56" width="180" height="2" fill="#5aa0ff" opacity="0.45"/>
    <rect y="0" width="180" height="12" fill="#3a3e52"/><rect y="98" width="180" height="12" fill="#3a3e52"/>
    <polygon points="72,12 108,12 100,22 80,22" fill="#4a4f66"/>
    <polygon points="88,24 92,24 70,92 62,92" fill="#ff2b3d" opacity="0.45"/><polygon points="89.2,24 90.8,24 67.5,92 64.5,92" fill="#fff1f1"/>
    <g transform="rotate(18 90 24)"><rect x="86" y="22" width="8" height="18" fill="#6b7290"/><rect x="86" y="36" width="8" height="4" fill="#ff4d5e"/></g>
    <circle cx="90" cy="23" r="5" fill="#2a2e40"/><circle cx="90" cy="23" r="2.2" fill="#ff2b3d"/>
    <rect x="10" y="72" width="28" height="26" fill="#7a8aa6" stroke="#3a404e" stroke-width="2"/><path d="M12 74 L36 96 M36 74 L12 96" stroke="#3a404e" stroke-width="1.5"/>
    <rect x="40" y="82" width="20" height="16" fill="#a07a52" stroke="#4e3a26" stroke-width="2"/>
    <rect x="138" y="70" width="30" height="28" fill="#6f8f6a" stroke="#33442f" stroke-width="2"/><rect x="144" y="58" width="18" height="12" fill="#9a5f5f" stroke="#4a2c2c" stroke-width="2"/>
    <circle cx="118" cy="46" r="1.6" fill="#ff4d5e"/><circle cx="108" cy="52" r="1.6" fill="#ff4d5e"/><circle cx="56" cy="48" r="1.6" fill="#ffe066"/><circle cx="64" cy="45" r="1.6" fill="#ffe066"/>
    ${artRocket(134, 38, -120, '#ff4d5e', 0.85)}${artRocket(152, 52, -100, '#ff4d5e', 0.6)}${artRocket(124, 60, -135, '#ff4d5e', 0.6)}
    ${artRocket(42, 54, 65, '#ffe066', 0.85)}`),
};

function renderPicker() {
  picker.grid.textContent = '';
  picker.cards = Object.keys(MAPS).map((k, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-card';
    if (k === level.builtMap) b.setAttribute('aria-current', 'true');
    // A drawn picture when the map has one, otherwise a small preview of its layout.
    let cv = null, pic;
    if (MAP_ART[k]) {
      pic = document.createElement('span');
      pic.className = 'map-art';
      pic.innerHTML = MAP_ART[k]();
    } else {
      pic = cv = document.createElement('canvas');
      cv.width = 180; cv.height = 110;
      cv.setAttribute('aria-hidden', 'true');
    }
    const name = document.createElement('span');
    name.className = 'name'; name.textContent = MAPS[k].name;
    const desc = document.createElement('span');
    desc.className = 'desc'; desc.textContent = MAPS[k].desc || '';
    b.append(pic, name, desc);
    b.addEventListener('click', () => chooseMap(k));
    b.addEventListener('mouseenter', () => selectCard(idx, false));
    picker.grid.append(b);
    return { b, cv, k };
  });
  document.getElementById('pickerSeed').textContent = `Seed ${P.seed}`;
  // Draw the previews one at a time so the picker opens at once.
  const job = ++picker.job;
  let i = 0;
  const next = () => {
    if (job !== picker.job || !picker.open || i >= picker.cards.length) return;
    if (picker.cards[i].cv) drawThumb(picker.cards[i].cv, picker.cards[i].k);
    i++;
    setTimeout(next, 0);
  };
  setTimeout(next, 30);
}
function selectCard(i, focus = true) {
  const n = picker.cards.length;
  if (!n) return;
  picker.sel = ((i % n) + n) % n;
  picker.cards.forEach((c, k) => c.b.classList.toggle('selected', k === picker.sel));
  if (focus) picker.cards[picker.sel].b.focus();
}
function openPicker() {
  if (picker.open || isPractice()) return;
  picker.open = true;
  game.picking = true;
  keysDown.clear();
  picker.el.hidden = false;
  renderPicker();
  selectCard(Math.max(0, Object.keys(MAPS).indexOf(level.builtMap)));
}
function closePicker() {
  if (!picker.open) return;
  picker.open = false;
  game.picking = false;
  picker.job++;
  picker.el.hidden = true;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
function chooseMap(k) {
  P.map = k;
  rebuildCave();
  pane.refresh();
  closePicker();
}
const pickerCols = () => Math.max(1, getComputedStyle(picker.grid).gridTemplateColumns.split(' ').length);
function pickerKey(e) {
  const c = e.code;
  if ((c === 'Space' || c === 'Enter') && e.target.closest && e.target.closest('.pbtn')) return;
  const cols = pickerCols();
  const moves = { KeyA: -1, ArrowLeft: -1, KeyD: 1, ArrowRight: 1, KeyW: -cols, ArrowUp: -cols, KeyS: cols, ArrowDown: cols };
  if (c in moves) { e.preventDefault(); selectCard(picker.sel + moves[c]); }
  else if (c === 'Space' || c === 'Enter' || c === 'NumpadEnter') { e.preventDefault(); if (!e.repeat) chooseMap(picker.cards[picker.sel].k); }
  else if (c === 'Escape' || c === 'KeyQ') { e.preventDefault(); closePicker(); }
}
// The Map button flips between Clear space and the first map, the Cave. Q still opens the full picker.
document.getElementById('btnMaps').addEventListener('click', nextMap);
document.getElementById('btnMapList').addEventListener('click', openPicker);
document.getElementById('pickerClose').addEventListener('click', closePicker);
document.getElementById('pickerShuffle').addEventListener('click', () => {
  P.seed = Math.floor(Math.random() * 99999);
  pane.refresh();
  renderPicker();
  selectCard(picker.sel);
});
btnPause.addEventListener('click', togglePause);
btnPanel.addEventListener('click', togglePanel);
// Hide UI works on every map: header, tuning panel, player panels and the wave bar all go away.
const appEl = document.querySelector('.app');
function toggleUI() {
  const hidden = appEl.classList.toggle('ui-hidden');
  document.getElementById('btnUI').setAttribute('aria-pressed', String(hidden));
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
document.getElementById('btnUI').addEventListener('click', toggleUI);
document.getElementById('btnShowUI').addEventListener('click', toggleUI);
// After a mouse click on any button, hand the keyboard back to the ships (Space would re-press it).
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && e.detail > 0) setTimeout(() => b.blur(), 0);
});
stage.addEventListener('pointerdown', () => {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
});
if (window.matchMedia('(max-width: 820px)').matches) togglePanel();

/* ------------------------------------------------------------------ *
 * Tuning panel
 * ------------------------------------------------------------------ */
const pane = new Pane({ container: document.getElementById('panel') });
const tabs = pane.addTab({ pages: [{ title: 'Movement' }, { title: 'Obstacles' }, { title: 'Shooting' }] });
const [tMove, tObst, tShoot] = tabs.pages;

const bind = (page, key, opts) => page.addBinding(P, key, opts);
bind(tMove, 'gravity', { label: 'Gravity', min: 0, max: 600, step: 1 });
bind(tMove, 'thrustForce', { label: 'Thrust force', min: 0, max: 2000, step: 5 });
bind(tMove, 'thrustRampUp', { label: 'Thrust ramp up', min: 1, max: 60, step: 0.5 });
bind(tMove, 'thrustRampDown', { label: 'Thrust ramp down', min: 1, max: 60, step: 0.5 });
bind(tMove, 'mass', { label: 'Mass', min: 0.2, max: 5, step: 0.05 });
bind(tMove, 'ammoWeight', { label: 'Weight per bullet', min: 0, max: 0.05, step: 0.001 });
bind(tMove, 'rotSpeed', { label: 'Turn speed', min: 0.5, max: 12, step: 0.1 });
bind(tMove, 'rotAccel', { label: 'Turn response', min: 1, max: 200, step: 1 });
bind(tMove, 'linearDrag', { label: 'Air drag', min: 0, max: 3, step: 0.01 });
bind(tMove, 'maxSpeed', { label: 'Max speed', min: 50, max: 1500, step: 5 });
bind(tMove, 'shipSize', { label: 'Ship size', min: 0.5, max: 2.5, step: 0.05 });
tMove.addBinding(mon, 'p1Speed', { label: 'P1 speed', readonly: true, view: 'graph', min: 0, max: 800, interval: 33 });
tMove.addBinding(mon, 'p1Mass', { label: 'P1 mass now', readonly: true, format: (v) => v.toFixed(2) });

bind(tObst, 'restitution', { label: 'Bounce', min: 0, max: 1.2, step: 0.01 });
bind(tObst, 'wallFriction', { label: 'Wall friction', min: 0, max: 1, step: 0.01 });
bind(tObst, 'safeImpact', { label: 'Safe impact speed', min: 0, max: 600, step: 5 });
bind(tObst, 'damagePerSpeed', { label: 'Damage per speed', min: 0, max: 2, step: 0.01 });
bind(tObst, 'lethalImpact', { label: 'Lethal impact speed', min: 50, max: 1500, step: 5 });
bind(tObst, 'landMaxSpeed', { label: 'Landing max speed', min: 0, max: 400, step: 5 });
bind(tObst, 'landMaxAngle', { label: 'Landing max tilt °', min: 0, max: 90, step: 1 });
bind(tObst, 'shipBounce', { label: 'Ship vs ship bounce', min: 0, max: 1.5, step: 0.05 });
bind(tObst, 'invulnTime', { label: 'Spawn shield, s', min: 0, max: 5, step: 0.1 });
bind(tObst, 'respawnTime', { label: 'Respawn delay, s', min: 0.2, max: 6, step: 0.1 });
bind(tObst, 'repairRate', { label: 'Pad repair per s', min: 0, max: 60, step: 1 });
bind(tObst, 'shake', { label: 'Screen shake', min: 0, max: 20, step: 0.5 });

bind(tShoot, 'bulletSpeed', { label: 'Bullet speed', min: 50, max: 2000, step: 10 });
bind(tShoot, 'inheritVelocity', { label: 'Inherit ship speed', min: 0, max: 1.5, step: 0.05 });
bind(tShoot, 'fireRate', { label: 'Shots per s', min: 0.5, max: 40, step: 0.5 });
bind(tShoot, 'spread', { label: 'Spread °', min: 0, max: 30, step: 0.5 });
bind(tShoot, 'bulletLife', { label: 'Bullet lifetime, s', min: 0.1, max: 5, step: 0.1 });
bind(tShoot, 'bulletGravity', { label: 'Bullet gravity', min: 0, max: 2, step: 0.05 });
bind(tShoot, 'recoil', { label: 'Recoil', min: 0, max: 200, step: 1 });
bind(tShoot, 'knockback', { label: 'Knockback on hit', min: 0, max: 400, step: 5 });
bind(tShoot, 'bulletDamage', { label: 'Damage per hit', min: 0, max: 100, step: 1 });
bind(tShoot, 'ammoMax', { label: 'Ammo capacity', min: 1, max: 300, step: 1 });
bind(tShoot, 'rearmRate', { label: 'Pad rearm per s', min: 0, max: 200, step: 1 });
bind(tShoot, 'destructible', { label: 'Shots dig the cave' });
bind(tShoot, 'holeRadius', { label: 'Crater radius', min: 1, max: 40, step: 1 });

const fPractice = pane.addFolder({ title: 'Practice', expanded: true });
fPractice.addBinding(PR, 'infiniteAmmo', { label: 'Infinite ammo' }).on('change', () => { if (PR.infiniteAmmo) ships[0].ammo = P.ammoMax; });
fPractice.addBinding(PR, 'noDamage', { label: 'No damage' });
fPractice.addBinding(PR, 'grid', { label: 'Grid, 50 units' });
fPractice.addBinding(PR, 'spawn', { label: 'Start', options: { 'On the floor': 'floor', 'Mid-air': 'air' } });
fPractice.addButton({ title: 'Reset ship (R)' }).on('click', restartMatch);

const fLevel = pane.addFolder({ title: 'Map', expanded: true });
fLevel.addBinding(P, 'map', { label: 'Map', options: Object.fromEntries(Object.entries(MAPS).map(([k, v]) => [v.name, k])) })
  .on('change', () => { if (P.map !== level.builtMap) rebuildCave(); });
fLevel.addBinding(P, 'lavaSpeed', { label: 'Floors: lava speed', min: 0, max: 300, step: 5 });
fLevel.addBinding(P, 'lavaAccel', { label: 'Floors: lava speed-up', min: 0, max: 20, step: 0.5 });
fLevel.addBinding(P, 'lavaDelay', { label: 'Floors: lava wait, s', min: 0, max: 10, step: 0.5 });
fLevel.addBinding(P, 'seed', { label: 'Seed', min: 0, max: 99999, step: 1 });
fLevel.addBinding(P, 'rockAmount', { label: 'Rock amount', min: 0.3, max: 0.7, step: 0.01 });
fLevel.addBinding(P, 'noiseScale', { label: 'Cave scale', min: 40, max: 400, step: 5 });
fLevel.addBinding(P, 'tunnelRadius', { label: 'Tunnel width', min: 20, max: 120, step: 1 });
fLevel.addButton({ title: 'Rebuild map' }).on('click', rebuildCave);
fLevel.addButton({ title: 'Surprise me' }).on('click', () => {
  const keys = Object.keys(MAPS).filter((k) => k !== P.map);
  P.map = keys[Math.floor(Math.random() * keys.length)];
  P.seed = Math.floor(Math.random() * 99999);
  rebuildCave();
  pane.refresh();
});
fLevel.addButton({ title: 'Random seed' }).on('click', () => { P.seed = Math.floor(Math.random() * 99999); pane.refresh(); rebuildCave(); });

const fSound = pane.addFolder({ title: 'Sound', expanded: false });
fSound.addBinding(P, 'sound', { label: 'Sound on (M)' });
fSound.addBinding(P, 'volume', { label: 'Volume', min: 0, max: 1, step: 0.01 });

const fView = pane.addFolder({ title: 'View and debug', expanded: false });
fView.addBinding(P, 'split', { label: 'Split', options: { 'Side by side': 'side', Stacked: 'stacked' } }).on('change', applyLayout);
fView.addBinding(P, 'smoke', { label: 'Engine smoke' });
fView.addBinding(P, 'smokeLife', { label: 'Smoke fade, s', min: 0.3, max: 8, step: 0.1 });
fView.addBinding(P, 'smokeRate', { label: 'Smoke puffs per s', min: 5, max: 150, step: 1 });
fView.addBinding(P, 'zoom', { label: 'Zoom', min: 0.5, max: 4, step: 0.05 });
fView.addBinding(P, 'cameraLag', { label: 'Camera lag, s', min: 0, max: 1, step: 0.01 });
fView.addBinding(P, 'lookahead', { label: 'Camera lookahead, s', min: 0, max: 1, step: 0.01 });
fView.addBinding(P, 'showTrajectory', { label: 'Trajectory preview' });
fView.addBinding(P, 'trajectorySeconds', { label: 'Preview length, s', min: 0.5, max: 8, step: 0.5 });
fView.addBinding(P, 'showHull', { label: 'Hull sample points' });
fView.addBinding(P, 'showVelocity', { label: 'Velocity arrow' });
fView.addBinding(P, 'timeScale', { label: 'Time scale', min: 0.05, max: 2, step: 0.05 });
fView.addBinding(P, 'physicsHz', { label: 'Physics rate', options: { '60 Hz': 60, '120 Hz': 120, '240 Hz': 240 } });
fView.addBinding(mon, 'fps', { label: 'Frames per s', readonly: true, format: (v) => String(Math.round(v)) });

const padOptions = { None: -1, 'Gamepad 1': 0, 'Gamepad 2': 1, 'Gamepad 3': 2, 'Gamepad 4': 3 };
const fInput = pane.addFolder({ title: 'Input', expanded: false });
fInput.addBinding(P, 'p1Pad', { label: 'Player 1 pad', options: padOptions });
fInput.addBinding(P, 'p2Pad', { label: 'Player 2 pad', options: padOptions });
fInput.addBinding(P, 'deadzone', { label: 'Stick deadzone', min: 0, max: 0.6, step: 0.01 });
fInput.addBinding(mon, 'keys', { label: 'Keys held', readonly: true, interval: 50 });
fInput.addBinding(mon, 'pads', { label: 'Gamepads', readonly: true, multiline: true, rows: 3, interval: 500 });

const fPresets = pane.addFolder({ title: 'Presets', expanded: true });
fPresets.addBlade({
  view: 'list', label: 'Start from',
  options: [{ text: 'Classic', value: 'classic' }, { text: 'Floaty', value: 'floaty' }, { text: 'Twitchy', value: 'twitchy' }, { text: 'Heavy', value: 'heavy' }],
  value: 'classic',
}).on('change', (ev) => {
  const keep = { map: P.map, seed: P.seed, rockAmount: P.rockAmount, noiseScale: P.noiseScale, tunnelRadius: P.tunnelRadius, split: P.split, p1Pad: P.p1Pad, p2Pad: P.p2Pad };
  applyTuning({ ...DEFAULTS, ...PRESETS[ev.value], ...keep });
  mon.presetStatus = `Loaded the ${ev.value} handling.`;
});
fPresets.addButton({ title: 'Save in this browser' }).on('click', () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(P)); mon.presetStatus = `Saved at ${new Date().toLocaleTimeString()}.`; }
  catch (e) { mon.presetStatus = 'This browser blocked saving. Use the JSON box instead.'; }
});
fPresets.addButton({ title: 'Load from this browser' }).on('click', () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { mon.presetStatus = 'Nothing saved in this browser yet.'; return; }
    applyTuning(JSON.parse(raw));
    mon.presetStatus = 'Loaded your saved tuning.';
  } catch (e) { mon.presetStatus = 'Couldn’t read the saved tuning.'; }
});
fPresets.addButton({ title: 'Copy or paste JSON' }).on('click', openJson);
fPresets.addButton({ title: 'Reset everything to defaults' }).on('click', () => { applyTuning(DEFAULTS); mon.presetStatus = 'Back to defaults.'; });
fPresets.addBinding(mon, 'presetStatus', { label: 'Status', readonly: true, interval: 300 });

function applyTuning(obj) {
  for (const k of Object.keys(DEFAULTS)) {
    if (obj && k in obj && typeof obj[k] === typeof DEFAULTS[k]) P[k] = obj[k];
  }
  applyLayout();
  for (const s of ships) s.ammo = Math.min(s.ammo, P.ammoMax);
  pane.refresh();
}

/* JSON dialog */
const dlg = document.getElementById('jsonDialog');
const jsonText = document.getElementById('jsonText');
const jsonMsg = document.getElementById('jsonMsg');
function openJson() {
  jsonText.value = JSON.stringify(P, null, 2);
  jsonMsg.textContent = '';
  dlg.showModal();
  jsonText.select();
}
document.getElementById('jsonApply').addEventListener('click', () => {
  try {
    applyTuning(JSON.parse(jsonText.value));
    jsonMsg.textContent = 'Applied.';
    mon.presetStatus = 'Applied tuning from JSON.';
  } catch (e) {
    jsonMsg.textContent = 'That isn’t valid JSON. Check for a missing comma or quote.';
  }
});
document.getElementById('jsonClose').addEventListener('click', () => dlg.close());


/* ------------------------------------------------------------------ *
 * Skins: one colour per player, applied to the ship, its aim guide, shield,
 * bullets, landing pad, opponent pointer and HUD.
 * ------------------------------------------------------------------ */
const SKINS = [
  { id: 'sun', name: 'Sun', hex: '#ffe066' },
  { id: 'sky', name: 'Sky', hex: '#6ee7ff' },
  { id: 'mint', name: 'Mint', hex: '#6dfbb0' },
  { id: 'bubblegum', name: 'Bubblegum', hex: '#ff8fc8' },
  { id: 'orchid', name: 'Orchid', hex: '#c9a0ff' },
  { id: 'tangerine', name: 'Tangerine', hex: '#ffab4a' },
  { id: 'lime', name: 'Lime', hex: '#c8f560' },
  { id: 'pearl', name: 'Pearl', hex: '#f1eefc' },
];
const skinOf = (id) => SKINS.find((k) => k.id === id) || SKINS[0];
const shadeHex = (hex, f) => '#' + hexRGB(hex).map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('');
function applySkins(ids) {
  ids.forEach((id, i) => {
    const hex = skinOf(id).hex, s = ships[i];
    SKIN[i] = hex;
    s.hex = hex;
    s.color.set(hex);
    s.hullMat.color.set(hex);
    s.shadeMat.color.set(hex).multiplyScalar(0.6);
    s.aura.material.color.set(hex);
    s.shield.material.color.set(hex);
    s.crossMat.color.set(hex);
    s.traj.material.color.set(hex);
    s.arrow.setColor(hex);
    const a = s.aimGeo.attributes.color;
    for (let k = 0; k < a.count; k++) a.setXYZ(k, s.color.r, s.color.g, s.color.b);
    a.needsUpdate = true;
    // Each player's pointer shows the other player's colour.
    pointers[1 - i].glow.material.color.set(hex);
    pointers[1 - i].arrow.material.color.set(hex);
    document.documentElement.style.setProperty(i ? '--p2' : '--p1', hex);
  });
  levelMat.uniforms.uP1.value.copy(srgb3(SKIN[0]));
  levelMat.uniforms.uP2.value.copy(srgb3(SKIN[1]));
  updateWeaponButtons();
}
// The ship drawn as a small SVG, the same outline as in the game.
const rocketSVG = (hex) => `<svg viewBox="-10 -14 20 34" aria-hidden="true"><path d="M-3.5 8 L0 19 L3.5 8Z" fill="#ff8f3d"/><path d="M-1.6 8 L0 13.5 L1.6 8Z" fill="#fff1c2"/><path d="M0 -12 L-8 8 L-3 4.5 L0 4.5Z" fill="${hex}"/><path d="M0 -12 L0 4.5 L3 4.5 L8 8Z" fill="${shadeHex(hex, 0.6)}"/><path d="M0 -7 L2.6 -0.5 L-2.6 -0.5Z" fill="#1b1640"/><path d="M0 -6.2 L-1.9 -1.2 L-0.9 -1.2Z" fill="#b9b0ff" opacity="0.7"/></svg>`;

/* ------------------------------------------------------------------ *
 * Start screen: players, skins and map. Shown when the page opens and
 * from the New game button (or N).
 * ------------------------------------------------------------------ */
const SETUP_KEY = 'rocket-duel-setup-v1';
const startEl = document.getElementById('startScreen');
const setup = { players: 2, skins: ['sun', 'sky'], map: 'cave' };
let gameStarted = false;
try {
  const saved = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
  if (saved) {
    if (saved.players === 1 || saved.players === 2) setup.players = saved.players;
    if (Array.isArray(saved.skins) && saved.skins.length === 2 && saved.skins.every((k) => SKINS.some((x) => x.id === k)) && saved.skins[0] !== saved.skins[1]) setup.skins = saved.skins;
    if (saved.map === 'practice' || MAPS[saved.map]) setup.map = saved.map;
  }
} catch (e) { /* no saved setup */ }
const hashMode = location.hash.slice(1);
if (hashMode === 'practice') { setup.players = 1; setup.map = 'practice'; }
else if (hashMode === 'solo') setup.players = 1;
else if (hashMode === 'duel') setup.players = 2;
if (setup.players === 2 && setup.map === 'practice') setup.map = 'cave';

const PRACTICE_CARD = {
  name: 'Practice arena',
  desc: 'Empty space with a grid. Infinite ammo and a speed readout to learn the physics.',
  art: () => svgWrap('practice', `
    <rect width="180" height="110" fill="#120f2e"/>
    <path d="${Array.from({ length: 9 }, (_, i) => `M${i * 22 + 2} 0V110`).join('')}${Array.from({ length: 6 }, (_, i) => `M0 ${i * 22 + 0}H180`).join('')}" stroke="#2b2650" stroke-width="1"/>
    <rect x="3" y="3" width="174" height="104" rx="4" fill="none" stroke="#3a3466" stroke-width="6"/>
    <path d="M60 86 C 70 40, 110 30, 132 50" fill="none" stroke="${skinOf(setup.skins[0]).hex}" stroke-width="1.6" stroke-dasharray="3 4" opacity="0.7"/>
    <g transform="translate(60 86) rotate(20) scale(1.1)">${rocketSVG(skinOf(setup.skins[0]).hex).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`),
};
const startMapList = () => (setup.players === 1 ? ['practice'] : []).concat(Object.keys(MAPS));

function renderStart() {
  // Players
  startEl.querySelectorAll('.seg-btn').forEach((b) => {
    const n = +b.dataset.players;
    b.setAttribute('aria-pressed', String(setup.players === n));
    b.querySelector('.seg-ico').innerHTML = (n === 1 ? [0] : [0, 1]).map((i) => rocketSVG(skinOf(setup.skins[i]).hex)).join('');
  });
  // Skins
  const rows = document.getElementById('skinRows');
  rows.textContent = '';
  [0, 1].forEach((i) => {
    const row = document.createElement('div');
    row.className = 'skin-row';
    row.hidden = setup.players === 1 && i === 1;
    const cur = skinOf(setup.skins[i]), other = setup.skins[1 - i];
    row.style.setProperty('--skin', cur.hex);
    row.innerHTML = `<span class="skin-preview">${rocketSVG(cur.hex)}</span><div><div class="skin-who">Player ${i + 1} <span>${cur.name}</span></div><div class="swatches" role="group" aria-label="Player ${i + 1} colour"></div></div>`;
    const sw = row.querySelector('.swatches');
    for (const k of SKINS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--c', k.hex);
      b.setAttribute('aria-pressed', String(k.id === cur.id));
      const taken = setup.players === 2 && k.id === other;
      if (taken) b.setAttribute('aria-disabled', 'true');
      b.title = taken ? `${k.name} (Player ${2 - i} has it)` : k.name;
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => {
        if (taken) return;
        // In 1 player mode, Player 2 swaps over if it had this colour, so a later 2 player game still has two colours.
        if (k.id === other) setup.skins[1 - i] = setup.skins[i];
        setup.skins[i] = k.id;
        renderStart();
        rows.querySelectorAll('.skin-row')[i].querySelector(`.swatch[aria-pressed="true"]`).focus();
      });
      sw.append(b);
    }
    rows.append(row);
  });
  // Maps
  const grid = document.getElementById('startMaps');
  grid.textContent = '';
  for (const k of startMapList()) {
    const def = k === 'practice' ? PRACTICE_CARD : MAPS[k];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-card';
    b.dataset.map = k;
    b.setAttribute('aria-pressed', String(setup.map === k));
    const pic = document.createElement('span');
    pic.className = 'map-art';
    pic.innerHTML = k === 'practice' ? def.art() : MAP_ART[k] ? MAP_ART[k]() : '';
    const name = document.createElement('span');
    name.className = 'name'; name.textContent = def.name;
    const desc = document.createElement('span');
    desc.className = 'desc'; desc.textContent = def.desc || '';
    b.title = def.desc || def.name;
    b.append(pic, name, desc);
    b.addEventListener('click', () => {
      setup.map = k;
      grid.querySelectorAll('.map-card').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.map === k)));
    });
    b.addEventListener('dblclick', startGame);
    grid.append(b);
  }
  document.getElementById('startGo').style.setProperty('--p1', skinOf(setup.skins[0]).hex);
  document.getElementById('startBack').hidden = !gameStarted;
}
startEl.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
  setup.players = +b.dataset.players;
  if (setup.players === 2 && setup.map === 'practice') setup.map = MAPS[P.map] ? P.map : 'cave';
  renderStart();
  startEl.querySelector(`.seg-btn[data-players="${setup.players}"]`).focus();
}));

function openStart() {
  if (!startEl.hidden) return;
  closePicker();
  if (gameStarted) {
    // Start from what is being played now.
    setup.players = isSolo() ? 1 : 2;
    setup.map = isPractice() ? 'practice' : (MAPS[level.builtMap] ? level.builtMap : setup.map);
  }
  renderStart();
  startEl.hidden = false;
  game.picking = true;
  keysDown.clear();
  document.getElementById('startGo').focus();
}
function closeStart() {
  startEl.hidden = true;
  game.picking = picker.open;
  keysDown.clear();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
function startGame() {
  applySkins(setup.skins);
  let mode;
  if (setup.players === 1 && setup.map === 'practice') mode = 'practice';
  else {
    if (setup.map !== 'practice') P.map = setup.map;
    mode = setup.players === 1 ? 'solo' : 'duel';
  }
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch (e) { /* saving is optional */ }
  closeStart();
  if (game.paused) togglePause();
  setMode(mode, true);
  pane.refresh();
  gameStarted = true;
}
function startKey(e) {
  if (e.code === 'Escape' && gameStarted) { e.preventDefault(); closeStart(); return; }
  const onButton = e.target && e.target.closest && e.target.closest('button');
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !onButton && !e.repeat) { e.preventDefault(); startGame(); }
}
document.getElementById('startGo').addEventListener('click', startGame);
document.getElementById('startBack').addEventListener('click', closeStart);
document.getElementById('btnNewGame').addEventListener('click', openStart);

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */
applySkins(setup.skins);
setMode(location.hash.slice(1), true);
openStart();
window.__duelStarted = true;
window.__duel = { P, PR, ships, level, game, solidAt, setMode };
requestAnimationFrame((t) => { last = t; frame(t); });
