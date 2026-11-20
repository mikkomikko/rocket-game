import { isPractice, P } from '../config.js';
import { mulberry32 } from '../util/math.js';
import { carveDiskMask, H, level, paintRegion, resizeWorld, W } from './mask.js';
import { MAPS } from './terrain.js';
import { applyTheme } from '../maps/theme.js';
import { updateMapButton } from '../ui/mapPicker.js';

// Level building: runs the chosen map's terrain generator, or an empty arena for practice.
export function generateLevel(paint = true) {
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
export function buildLevel() {
  if (isPractice()) generateEmptyLevel(); else generateLevel();
  level.theme = (!isPractice() && MAPS[level.builtMap] && MAPS[level.builtMap].theme) || 'rock';
  applyTheme();
  updateMapButton();
}
