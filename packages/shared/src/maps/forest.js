import { MINIGUN_TIME, P } from '../config.js';
import { approach, clamp, segDist } from '../math.js';
import { H, level, solidAt, W } from '../level/mask.js';
import { simEvent } from '../events.js';
import { random } from '../random.js';
import { SHIP_RADIUS, ships } from '../ships/ship.js';
import { addShake, kill } from '../ships/physics.js';

/* ------------------------------------------------------------------ *
 * Forest planet rules: the dinosaur that runs by every 10 s and the minigun pickup on the top island.
 * State only; the client draws them (client maps/forest) and hears:
 *   dinoRun()                      a new run started (DINO.pal and DINO.rare say how it looks)
 *   dinoAte(s, x, y)               the dino ate ship s at its mouth (x, y)
 *   dinoKilled(x, y)               a shot killed the dino; (x, y) is its middle
 *   minigunTaken(s) / minigunBack()
 * ------------------------------------------------------------------ */
export const DINO_S = 0.85, DINO_SPEED = 330, DINO_EVERY = 10, DINO_PALETTES = 9;
export const DINO = { active: false, x: 0, y: 0, px: 0, py: 0, dir: -1, next: 4, phase: 0, pphase: 0, open: 0.1, chew: 0, alpha: 0, run: 0, pal: 1, rare: false };
const MINIGUN_BACK = 20;
export const PU = { active: false, x: 0, y: 0, respawn: 0 };

function groundUnder(x, y) {
  if (solidAt(x, y)) { for (let k = 0; k < 120 && solidAt(x, y); k++) y += 1; return y; }
  for (let k = 0; k < 900 && y > 0 && !solidAt(x, y - 1); k++) y -= 1;
  return y;
}
// World y of the first solid ground at or below (x, y).
export function topBelow(x, y) {
  while (y > 0 && !solidAt(x, y)) y -= 1;
  return y + 1;
}
export const dinoMouth = () => ({ x: DINO.x + DINO.dir * 46 * DINO_S, zx: DINO.x + DINO.dir * 54 * DINO_S, y: DINO.y + 53 * DINO_S });

// One shot kills the dino: is the point (x, y) inside its body?
export function dinoHit(x, y) {
  if (level.theme !== 'forest' || !DINO.active || DINO.alpha < 0.3) return false;
  const lx = (x - DINO.x) * DINO.dir / DINO_S, ly = (y - DINO.y) / DINO_S;
  return lx > -52 && lx < 48 && ly > -2 && ly < 76;
}
export function killDino() {
  simEvent('dinoKilled', DINO.x - DINO.dir * 4 * DINO_S, DINO.y + 36 * DINO_S);
  for (const s of ships) if (s.active) addShake(s, 0.5);
  DINO.active = false; DINO.chew = 0;
}
function eatShip(s, m) {
  simEvent('dinoAte', s, m.zx, m.y);
  kill(s, true);
  addShake(s, 1.4);
  DINO.open = 0; DINO.chew = 0.7;
}
// Each run the dino gets a new colour (never the same twice in a row); every fifth run is the rare mushroom dino.
function newLook() {
  DINO.run++;
  DINO.rare = DINO.run % 5 === 0;
  if (!DINO.rare) {
    let k = Math.floor(random() * (DINO_PALETTES - 1));
    if (k >= DINO.pal) k++;
    DINO.pal = k;
  }
}
function stepDino(h) {
  // A new run starts every DINO_EVERY seconds, alternating left and right.
  DINO.next -= h;
  if (DINO.next <= 0) {
    DINO.next += DINO_EVERY;
    DINO.dir = -DINO.dir;
    DINO.x = DINO.dir > 0 ? 24 : W - 24;
    DINO.y = groundUnder(DINO.x, 420);
    DINO.px = DINO.x; DINO.py = DINO.y; DINO.pphase = 0;
    DINO.phase = 0; DINO.open = 0.1; DINO.chew = 0; DINO.alpha = 0;
    DINO.active = true;
    newLook();
    simEvent('dinoRun');
  }
  if (!DINO.active) return;
  DINO.px = DINO.x; DINO.py = DINO.y; DINO.pphase = DINO.phase;
  DINO.x += DINO.dir * DINO_SPEED * h;
  DINO.phase += h * 15;
  const target = groundUnder(DINO.x, DINO.y + 24);
  DINO.y += (target - DINO.y) * Math.min(1, h * 25);
  const fromWall = DINO.dir > 0 ? DINO.x - 16 : W - 16 - DINO.x;
  const toWall = DINO.dir > 0 ? W - 16 - DINO.x : DINO.x - 16;
  DINO.alpha = clamp(Math.min(fromWall, toWall) / 60, 0, 1);
  if (toWall <= 0) { DINO.active = false; return; }
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
function stepPickup(h) {
  if (!PU.active) {
    if (PU.respawn > 0) {
      PU.respawn -= h;
      if (PU.respawn <= 0) { PU.active = true; simEvent('minigunBack'); }
    }
    return;
  }
  for (const s of ships) {
    if (!s.active || !s.alive || Math.hypot(s.x - PU.x, s.y - PU.y) > 26 * Math.max(1, P.shipSize)) continue;
    s.minigunT = MINIGUN_TIME;
    PU.active = false;
    PU.respawn = MINIGUN_BACK;
    simEvent('minigunTaken', s);
    break;
  }
}

export const forestRules = {
  start() {
    Object.assign(DINO, { active: false, next: 4, chew: 0, run: 0 });
    PU.active = level.theme === 'forest';
    PU.respawn = 0;
    if (PU.active) { PU.x = W / 2; PU.y = topBelow(W / 2, H - 60) + 22; }
  },
  simStep(h) { stepDino(h); stepPickup(h); },
  bulletHit(x, y) {
    if (!dinoHit(x, y)) return false;
    killDino();
    return true;
  },
  beamHit(b, s, len, half) {
    if (DINO.active && segDist(DINO.x, DINO.y + 36 * DINO_S, b.ox, b.oy, b.ang, len) < half + 40 * DINO_S) killDino();
  },
  // Online: [dino: active, x, y, dir, phase, open, alpha, run, pal, rare], [pickup: active, x, y]
  encode() {
    const d = DINO;
    return [[d.active, d.x, d.y, d.dir, d.phase, d.open, d.alpha, d.run, d.pal, d.rare], [PU.active, PU.x, PU.y]];
  },
  apply([d, pu]) {
    const was = DINO.active;
    DINO.px = DINO.x; DINO.py = DINO.y; DINO.pphase = DINO.phase;
    [DINO.active, DINO.x, DINO.y, DINO.dir, DINO.phase, DINO.open, DINO.alpha, DINO.run, DINO.pal, DINO.rare] = d;
    if (!was) { DINO.px = DINO.x; DINO.py = DINO.y; DINO.pphase = DINO.phase; }   // a new run: no slide from the old spot
    [PU.active, PU.x, PU.y] = pu;
  },
};
