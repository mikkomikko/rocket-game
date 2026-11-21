import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, P } from '../src/config.js';
import { game } from '../src/state.js';
import { level } from '../src/level/mask.js';
import { generateMap } from '../src/level/generate.js';
import { onSim } from '../src/events.js';
import { seedRandom } from '../src/random.js';
import { ships } from '../src/ships/ship.js';
import { respawn } from '../src/ships/physics.js';
import { clearBullets, spawnBullet } from '../src/bullets.js';
import { stepSim } from '../src/sim.js';
import { resetBoxes } from '../src/boxes.js';
import { mapRules, setMapRules } from '../src/maps.js';
import { rulesFor } from '../src/maps/index.js';
import { ONLINE_MAPS } from '../src/net.js';
import { SH } from '../src/maps/starship.js';
import { RB, ROBOT_HIP, ROBOT_MAXHP } from '../src/maps/hangar.js';

// The Starship and Robot hangar rules (theme 'ship') played in Node, as the server plays them.
const H = 1 / 120;
setMapRules(() => rulesFor(level.theme));
const counts = {};
for (const type of ['shipLevel', 'shipWave', 'enemySpawned', 'enemyKilled', 'enemyFired', 'robotDrop', 'robotLanded', 'robotBroke', 'robotHurt', 'robotCrash'])
  onSim(type, () => { counts[type] = (counts[type] || 0) + 1; });

function newMatch(map, seed = 1) {
  Object.assign(P, structuredClone(DEFAULTS), { map });
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
const run = (seconds, until = () => false) => { for (let t = 0; t < seconds && !until(); t += H) stepSim(H); };

describe('the Starship', () => {
  beforeEach(() => newMatch('starship'));

  it('is an online map, with the hangar', () => {
    expect(ONLINE_MAPS).toContain('starship');
    expect(ONLINE_MAPS).toContain('hangar');
  });

  it('waits on the level chooser, and a level choice starts its wave', () => {
    expect(SH.state).toBe('choose');
    mapRules().action(ships[0], { level: 9 });   // not a level: ignored
    mapRules().action(ships[0], 'level');
    expect(SH.state).toBe('choose');
    mapRules().action(ships[1], { level: 2 });
    expect(counts.shipLevel).toBe(1);
    expect(SH.state).toBe('between');
    run(2.1);
    expect(SH.state).toBe('fight');
    expect(SH.wave).toBe(1);
    expect(counts.shipWave).toBe(1);
    run(2);
    expect(SH.enemies.length).toBe(3);   // level 2: three red ships
    expect(counts.enemySpawned).toBe(3);
  });

  it('lets the players\' shots kill a red ship and score it', () => {
    mapRules().action(ships[0], { level: 1 });
    run(5, () => SH.enemies.length > 0);
    const e = SH.enemies[0];
    for (let k = 0; k < 4 && !e.dead; k++) { spawnBullet(0, e.x - 40, e.y, 1500, 0, 1); run(0.05); }
    expect(e.dead).toBe(true);
    expect(counts.enemyKilled).toBe(1);
    expect(ships[0].score).toBe(1);
    expect(ships[1].score).toBe(0);   // co-op: nobody scores by dying
    run(0.1);
    expect(SH.enemies.length).toBe(0);
  });

  it('lets a red ship\'s shot hurt a player', () => {
    const s = ships[0];
    s.invulnT = 0;
    spawnBullet(2, s.x, s.y + 60, 0, -600, 1);
    run(0.2);
    expect(s.hp).toBeLessThan(100);
  });

  it('has red ships that fire at the players', () => {
    mapRules().action(ships[0], { level: 3 });
    run(8);
    expect(counts.enemyFired).toBeGreaterThan(0);
  });

  it('takes its state back from a snapshot', () => {
    mapRules().action(ships[0], { level: 6 });
    run(5);
    const snap = JSON.parse(JSON.stringify(mapRules().encode()));
    mapRules().apply(snap);
    expect(mapRules().encode()).toEqual(snap);
    expect(SH.enemies.every((e) => e.K && e.id > 0)).toBe(true);
  });

  it('plays the same twice from the same seed and inputs', () => {
    const play = () => {
      newMatch('starship', 5);
      mapRules().action(ships[0], { level: 4 });
      ships[0].input = { turn: 0.3, thrust: 0.6, fire: true };
      ships[1].input = { turn: -0.2, thrust: 0.7, fire: true };
      run(12);
      return JSON.stringify([mapRules().encode(), ships.map((s) => [s.x, s.y, s.hp, s.score, s.alive])]);
    };
    const a = play();
    expect(play()).toBe(a);
    expect(SH.state).not.toBe('choose');
  });
});

describe('the Robot hangar', () => {
  beforeEach(() => newMatch('hangar'));

  it('drops the giant robot, which takes extra damage to the head and dies', () => {
    expect(SH.state).toBe('between');
    run(3.1);
    expect(SH.state).toBe('robot');
    expect(counts.robotDrop).toBe(1);
    run(6, () => RB.state === 'fight');
    expect(counts.robotLanded).toBe(1);
    const head = () => [RB.x, RB.y + RB.bob + ROBOT_HIP + 250];
    expect(mapRules().bulletHit(...head(), 0, 10, 0)).toBe(true);
    expect(RB.hp).toBe(ROBOT_MAXHP - 15);   // the head takes 1.5 times
    expect(mapRules().bulletHit(RB.x, RB.y + RB.bob + 300, 1, 10, 0)).toBe(true);
    expect(RB.hp).toBe(ROBOT_MAXHP - 25);
    while (!RB.dead) mapRules().bulletHit(...head(), 0, 40, 0);
    expect(counts.robotBroke).toBe(5);
    expect(RB.state).toBe('dying');
    expect(ships[0].score).toBe(5);
    expect(mapRules().shipsSafe()).toBe(true);   // the cutscene
    run(12, () => SH.state === 'done');
    expect(counts.robotCrash).toBe(1);
    expect(SH.state).toBe('done');
    expect(mapRules().shipsSafe()).toBe(false);
    const snap = JSON.parse(JSON.stringify(mapRules().encode()));
    mapRules().apply(snap);
    expect(mapRules().encode()).toEqual(snap);
    mapRules().action(ships[1], { restart: true });   // R on the finish panel: the robot is coming again
    expect(SH.state).toBe('between');
    expect(RB.state).toBe('off');
    expect(ships[0].score).toBe(0);
  });

  it('plays the same twice from the same seed and inputs', () => {
    const play = () => {
      newMatch('hangar', 3);
      ships[0].input = { turn: 0.2, thrust: 0.65, fire: true };
      ships[1].input = { turn: -0.3, thrust: 0.6, fire: true };
      run(14);
      return JSON.stringify([mapRules().encode(), ships.map((s) => [s.x, s.y, s.hp, s.score, s.alive])]);
    };
    const a = play();
    expect(play()).toBe(a);
    expect(RB.state).not.toBe('off');
  });
});
