import { P } from '../config.js';
import { game } from '../state.js';
import { H, level, repaint, W } from '../level/mask.js';
import { simEvent } from '../events.js';
import { armForMatch, SHIP_RADIUS, ships } from '../ships/ship.js';
import { addShake, damage, kill, respawn } from '../ships/physics.js';
import { clearBullets } from '../bullets.js';
import { resetBoxes } from '../boxes.js';
import { scorePoint } from '../victory.js';

/* ------------------------------------------------------------------ *
 * Floors rules: a race up two hallways with lava rising behind each player. Asteroids drift across the
 * hallways, the orange blocks (level.spec.blocks, hard cells in the mask) break after BLOCK_HP hits, and
 * the first ship over the finish line scores and restarts the race. Wrecks and girders are plain terrain.
 * State only; the client draws it (client maps/floors) and hears:
 *   blockHit(i)            a shot hit block FL.blocks[i]
 *   blockBroken(i)         block i broke; its cells are already cleared from the mask
 *   asteroidHit(s, x, y)   an asteroid struck ship s at (x, y)
 *   floorsWon(s)           ship s reached the top and scored; the race has already restarted
 * ------------------------------------------------------------------ */
export const BLOCK_HP = 5;
// lava/plava: each hallway's lava top now and one step (or snapshot) ago; race counts restarts.
export const FL = { lava: [-60, -60], plava: [-60, -60], v: [0, 0], delay: [0, 0], asteroids: [], blocks: [], halls: [[0, 0], [0, 0]], finish: 1e9, race: 0 };

export function resetLava(i) {
  FL.lava[i] = FL.plava[i] = -60;
  FL.v[i] = P.lavaSpeed;
  FL.delay[i] = P.lavaDelay;
}
// A block's cells in the mask: hard (2) while it stands, empty once broken.
export function paintBlock(b, v) {
  const m = level.mask;
  for (let yy = Math.floor(b.y0); yy < Math.ceil(b.y1); yy++) {
    const row = (H - 1 - yy) * W;
    for (let xx = Math.floor(b.x0); xx < Math.ceil(b.x1); xx++) m[row + xx] = v;
  }
  repaint(b.x0 - 3, H - b.y1 - 3, b.x1 + 3, H - b.y0 + 3);
}

export const bulletHitsRock = (x, y) => FL.asteroids.some((a) => (x - a.x) ** 2 + (y - a.y) ** 2 < a.r * a.r);
export function hitBreakable(x, y) {
  for (let i = 0; i < FL.blocks.length; i++) {
    const b = FL.blocks[i];
    if (!b.alive || x < b.x0 - 3 || x > b.x1 + 3 || y < b.y0 - 3 || y > b.y1 + 3) continue;
    b.hp -= 1;
    simEvent('blockHit', i);
    if (b.hp <= 0) {
      b.alive = false;
      paintBlock(b, 0);
      simEvent('blockBroken', i);
    }
    return true;
  }
  return false;
}

// The level as generated: every block back, asteroids where they started, both lavas down.
function startRace() {
  const sp = level.theme === 'floors' ? level.spec : null;
  FL.blocks = sp ? sp.blocks.map((b) => ({ ...b, hp: BLOCK_HP, alive: true })) : [];
  FL.asteroids = sp ? sp.asteroids.map((a) => ({ ...a, rot: 0, px: a.x, prot: 0 })) : [];
  FL.halls = sp ? sp.halls : [[0, 0], [0, 0]];
  FL.finish = sp ? sp.finish : 1e9;
  resetLava(0); resetLava(1);
}
// The next race: like rebuilding the map (only the blocks ever change its mask), then every ship in play back to its pad.
function restartRace() {
  game.matchClock = 0;
  for (const s of ships) armForMatch(s);
  for (const b of FL.blocks) if (!b.alive) paintBlock(b, 2);
  startRace();
  FL.race++;
  resetBoxes();
  for (const s of ships) if (s.active) respawn(s);
  clearBullets();
}
function reachTop(s) {
  scorePoint(s);
  restartRace();
  simEvent('floorsWon', s);
}

function stepFloors(h) {
  FL.plava[0] = FL.lava[0]; FL.plava[1] = FL.lava[1];
  for (const a of FL.asteroids) { a.px = a.x; a.prot = a.rot; }
  for (let i = 0; i < 2; i++) {
    const s = ships[i];
    if (!s.active) continue;
    if (FL.delay[i] > 0) FL.delay[i] -= h;
    else { FL.v[i] += P.lavaAccel * h; FL.lava[i] = Math.min(H, FL.lava[i] + FL.v[i] * h); }
    s.rockCd = Math.max(0, (s.rockCd || 0) - h);
    if (!s.alive) continue;
    if (s.y - 6 * P.shipSize < FL.lava[i]) { kill(s, 'lava'); continue; }
    if (s.y > FL.finish) { reachTop(s); return; }
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
      simEvent('asteroidHit', s, s.x - nx * SHIP_RADIUS, s.y - ny * SHIP_RADIUS);
    }
  }
}

let synced = false;   // a browser has taken in a snapshot since the map was built
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
export const floorsRules = {
  coop: true,
  sealedHalls: true,   // the orange blocks seal each hallway until they are shot
  start() { startRace(); synced = false; },
  simStep: stepFloors,
  blocksShot: bulletHitsRock,
  breakAt(x, y) { hitBreakable(x, y); },
  onRespawn(s) { resetLava(s.id); },
  // Online: [race, [lava 0, lava 1], [x, rot of each asteroid…], 'hp of each block, one digit each']
  encode() {
    return [FL.race, FL.lava.map(r1), FL.asteroids.flatMap((a) => [r1(a.x), r2(a.rot)]), FL.blocks.map((b) => b.hp).join('')];
  },
  // The browser's mask follows the blocks too, so its predicted ship and shots meet the same walls.
  apply([race, lava, ast, hp]) {
    const fresh = !synced || race !== FL.race;   // the first snapshot or a new race: no slide from where things were
    FL.race = race; synced = true;
    for (let i = 0; i < 2; i++) { FL.plava[i] = fresh ? lava[i] : FL.lava[i]; FL.lava[i] = lava[i]; }
    FL.asteroids.forEach((a, k) => {
      a.px = a.x; a.prot = a.rot;
      a.x = ast[2 * k]; a.rot = ast[2 * k + 1];
      if (fresh) { a.px = a.x; a.prot = a.rot; }
    });
    FL.blocks.forEach((b, k) => {
      b.hp = +hp[k];
      if (b.alive !== b.hp > 0) paintBlock(b, b.hp > 0 ? 2 : 0);
      b.alive = b.hp > 0;
    });
  },
};
