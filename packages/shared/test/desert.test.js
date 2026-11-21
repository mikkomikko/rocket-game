import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, P } from '../src/config.js';
import { game } from '../src/state.js';
import { level } from '../src/level/mask.js';
import { generateMap } from '../src/level/generate.js';
import { onSim } from '../src/events.js';
import { seedRandom } from '../src/random.js';
import { ships } from '../src/ships/ship.js';
import { respawn } from '../src/ships/physics.js';
import { clearBullets } from '../src/bullets.js';
import { stepSim } from '../src/sim.js';
import { resetBoxes } from '../src/boxes.js';
import { mapRules, setMapRules } from '../src/maps.js';
import { rulesFor } from '../src/maps/index.js';
import { desertRules, WORM, WORM_N, wormUnder } from '../src/maps/desert.js';

const H = 1 / 120;
setMapRules(() => rulesFor(level.theme));   // as the server does: the shared map rules
const counts = {};
for (const type of ['wormBurst', 'wormDive', 'wormAte', 'wormHurt', 'wormKilled', 'wormThud', 'killed']) onSim(type, () => { counts[type] = (counts[type] || 0) + 1; });

function newMatch(seed = 1) {
  Object.assign(P, structuredClone(DEFAULTS), { map: 'desert' });
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
// Steps until the worm's head is out of the sand (it first comes out 7 s + 1.6 s of rumble in).
function untilOut() {
  for (let k = 0; k < 120 * 12; k++) {
    stepSim(H);
    if (WORM.state === 'fly' && !wormUnder(WORM.hx, WORM.hy)) return;
  }
  throw new Error('the worm never came out');
}

describe('the Dune sea sandworm runs without a browser', () => {
  beforeEach(() => newMatch());

  it('rumbles, bursts out of the sand and dives back in', () => {
    run(7.1);
    expect(WORM.state).toBe('rumble');
    run(1.6);
    expect(WORM.state).toBe('fly');
    expect(counts.wormBurst).toBe(1);
    run(8);
    expect(WORM.state).toBe('off');
  });

  it('swallows a ship that is in its mouth', () => {
    untilOut();
    const s = ships[0];
    s.invulnT = 0; s.landed = false;
    s.x = WORM.hx + WORM.vx * H; s.y = WORM.hy + WORM.vy * H; s.vx = s.vy = 0;
    stepSim(H);
    expect(counts.wormAte).toBe(1);
    expect(s.alive).toBe(false);
    expect(s.eaten).toBe(true);
    expect(ships[1].score).toBe(1);
    expect(WORM.gulp).toBeGreaterThan(0);
  });

  it('bursts after three shots to the head; body shots only thud', () => {
    untilOut();
    const [bx, by] = WORM.seg[WORM_N - 4];
    expect(mapRules().bulletHit(bx, by, 0, 8, 0)).toBe(true);
    expect(counts.wormThud).toBe(1);
    expect(WORM.hp).toBe(3);
    for (let k = 0; k < 3; k++) expect(mapRules().bulletHit(WORM.hx, WORM.hy, 0, 8, 0)).toBe(true);
    expect(counts.wormHurt).toBe(3);
    expect(counts.wormKilled).toBe(1);
    expect(WORM.state).toBe('off');
    expect(mapRules().bulletHit(WORM.hx, WORM.hy, 0, 8, 0)).toBe(false);
  });

  it('plays out the same way twice with the same seed and inputs', () => {
    const play = () => {
      newMatch(42);
      const script = (t) => ({ turn: Math.sin(t * 1.3), thrust: t % 2 < 1.2 ? 1 : 0, fire: t % 1.5 < 0.8 });
      for (let t = 0; t < 12; t += H) {
        ships[0].input = script(t);
        ships[1].input = script(t + 0.7);
        stepSim(H);
      }
      return JSON.stringify({ ships: ships.map((s) => [s.x, s.y, s.vx, s.vy, s.hp, s.alive, s.score]), worm: desertRules.encode(), x: WORM.x, counts });
    };
    const a = play();
    expect(JSON.parse(a).counts.wormBurst).toBe(1);
    expect(play()).toBe(a);
  });

  it('sends its state compactly and takes it back in', () => {
    untilOut();
    const d = JSON.parse(JSON.stringify(desertRules.encode()));
    expect(d[0][0]).toBe(2);
    expect(d[1]).toHaveLength(4 + 2 * WORM_N);
    const seg = WORM.seg.map((p) => [...p]);
    desertRules.start();
    desertRules.apply(d);
    expect(WORM.state).toBe('fly');
    WORM.seg.forEach(([x, y], i) => { expect(x).toBeCloseTo(seg[i][0], 0); expect(y).toBeCloseTo(seg[i][1], 0); });
    expect(WORM.prev[3]).toEqual(WORM.seg[3]);   // just came out: nothing to slide from
    desertRules.apply([[0, 12, 0, 0]]);
    expect(WORM.state).toBe('off');
  });
});
