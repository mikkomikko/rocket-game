import { level } from '../level/mask.js';
import { levelMat, skyMat } from '../render/scene.js';
import { backPlants, buildPlants, frontPlants, plants } from './forest/plants.js';
import { resetDino } from './forest/dino.js';
import { resetPickup } from './forest/pickup.js';
import { buildDesertPlants } from './desert/plants.js';
import { resetWorm } from './desert/worm.js';
import { buildFloors, clearFloors, resetLava } from './floors.js';
import { buildStarship, clearStarship } from './starship/starship.js';
import { resetBoxes } from '../systems/boxes.js';

// Switches each map's visuals and systems on or off when the level changes.
export function applyTheme() {
  const f = level.theme === 'forest' ? 1 : 0, dz = level.theme === 'desert' ? 1 : 0;
  skyMat.uniforms.uForest.value = f;
  levelMat.uniforms.uForest.value = f;
  skyMat.uniforms.uDesert.value = dz;
  levelMat.uniforms.uDesert.value = dz;
  backPlants.visible = frontPlants.visible = !!(f || dz);
  if (f) buildPlants(); else if (dz) buildDesertPlants(); else plants.length = 0;
  resetDino(); resetWorm();
  resetPickup();
  resetBoxes();
  levelMat.uniforms.uSteel.value = level.theme === 'floors' || level.theme === 'ship' ? 1 : 0;
  if (level.theme === 'ship') buildStarship(); else clearStarship();
  if (level.theme === 'floors') { buildFloors(); resetLava(0); resetLava(1); }
  else clearFloors();
}
