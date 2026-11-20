import { fbm } from '../util/math.js';

/* ------------------------------------------------------------------ *
 * The level: one bitmap mask, used for both collision and drawing.
 * Mask values: 0 empty, 1 rock (destructible), 2 hard border, 3 landing pad.
 * Mask rows run top to bottom; world y runs bottom to top (row = H - y).
 * ------------------------------------------------------------------ */

export let W = 1800, H = 1100;            // level size: 1 world unit = 1 mask pixel

export const level = {
  mask: new Uint8Array(W * H),
  // Drawing field: a softened copy of the mask (R = rock, G = landing pad), rows bottom to top,
  // so the GPU can draw smooth, anti-aliased cave walls at any zoom instead of square pixels.
  field: new Uint8Array(W * H * 2),
  tex: null, dirty: false,
  spawns: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
};
// Filled in by modules that load later: the scene (resized) and the plants (carved).
export const levelHooks = { resized() {}, carved() {} };

// Rock colours by height: a smooth wave through plum, wine, rust and copper (the terrain shader uses the same formula).
const COPPER = [[16, 11, 30], [26, 15, 42], [42, 20, 56], [64, 28, 66]];
function rockRGB(worldY) {
  const t = 0.5 + 0.5 * Math.sin(worldY * (2 * Math.PI / 520) + 0.7);
  const f = t * (COPPER.length - 1);
  const i = Math.min(COPPER.length - 2, Math.floor(f)), k = f - i;
  return [0, 1, 2].map((j) => COPPER[i][j] + (COPPER[i + 1][j] - COPPER[i][j]) * k);
}
export const rowColor = [];
for (let r = 0; r < H; r++) rowColor.push(rockRGB(H - r));

// Most maps are 1800 × 1100; a map can ask for another size (Floors is tall and narrow).
export function resizeWorld(w, h) {
  if (w === W && h === H) return;
  W = w; H = h;
  level.mask = new Uint8Array(W * H);
  level.field = new Uint8Array(W * H * 2);
  rowColor.length = 0;
  for (let r = 0; r < H; r++) rowColor.push(rockRGB(H - r));
  levelHooks.resized();
}

export function maskAt(x, y) {
  const c = Math.floor(x), r = Math.floor(H - y);
  if (c < 0 || c >= W || r < 0 || r >= H) return 2;
  return level.mask[r * W + c];
}
export const solidAt = (x, y) => maskAt(x, y) !== 0;

// Rebuild the drawing field for a mask region (x = column, y = row) with a 5x5 binomial blur.
const BLUR = [1, 4, 6, 4, 1];
export function paintRegion(x0, y0, x1, y1) {
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
  if (changed && paint) paintRegion(cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3);
  return changed;
}
// World-space crater (used by bullets and explosions).
export function carve(x, y, r) {
  if (carveDiskMask(x, H - y, r, true) && (level.theme === 'forest' || level.theme === 'desert')) levelHooks.carved(x, y, r);
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
