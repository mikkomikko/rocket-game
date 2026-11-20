import { fbm } from '../math.js';

/* ------------------------------------------------------------------ *
 * The level: one bitmap mask, used for both collision and drawing.
 * Mask values: 0 empty, 1 rock (destructible), 2 hard border, 3 landing pad.
 * Mask rows run top to bottom; world y runs bottom to top (row = H - y).
 * ------------------------------------------------------------------ */

export let W = 1800, H = 1100;            // level size: 1 world unit = 1 mask pixel

export const level = {
  mask: new Uint8Array(W * H),
  spawns: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
  theme: 'rock', builtMap: null,
  spec: null,   // extra layout from the map generator (Floors, Starship, Robot hangar)
};

/* Level events, for whoever draws or reacts to the level:
 *   resized()                 the world changed size (W, H)
 *   painted(x0, y0, x1, y1)   mask cells in this region changed (x = column, y = row)
 *   carved(x, y, r)           a crater was dug at world (x, y) */
const listeners = { resized: [], painted: [], carved: [] };
export const onLevel = (type, fn) => { listeners[type].push(fn); };
const emit = (type, ...args) => { for (const fn of listeners[type]) fn(...args); };
export const repaint = (x0, y0, x1, y1) => emit('painted', x0, y0, x1, y1);

// Most maps are 1800 × 1100; a map can ask for another size (Floors is tall and narrow).
export function resizeWorld(w, h) {
  if (w === W && h === H) return;
  W = w; H = h;
  level.mask = new Uint8Array(W * H);
  emit('resized');
}

export function maskAt(x, y) {
  const c = Math.floor(x), r = Math.floor(H - y);
  if (c < 0 || c >= W || r < 0 || r >= H) return 2;
  return level.mask[r * W + c];
}
export const solidAt = (x, y) => maskAt(x, y) !== 0;

// Carve a disk in mask coordinates. Only rock (1) is removed; borders and pads survive.
export function carveDiskMask(cx, cy, r, paint) {
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
  if (changed && paint) repaint(cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3);
  return changed;
}
// World-space crater (used by bullets and explosions).
export function carve(x, y, r) {
  if (carveDiskMask(x, H - y, r, true)) emit('carved', x, y, r);
}

/* Map styles. Each one fills the mask with rock (1) in mask coordinates (x = column, y = row);
 * the spawn chambers, landing pads and the frame are added afterwards by generateLevel. */
export function fillBlob(m, cx, cy, r, seed) {
  const r0 = Math.max(0, Math.floor(cy - r * 1.3)), r1 = Math.min(H - 1, Math.ceil(cy + r * 1.3));
  const c0 = Math.max(0, Math.floor(cx - r * 1.3)), c1 = Math.min(W - 1, Math.ceil(cx + r * 1.3));
  for (let row = r0; row <= r1; row++) {
    for (let c = c0; c <= c1; c++) {
      if (Math.hypot(c - cx, row - cy) < r * (0.7 + 0.6 * fbm(c / 45, row / 45, seed))) m[row * W + c] = 1;
    }
  }
}
// Rolling ground (and optional ceiling), mirrored around the middle so both sides match.
export function fillGround(m, seed, base, amp, ceiling) {
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
export function mirrorLeft(m) {
  for (let row = 0; row < H; row++) {
    for (let c = 0; c < W / 2; c++) m[row * W + (W - 1 - c)] = m[row * W + c];
  }
}
export const farFrom = (x, y, pts, d) => pts.every((p) => Math.hypot(p.x - x, p.y - y) > d);
