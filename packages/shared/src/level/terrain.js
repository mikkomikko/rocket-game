import { P } from '../config.js';
import { clamp, fbm, mulberry32, vnoise } from '../math.js';
import { carveDiskMask, farFrom, fillBlob, fillGround, H, level, mirrorLeft, W } from './mask.js';

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
export function fillPolyMask(m, pts, v) {
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
  level.spec = spec;
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
  level.spec = {
    boxes, catwalks, door: [WX0, 340, WX1, 470], hullX: WX0, exitX: 1660,
    spawnPts: [[1300, 950], [700, 950], [1450, 600], [1000, 540], [1300, 330], [620, 380], [1000, 900]], bossSpawn: [900, 820],
    ammo: [[330, 578], [1060, 718], [660, 56], [1300, 56], [830, 146], [1290, 470]],
    medkits: [[505, 236], [1150, 266], [1318, 718]],
  };
  level.spawns = [{ x: 150, y: 66 }, { x: 270, y: 66 }];
}

// Robot hangar: parked starships on stilts, two catwalks and the landing pads at the left.
export const HANGAR_SHIPS = [
  { hull: [[480, 92], [840, 92], [905, 120], [860, 160], [720, 192], [540, 192], [480, 160]], fin: [[480, 160], [545, 192], [520, 250], [486, 246]],
    posts: [[540, 56, 554, 92], [780, 56, 794, 92]], col: '#d8dbe6', under: '#9aa0b4', stripe: '#3d7bff', win: [[812, 138], [782, 148], [752, 155], [722, 160]], nozzle: [474, 124, 30] },
  { hull: [[960, 762], [1260, 762], [1325, 792], [1260, 822], [960, 822], [928, 792]], fin: null,
    posts: [[1050, 822, 1064, 1044], [1170, 822, 1184, 1044]], col: '#e8a23a', under: '#b0712a', stripe: '#3a3f55', win: [[1275, 796], [1245, 798]], nozzle: [934, 792, 26] },
  { hull: [[290, 578], [470, 578], [508, 598], [470, 614], [330, 622], [290, 606]], fin: [[290, 606], [330, 622], [312, 652], [292, 648]],
    posts: [], col: '#ff6a5a', under: '#b8403a', stripe: '#ffffff', win: [[470, 600]], nozzle: [286, 594, 18] },
];
export function terrainHangar(m) {
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
  level.spec = {
    mode: 'robot', boxes: [], catwalks, spawnPts: [[1400, 600]], bossSpawn: [1400, 600],
    ammo: [[400, 622], [650, 192], [1117, 822], [1540, 798]],
    medkits: [[524, 578], [1700, 798]],
  };
  level.spawns = [{ x: 150, y: 66 }, { x: 270, y: 66 }];
}

export const MAPS = {
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
