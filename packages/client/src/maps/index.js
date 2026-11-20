import { clamp } from '@rocket-duel/shared/math.js';
import { H, level, onLevel } from '@rocket-duel/shared/level/mask.js';
import { rowColor } from '../render/field.js';
import { levelMat, skyMat } from '../render/scene.js';
import { resetBoxes } from '../systems/boxes.js';
import { forest } from './forest/index.js';
import { desert } from './desert/index.js';
import { floors } from './floors/index.js';
import { ship } from './starship/index.js';

/* ------------------------------------------------------------------ *
 * Map themes. Each theme (level.theme) is one object; the core asks the
 * active one instead of checking which map is on. Every field is optional:
 *
 *   shader: { forest, desert, steel }   sky and terrain shader switches (0 or 1)
 *   material                            what shot terrain sprays: 'soil', 'sand' or 'metal' (default 'rock')
 *   ground                              dust colour [r, g, b] (default: the rock colour at that height)
 *   coop                                players can't hurt each other and kills don't score
 *   sealedHalls                         supply boxes may sit anywhere open, even out of reach for now
 *   eatenText                           status line for a ship eaten by the map's creature
 *
 *   enter() / leave()                   a level with this theme was built / another theme replaced it
 *   reset()                             a new match starts on this map
 *   step(h)                             fixed-step update while this map is on
 *   draw(now, alpha)                    every frame, for every theme (each hides its own meshes when off)
 *
 *   carved(x, y, r)                     terrain was dug out
 *   blocksShot(x, y)                    true where something besides terrain stops bullets
 *   breakAt(x, y)                       walls can't be dug here; shots only break this map's breakables
 *   bulletHit(x, y, owner, dmg, kind)   a bullet reached the map's creatures or enemies; true stops it
 *   blastHit(x, y, R, owner, dmg)       a Cannon blast of radius R went off
 *   beamHit(b, s, len, half, dmg)       ship s's Big laser beam b, len long and half wide, is burning
 *   shipsSafe()                         true while no ship can take damage
 *   onKill(s) / onRespawn(s)
 *
 *   keydown(e)                          true when the map used the key
 *   hudLevel()                          the level line in the mini HUD, or null for the map's name
 *   shipStatus(s)                       status line for a living ship
 *   enemies()                           things the off-screen arrows point at
 *   cameraFocus()                       [x, y] that every camera should watch, or null
 * ------------------------------------------------------------------ */
const rock = {};
let themes = null;   // built on first use, after every map module has loaded
const table = () => (themes ??= { rock, forest, desert, floors, ship });
export const activeMap = () => table()[level.theme] || rock;
export const allMaps = () => Object.values(table());

export function groundRGB(y) { return activeMap().ground || rowColor[clamp(Math.floor(H - y), 0, H - 1)]; }
onLevel('carved', (x, y, r) => activeMap().carved?.(x, y, r));

// Switches each map's visuals and systems on or off when the level changes.
export function applyTheme() {
  const m = activeMap(), sh = m.shader || {};
  skyMat.uniforms.uForest.value = levelMat.uniforms.uForest.value = sh.forest || 0;
  skyMat.uniforms.uDesert.value = levelMat.uniforms.uDesert.value = sh.desert || 0;
  levelMat.uniforms.uSteel.value = sh.steel || 0;
  for (const t of allMaps()) if (t !== m) t.leave?.();
  m.enter?.();
  resetBoxes();
}
