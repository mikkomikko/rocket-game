import { clamp } from '@rocket-duel/shared/math.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { buildFloors, bulletHitsRock, clearFloors, drawFloors, FL, hitBreakable, resetLava, stepFloors } from './floors.js';
import { level } from '@rocket-duel/shared/level/mask.js';

const floorOf = (s) => clamp(Math.floor((s.y - 300) / 400) + 2, 1, 10);

// Floors: a race up two hallways with lava rising behind you.
export const floors = {
  shader: { steel: 1 },
  material: 'metal',
  coop: true,
  sealedHalls: true,   // the orange blocks seal each hallway until they are shot
  enter() { FL.spec = level.spec; buildFloors(); resetLava(0); resetLava(1); },
  leave() { clearFloors(); },
  step(h) { stepFloors(h); },
  draw(now) { drawFloors(now); },
  blocksShot(x, y) { return bulletHitsRock(x, y); },
  breakAt(x, y) { hitBreakable(x, y); },
  onRespawn(s) { resetLava(s.id); },
  hudLevel() { return `Level: floor ${floorOf(ships[0])} · floor ${floorOf(ships[1])}`; },
  shipStatus(s) { return `Floor ${floorOf(s)} of 10 · lava ${Math.max(0, Math.round(s.y - FL.lava[s.id]))} below`; },
};
