import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, P } from '../src/config.js';
import { game } from '../src/state.js';
import { level, solidAt } from '../src/level/mask.js';
import { generateMap } from '../src/level/generate.js';
import { onSim } from '../src/events.js';
import { seedRandom } from '../src/random.js';
import { ships } from '../src/ships/ship.js';
import { respawn } from '../src/ships/physics.js';
import { B, clearBullets } from '../src/bullets.js';
import { stepSim } from '../src/sim.js';
import { resetBoxes } from '../src/boxes.js';
import { mapRules, setMapRules } from '../src/maps.js';
import { rulesFor } from '../src/maps/index.js';
import { BLOCK_HP, FL } from '../src/maps/floors.js';
import { ONLINE_MAPS } from '../src/net.js';

const H = 1 / 120;
const hash = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return (h >>> 0).toString(16); };
setMapRules(() => rulesFor(level.theme));   // as the server does: the shared map rules
const counts = {};
for (const type of ['killed', 'respawned', 'blockHit', 'blockBroken', 'asteroidHit', 'floorsWon']) onSim(type, () => { counts[type] = (counts[type] || 0) + 1; });

function newMatch(seed = 1) {
  Object.assign(P, structuredClone(DEFAULTS), { map: 'floors' });
  game.mode = 'duel'; game.time = 0; game.matchClock = 0;
  generateMap();
  mapRules().start?.();
  clearBullets();
  seedRandom(seed);
  resetBoxes();
  for (const s of ships) {
    s.score = 0; s.weapon = 0; s.bigLaser = 1; s.beam = null;
    s.input = { turn: 0, thrust: 0, fire: false };
    respawn(s);
  }
  for (const k of Object.keys(counts)) delete counts[k];
}
const run = (seconds) => { for (let t = 0; t < seconds; t += H) stepSim(H); };
const mid = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

describe('Floors runs without a browser', () => {
  beforeEach(() => newMatch());

  it('is a coop map the server can run', () => {
    expect(ONLINE_MAPS).toContain('floors');
    expect(mapRules().coop).toBe(true);
    expect(mapRules().sealedHalls).toBe(true);
    expect(FL.blocks.length).toBe(20);
    expect(FL.asteroids.length).toBe(12);
  });

  it('burns a ship the lava catches, without scoring for the other', () => {
    run(P.lavaDelay + 2);   // nobody moves off the pad
    expect(FL.lava[0]).toBeGreaterThan(0);
    expect(counts.killed).toBe(2);
    for (const s of ships) { expect(s.alive).toBe(false); expect(s.lava).toBe(true); expect(s.score).toBe(0); }
    run(P.respawnTime);
    expect(ships[0].alive).toBe(true);
    expect(FL.lava[0]).toBeLessThan(0);   // a respawn starts that hallway's lava over
  });

  it('scores for the first ship over the top and starts the next race', () => {
    const s = ships[1];
    run(1);
    s.x = (FL.halls[1][0] + FL.halls[1][1]) / 2; s.y = FL.finish + 10; s.landed = false;
    stepSim(H);
    expect(counts.floorsWon).toBe(1);
    expect(s.score).toBe(1);
    expect(ships[0].score).toBe(0);
    expect(FL.race).toBe(1);
    for (const sh of ships) { expect(sh.alive).toBe(true); expect(sh.y).toBeLessThan(100); }
  });

  it('breaks an orange block with shots, opening the mask, and puts it back next race', () => {
    const b = FL.blocks[0], [bx, by] = mid(b), s = ships[0];
    expect(solidAt(bx, by)).toBe(true);
    s.input.fire = true;
    for (let t = 0; t < 3 && b.alive; t += H) {
      s.x = bx; s.y = b.y0 - 60; s.vx = s.vy = 0; s.a = 0; s.landed = false; s.ammo = P.ammoMax;   // hover below it, nose up
      stepSim(H);
    }
    expect(counts.blockHit).toBe(BLOCK_HP);
    expect(counts.blockBroken).toBe(1);
    expect(b.alive).toBe(false);
    expect(solidAt(bx, by)).toBe(false);
    s.input.fire = false;
    s.y = FL.finish + 10;   // win the race: the level is as built again
    stepSim(H);
    expect(FL.blocks[0].alive).toBe(true);
    expect(solidAt(bx, by)).toBe(true);
  });

  it('stops shots at asteroids and pushes ships off them', () => {
    const a = FL.asteroids[0], s = ships[a.hall];
    expect(mapRules().blocksShot(a.x, a.y)).toBe(true);
    run(P.invulnTime + 0.1);
    s.x = a.x + a.vx * H; s.y = a.y + 2; s.vx = s.vy = 0; s.landed = false;
    stepSim(H);
    expect(counts.asteroidHit).toBe(1);
    expect(s.hp).toBe(80);
    expect(Math.hypot(s.x - a.x, s.y - a.y)).toBeGreaterThan(a.r);
  });

  it('plays out the same way twice with the same seed and inputs', () => {
    const play = () => {
      newMatch(42);
      const script = (t) => ({ turn: Math.sin(t * 1.3) * 0.4, thrust: t % 2 < 1.4 ? 1 : 0.3, fire: t % 1.5 < 0.8 });
      for (let t = 0; t < 8; t += H) {
        ships[0].input = script(t);
        ships[1].input = script(t + 0.7);
        stepSim(H);
      }
      return JSON.stringify({
        ships: ships.map((s) => [s.x, s.y, s.vx, s.vy, s.a, s.hp, s.ammo, s.alive, s.score]),
        map: mapRules().encode(), lava: FL.lava, mask: hash(level.mask),
        bullets: [...B.on.keys()].filter((i) => B.on[i]).map((i) => [B.x[i], B.y[i], B.kind[i]]).sort(),
      });
    };
    expect(play()).toBe(play());
  });

  it('brings a browser\'s blocks, mask, lava and asteroids in line with a snapshot', () => {
    for (let k = 0; k < BLOCK_HP; k++) mapRules().breakAt(...mid(FL.blocks[3]));
    mapRules().breakAt(...mid(FL.blocks[7]));
    run(P.lavaDelay + 0.5);
    const data = JSON.parse(JSON.stringify(mapRules().encode())), mask = hash(level.mask), lava = FL.lava[0];
    generateMap();   // a browser that just built the map
    mapRules().start();
    expect(hash(level.mask)).not.toBe(mask);
    mapRules().apply(data);
    expect(hash(level.mask)).toBe(mask);
    expect(FL.blocks[3].alive).toBe(false);
    expect(FL.blocks[7].hp).toBe(BLOCK_HP - 1);
    expect(FL.lava[0]).toBeCloseTo(lava, 0);
    expect(FL.plava[0]).toBe(FL.lava[0]);   // a different race: no slide up from the start
  });
});
