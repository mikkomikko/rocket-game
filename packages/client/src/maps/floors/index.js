import { clamp } from '@rocket-duel/shared/math.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { FL, floorsRules } from '@rocket-duel/shared/maps/floors.js';
import { buildFloors, clearFloors, drawFloors, floorLooks } from './floors.js';

const floorOf = (s) => clamp(Math.floor((s.y - 300) / 400) + 2, 1, 10);

// Floors: a race up two hallways with lava rising behind you. The race runs in the shared rules
// (floorsRules: lava, asteroids, orange blocks, scoring); this adds how it looks.
export const floors = {
  ...floorsRules,
  shader: { steel: 1 },
  material: 'metal',
  enter() { floorsRules.start(); buildFloors(); },
  leave() { clearFloors(); floorsRules.start(); },
  step(h) { floorLooks(h); },
  draw(now, alpha) { drawFloors(now, alpha); },
  hudLevel() { return `Level: floor ${floorOf(ships[0])} · floor ${floorOf(ships[1])}`; },
  shipStatus(s) { return `Floor ${floorOf(s)} of 10 · lava ${Math.max(0, Math.round(s.y - FL.lava[s.id]))} below`; },
};
