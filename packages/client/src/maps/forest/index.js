import { segDist } from '@rocket-duel/shared/math.js';
import { backPlants, buildPlants, clearPlants, frontPlants, plantsAfterCarve } from './plants.js';
import { DINO, DINO_S, dinoHit, drawDino, killDino, resetDino, stepDino } from './dino.js';
import { drawPickup, resetPickup, stepPickup } from './pickup.js';

// Forest planet: Jurassic plants, the dinosaur and the minigun pickup.
export const forest = {
  shader: { forest: 1 },
  material: 'soil',
  ground: [104, 84, 56],
  eatenText: 'Eaten by the dino!',
  enter() {
    backPlants.visible = frontPlants.visible = true;
    buildPlants();
    resetDino(); resetPickup();
  },
  leave() { clearPlants(); resetDino(); resetPickup(); },
  reset() { resetDino(); resetPickup(); },
  step(h) { stepDino(h); stepPickup(h); },
  draw(now, alpha) { drawDino(alpha); drawPickup(now); },
  carved(x, y, r) { plantsAfterCarve(x, y, r); },
  bulletHit(x, y) {
    if (!dinoHit(x, y)) return false;
    killDino();
    return true;
  },
  beamHit(b, s, len, half) {
    if (DINO.active && segDist(DINO.x, DINO.y + 36 * DINO_S, b.ox, b.oy, b.ang, len) < half + 40 * DINO_S) killDino();
  },
};
