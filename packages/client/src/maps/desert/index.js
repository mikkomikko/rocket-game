import { desertRules } from '@rocket-duel/shared/maps/desert.js';
import { backPlants, clearPlants, frontPlants, plantsAfterCarve } from '../forest/plants.js';
import { buildDesertPlants } from './plants.js';
import { drawWorm, hideWorm, wormLooks } from './worm.js';

// Dune sea: cacti, bones and the giant sandworm. The worm runs in the shared rules (desertRules); this
// adds how it looks.
export const desert = {
  ...desertRules,
  shader: { desert: 1 },
  material: 'sand',
  ground: [222, 170, 112],
  eatenText: 'Swallowed by the sandworm!',
  enter() {
    backPlants.visible = frontPlants.visible = true;
    buildDesertPlants();
    desertRules.start(); hideWorm();
  },
  leave() { clearPlants(); desertRules.start(); hideWorm(); },
  reset() { desertRules.start(); hideWorm(); },
  step(h) { wormLooks(h); },
  draw(now, alpha) { drawWorm(alpha); },
  carved(x, y, r) { plantsAfterCarve(x, y, r); },
};
