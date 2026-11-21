import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, MISSILE_IDX, MISSILES, P } from '../src/config.js';
import { game } from '../src/state.js';
import { H as LH, level, W } from '../src/level/mask.js';
import { generateMap } from '../src/level/generate.js';
import { onSim } from '../src/events.js';
import { seedRandom } from '../src/random.js';
import { armForMatch, ships } from '../src/ships/ship.js';
import { respawn } from '../src/ships/physics.js';
import { cycleWeapon, fire } from '../src/ships/weapons.js';
import { B, clearBullets, MAXB } from '../src/bullets.js';
import { stepSim } from '../src/sim.js';
import { setMapRules } from '../src/maps.js';
import { rulesFor } from '../src/maps/index.js';
import { resetMatchScore } from '../src/victory.js';
import { missileReach } from '../src/missile.js';
import { boxes, resetBoxes, stepBoxes } from '../src/boxes.js';

const H = 1 / 120;
setMapRules(() => rulesFor(level.theme));
let blasts = 0, lastFired = null;
onSim('blast', () => { blasts++; });
onSim('fired', (...a) => { lastFired = a; });
const run = (seconds) => { for (let t = 0; t < seconds; t += H) stepSim(H); };

// Two ships hanging in an empty cave (no rock, no gravity): ship 0 at the left pointing up, ship 1 dx to its right.
function setup(dx) {
  Object.assign(P, structuredClone(DEFAULTS), { map: 'cave', gravity: 0 });
  game.mode = 'duel'; game.time = 0; game.matchClock = 0;
  generateMap();
  level.mask.fill(0);
  clearBullets();
  seedRandom(1);
  resetMatchScore();
  resetBoxes();
  for (const s of ships) {
    s.input = { turn: 0, thrust: 0, fire: false };
    respawn(s);
    armForMatch(s);
    Object.assign(s, { landed: false, onPad: false, vx: 0, vy: 0, av: 0, a: 0, invulnT: 0, y: LH / 2 });
  }
  ships[0].x = W / 2 - dx / 2; ships[1].x = W / 2 + dx / 2;
  ships[0].weapon = MISSILE_IDX;
  blasts = 0;
}
const live = () => { let n = 0; for (let i = 0; i < MAXB; i++) n += B.on[i]; return n; };

describe('the homing missile', () => {
  beforeEach(() => setup(300));

  it('curves round to a ship off to the side and hits it', () => {
    expect(missileReach(ships[0])).toMatchObject({ hit: true, x: ships[1].x, y: ships[1].y });
    fire(ships[0]);
    expect(live()).toBe(1);
    run(2.5);
    expect(ships[1].hp).toBeLessThan(100);
    expect(blasts).toBe(1);
    expect(live()).toBe(0);
  });

  it('follows a ship that moves', () => {
    fire(ships[0]);
    ships[1].vy = -120;   // drifting down and away
    run(2.5);
    expect(ships[1].hp).toBeLessThan(100);
  });

  it('runs out of fuel before reaching a ship far enough away', () => {
    setup(1300);
    const reach = missileReach(ships[0]);
    expect(reach.hit).toBe(false);
    expect(Math.hypot(reach.x - ships[1].x, reach.y - ships[1].y)).toBeGreaterThan(200);
    fire(ships[0]);
    run(3);
    expect(ships[1].hp).toBe(100);
    expect(blasts).toBe(1);   // it goes off where its fuel ran out
    expect(live()).toBe(0);
  });

  it('stops at rock in the way, and says so', () => {
    for (let y = 0; y < LH; y++) for (let x = W / 2 - 10; x < W / 2 + 10; x++) level.mask[y * W + x] = 1;
    const reach = missileReach(ships[0]);
    expect(reach.hit).toBe(false);
    expect(reach.x).toBeLessThan(W / 2);
  });

  it('has no target when the other ship is down', () => {
    ships[1].alive = false;
    expect(missileReach(ships[0])).toBe(null);
  });
});

describe('missiles are limited', () => {
  beforeEach(() => setup(300));
  const shoot = () => { ships[0].fireCd = 0; fire(ships[0]); };

  it('tells the shooter where its missile will go', () => {
    shoot();
    expect(lastFired[1]).toBe('missile');
    expect(lastFired[4]).toMatchObject({ hit: true, x: ships[1].x, y: ships[1].y });
    expect(lastFired[4].t).toBeGreaterThan(0);
  });

  it('gives each player two per match, then switches away and skips the Missile', () => {
    expect(ships[0].missiles).toBe(MISSILES);
    shoot();
    expect(ships[0].missiles).toBe(1);
    expect(ships[0].weapon).toBe(MISSILE_IDX);
    shoot();
    expect(ships[0].missiles).toBe(0);
    expect(ships[0].weapon).not.toBe(MISSILE_IDX);   // switched off the empty Missile
    ships[0].weapon = MISSILE_IDX;
    shoot();
    expect(live()).toBe(2);   // no third missile
    for (let k = 0; k < 10; k++) { cycleWeapon(ships[0]); expect(ships[0].weapon).not.toBe(MISSILE_IDX); }
  });

  it('fills the missiles up again from an ammo box', () => {
    shoot(); shoot();
    const box = boxes.find((b) => b.kind === 'ammo');
    Object.assign(box, { on: true, x: ships[0].x, y: ships[0].y });
    stepBoxes(H);
    expect(ships[0].missiles).toBe(MISSILES);
    expect(box.on).toBe(false);
  });
});
