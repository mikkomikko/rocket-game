import { segDist } from '../../util/math.js';
import { emit } from '../../fx/particles.js';
import { backPlants, clearPlants, frontPlants, plantsAfterCarve } from '../forest/plants.js';
import { buildDesertPlants, SAND } from './plants.js';
import { drawWorm, hurtWorm, killWorm, resetWorm, stepWorm, WORM, WORM_R, wormHit } from './worm.js';

// Dune sea: cacti, bones and the giant sandworm.
export const desert = {
  shader: { desert: 1 },
  material: 'sand',
  ground: [222, 170, 112],
  eatenText: 'Swallowed by the sandworm!',
  enter() {
    backPlants.visible = frontPlants.visible = true;
    buildDesertPlants();
    resetWorm();
  },
  leave() { clearPlants(); resetWorm(); },
  reset() { resetWorm(); },
  step(h) { stepWorm(h); },
  draw(now, alpha) { drawWorm(alpha); },
  carved(x, y, r) { plantsAfterCarve(x, y, r); },
  bulletHit(x, y) {
    const wh = wormHit(x, y);
    if (!wh) return false;
    if (wh === 2) hurtWorm(); else for (let j = 0; j < 5; j++) emit(x, y, (Math.random() - 0.5) * 120, Math.random() * 100, 0.4, SAND, 1, 2 + Math.random() * 3);
    return true;
  },
  beamHit(b, s, len, half) {
    if (WORM.state === 'fly' && segDist(WORM.hx, WORM.hy, b.ox, b.oy, b.ang, len) < half + WORM_R) killWorm();
  },
};
