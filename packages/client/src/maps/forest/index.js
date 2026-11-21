import { forestRules } from '@rocket-duel/shared/maps/forest.js';
import { backPlants, buildPlants, clearPlants, frontPlants, plantsAfterCarve } from './plants.js';
import { dinoLooks, drawDino, resetDinoLooks } from './dino.js';
import { drawPickup } from './pickup.js';

// Forest planet: Jurassic plants, the dinosaur and the minigun pickup. The dino and the pickup run in
// the shared rules (forestRules); this adds how they look.
export const forest = {
  ...forestRules,
  shader: { forest: 1 },
  material: 'soil',
  ground: [104, 84, 56],
  eatenText: 'Eaten by the dino!',
  enter() {
    backPlants.visible = frontPlants.visible = true;
    buildPlants();
    forestRules.start(); resetDinoLooks();
  },
  leave() { clearPlants(); forestRules.start(); resetDinoLooks(); },
  reset() { forestRules.start(); resetDinoLooks(); },
  step(h) { dinoLooks(h); },
  draw(now, alpha) { drawDino(alpha); drawPickup(now); },
  carved(x, y, r) { plantsAfterCarve(x, y, r); },
};
