import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, P } from '../src/config.js';
import { game } from '../src/state.js';
import { level } from '../src/level/mask.js';
import { generateMap } from '../src/level/generate.js';
import { onSim, quietly } from '../src/events.js';
import { seedRandom } from '../src/random.js';
import { ships } from '../src/ships/ship.js';
import { damage, moveShip, respawn } from '../src/ships/physics.js';
import { cycleWeapon, fire } from '../src/ships/weapons.js';
import { B, clearBullets, MAXB, onPredictedShot } from '../src/bullets.js';
import { stepSim } from '../src/sim.js';
import { boxes, resetBoxes } from '../src/boxes.js';
import { mapRules, setMapRules } from '../src/maps.js';
import { rulesFor } from '../src/maps/index.js';
import { DINO, dinoMouth, PU } from '../src/maps/forest.js';

const H = 1 / 120;
const hash = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return (h >>> 0).toString(16); };
setMapRules(() => rulesFor(level.theme));   // as the server does: the shared map rules
const counts = {};
for (const type of ['dinoAte', 'dinoKilled', 'minigunTaken', 'boxTaken', 'fired', 'explosion', 'killed', 'respawned', 'weaponChanged', 'blast']) onSim(type, () => { counts[type] = (counts[type] || 0) + 1; });

function newMatch(map = 'cave', seed = 1) {
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
const run = (seconds) => { for (let t = 0; t < seconds; t += H) stepSim(H); };

describe('the duel runs without a browser', () => {
  beforeEach(() => newMatch());

  it('starts both ships landed on their pads', () => {
    for (const s of ships) {
      expect(s.alive).toBe(true);
      expect(s.landed).toBe(true);
      expect(Math.abs(s.x - level.spawns[s.id].x)).toBeLessThan(1);
    }
  });

  it('flies a ship up when it thrusts', () => {
    const s = ships[0], y0 = s.y;
    s.input.thrust = 1;
    run(1);
    expect(s.landed).toBe(false);
    expect(s.y).toBeGreaterThan(y0 + 20);
  });

  it('fires bullets that spend ammo and dig into the cave', () => {
    const s = ships[0], mask0 = hash(level.mask);
    s.input.thrust = 1;   // off the pad, which would rearm it as fast as it fires
    run(0.3);
    s.input.thrust = 0.3; s.input.fire = true;
    run(1);
    expect(counts.fired).toBeGreaterThan(5);
    expect(s.ammo).toBeLessThan(P.ammoMax);
    expect(counts.explosion).toBeGreaterThan(0);
    expect(hash(level.mask)).not.toBe(mask0);
  });

  it('kills a ship, scores for the other one, and respawns it', () => {
    run(P.invulnTime + 0.1);
    damage(ships[1], 1e9);
    expect(ships[1].alive).toBe(false);
    expect(ships[0].score).toBe(1);
    expect(counts.killed).toBe(1);
    run(P.respawnTime + 0.1);
    expect(ships[1].alive).toBe(true);
    expect(counts.respawned).toBeGreaterThanOrEqual(1);
  });

  it('fires a Cannon shell that blasts', () => {
    cycleWeapon(ships[0]);
    expect(ships[0].weapon).toBe(1);
    expect(counts.weaponChanged).toBe(1);
    ships[0].input.fire = true;
    run(0.2);
    ships[0].input.fire = false;
    run(3);
    expect(counts.blast).toBeGreaterThan(0);
    expect(B.on.every((v) => v === 0)).toBe(true);
  });

  it('switches weapon at the step whose input carries the switch', () => {
    const s = ships[0];
    const feed = (inp) => stepSim(H, (x) => (x === s ? [[1, { turn: 0, thrust: 0, fire: false, ...inp }]] : []));
    feed({});
    expect(s.weapon).toBe(0);
    feed({ cycle: true });
    expect(s.weapon).toBe(1);
    expect(counts.weaponChanged).toBe(1);
    feed({});
    expect(s.weapon).toBe(1);
  });

  it('predicts a ship exactly by replaying its inputs from a snapshot', () => {
    newMatch('open', 3);
    const s = ships[0];
    ships[1].active = false;   // nothing else pushes it, so the replay should land exactly
    const inputs = Array.from({ length: 600 }, (_, k) => ({ turn: Math.sin(k / 40), thrust: k % 200 < 120 ? 1 : 0, fire: false }));
    const FIELDS = ['x', 'y', 'vx', 'vy', 'a', 'av', 'thrust', 'landed', 'hp'];
    let snapshot;
    inputs.forEach((inp, k) => {
      s.input = inp;
      stepSim(H);
      if (k === 299) snapshot = Object.fromEntries(FIELDS.map((f) => [f, s[f]]));
    });
    const server = FIELDS.map((f) => s[f]);
    const fired = counts.fired || 0;
    // The browser's side: take the snapshot, replay the inputs the server applied after it.
    Object.assign(s, snapshot);
    game.predicting = true;
    quietly(() => { for (const inp of inputs.slice(300)) { s.input = inp; moveShip(s, H); } });
    game.predicting = false;
    expect(FIELDS.map((f) => s[f])).toEqual(server);
    expect(counts.fired || 0).toBe(fired);   // replays are silent
  });

  it('sends shots fired while predicting to the browser, not into the pool', () => {
    const shots = [];
    onPredictedShot((...args) => shots.push(args));
    const s = ships[0], ammo = s.ammo;
    game.predicting = true;
    quietly(() => fire(s));
    game.predicting = false;
    expect(shots).toHaveLength(1);
    expect(shots[0][0]).toBe(0);   // owner
    expect(B.on.slice(0, MAXB).every((v) => v === 0)).toBe(true);
    expect(s.ammo).toBeLessThan(ammo);   // ammo and cooldown still count, for the replay
    onPredictedShot(null);
  });

  it('plays out the same way twice with the same seed and inputs', () => {
    const play = () => {
      newMatch('open', 42);
      const script = (t) => ({ turn: Math.sin(t * 1.3), thrust: t % 2 < 1.2 ? 1 : 0, fire: t % 1.5 < 0.8 });
      for (let t = 0; t < 6; t += H) {
        ships[0].input = script(t);
        ships[1].input = script(t + 0.7);
        stepSim(H);
      }
      return JSON.stringify({
        ships: ships.map((s) => [s.x, s.y, s.vx, s.vy, s.a, s.hp, s.ammo, s.alive, s.score]),
        mask: hash(level.mask),
        bullets: [...B.on.keys()].filter((i) => B.on[i]).map((i) => [B.x[i], B.y[i], B.kind[i]]).sort(),
      });
    };
    expect(play()).toBe(play());
  });

  it('hands out supply boxes and brings them back later', () => {
    expect(boxes.length).toBeGreaterThan(0);
    const s = ships[0], b = boxes.find((x) => x.kind === 'ammo');
    s.ammo = 5;
    s.x = b.x; s.y = b.y; s.landed = false;
    stepSim(H);
    expect(counts.boxTaken).toBe(1);
    expect(s.ammo).toBe(P.ammoMax);
    expect(b.on).toBe(false);
    run(13);   // an ammo box is back after 12 s
    expect(b.on).toBe(true);
  });

  it('runs the Forest dino: it eats a ship in its way and dies to one shot', () => {
    newMatch('forest');
    for (const s of ships) s.input = { turn: 0, thrust: 0, fire: false };
    run(4.6);   // the first run starts 4 s in
    expect(DINO.active).toBe(true);
    const s = ships[0], m = dinoMouth();
    s.invulnT = 0; s.landed = false;
    s.x = m.zx + DINO.dir * 4; s.y = m.y; s.vx = s.vy = 0;
    stepSim(H);
    expect(counts.dinoAte).toBe(1);
    expect(s.alive).toBe(false);
    expect(s.eaten).toBe(true);
    expect(ships[1].score).toBe(1);
    expect(mapRules().bulletHit(DINO.x, DINO.y + 30, 1, 8, 0)).toBe(true);
    expect(counts.dinoKilled).toBe(1);
    expect(DINO.active).toBe(false);
  });

  it('gives the Forest minigun to the ship that flies into it', () => {
    newMatch('forest');
    expect(PU.active).toBe(true);
    const s = ships[1];
    s.x = PU.x; s.y = PU.y; s.landed = false;
    stepSim(H);
    expect(counts.minigunTaken).toBe(1);
    expect(s.minigunT).toBeGreaterThan(29);
    expect(PU.active).toBe(false);
  });
});
