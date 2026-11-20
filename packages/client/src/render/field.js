import { H, level, onLevel, W } from '@rocket-duel/shared/level/mask.js';

/* The level as the GPU draws it: a softened copy of the mask (R = rock, G = landing pad), rows bottom
 * to top, so the terrain shader can draw smooth, anti-aliased cave walls at any zoom. */
export const field = { data: new Uint8Array(W * H * 2), tex: null, dirty: false };

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

// Rebuild the drawing field for a mask region (x = column, y = row) with a 5x5 binomial blur.
const BLUR = [1, 4, 6, 4, 1];
export function paintRegion(x0, y0, x1, y1) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
  x1 = Math.min(W - 1, x1 | 0); y1 = Math.min(H - 1, y1 | 0);
  if (x1 < x0 || y1 < y0) return;
  const m = level.mask, f = field.data;
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
  field.dirty = true;
}

onLevel('resized', () => {
  field.data = new Uint8Array(W * H * 2);
  rowColor.length = 0;
  for (let r = 0; r < H; r++) rowColor.push(rockRGB(H - r));
});
onLevel('painted', paintRegion);
