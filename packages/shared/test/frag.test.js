import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, FRAG_IDX, P, SHARD_IDX, WEAPONS } from '../src/config.js';
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
import { resetBoxes } from '../src/boxes.js';

const H = 1 / 120;
setMapRules(() => rulesFor(level.theme));
let bursts = 0, shardHits = [];
onSim('fragBurst', () => { bursts++; });
onSim('shipHit', (x, y, s, kind) => { if (kind === SHARD_IDX) shardHits.push(s.id); });
const run = (seconds) => { for (let t = 0; t < seconds; t += H) stepSim(H); };
const live = (kind) => { let n = 0; for (let i = 0; i < MAXB; i++) n += B.on[i] && B.kind[i] === kind ? 1 : 0; return n; };
const grenade = () => { for (let i = 0; i < MAXB; i++) if (B.on[i] && B.kind[i] === FRAG_IDX) return i; return -1; };

// Two ships in an empty cave with no gravity: ship 0 points up (+y), ship 1 straight above it, dy away.
function setup(dy) {
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
    Object.assign(s, { landed: false, onPad: false, vx: 0, vy: 0, av: 0, a: 0, invulnT: 0, x: W / 2 });
  }
  ships[0].y = LH / 2 - 300; ships[1].y = ships[0].y + dy;
  ships[0].weapon = FRAG_IDX;
  bursts = 0; shardHits = [];
}

describe('the frag grenade', () => {
  beforeEach(() => setup(1000));

  it('leaves fast, slows down quickly and only goes a short way', () => {
    fire(ships[0]);
    const i = grenade(), v0 = Math.hypot(B.vx[i], B.vy[i]), y0 = B.y[i];
    run(0.3);
    expect(Math.hypot(B.vx[i], B.vy[i])).toBeLessThan(v0 * 0.5);
    run(0.6);
    expect(B.y[i] - y0).toBeLessThan(300);
  });

  it('falls once it has slowed down', () => {
    P.gravity = DEFAULTS.gravity;
    fire(ships[0]);
    const i = grenade();
    run(0.9);
    expect(B.vy[i]).toBeLessThan(0);
  });

  it('bursts on its fuse into shards flying every way, and the shards hit a ship further on', () => {
    setup(260);
    fire(ships[0]);
    run(1.15);
    expect(bursts).toBe(1);
    expect(live(FRAG_IDX)).toBe(0);
    expect(live(SHARD_IDX)).toBeGreaterThan(WEAPONS[FRAG_IDX].frag.n - 4);   // a few may already have hit
    run(1);
    expect(shardHits.length).toBeGreaterThan(0);
    expect(shardHits.every((id) => id === 1)).toBe(true);   // never the thrower
    expect(ships[1].hp).toBeLessThan(100);
    expect(ships[0].hp).toBe(100);
    expect(live(SHARD_IDX)).toBe(0);
  });

  it('bursts on a direct hit and several shards hit the ship', () => {
    setup(110);
    fire(ships[0]);
    run(1.5);
    expect(bursts).toBe(1);
    expect(shardHits.length).toBeGreaterThan(1);
    expect(ships[1].hp).toBeLessThan(100 - P.bulletDamage * WEAPONS[FRAG_IDX].damage);
  });

  it('bursts at rock instead of inside it', () => {
    setup(1000);
    const y = Math.round(ships[0].y + 120);
    for (let x = W / 2 - 60; x < W / 2 + 60; x++) for (let yy = y; yy < y + 40; yy++) level.mask[yy * W + x] = 1;
    fire(ships[0]);
    run(1.5);
    expect(bursts).toBe(1);
  });

  it('can be picked, but its shards never can', () => {
    ships[0].weapon = 0;
    const seen = new Set();
    for (let k = 0; k < WEAPONS.length * 2; k++) { cycleWeapon(ships[0]); seen.add(ships[0].weapon); }
    expect(seen.has(FRAG_IDX)).toBe(true);
    expect(seen.has(SHARD_IDX)).toBe(false);
  });
});
