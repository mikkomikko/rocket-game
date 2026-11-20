import { isPractice, isSolo, P } from '../config.js';
import { game } from '../state.js';
import { level } from '../level/mask.js';
import { buildLevel } from '../level/generate.js';
import { stage } from '../render/scene.js';
import { ships } from '../ships/ship.js';
import { respawn } from '../ships/physics.js';
import { clearBullets } from '../fx/bullets.js';
import { DB } from '../fx/debris.js';
import { PT } from '../fx/particles.js';
import { resetDino } from '../maps/forest/dino.js';
import { resetPickup } from '../maps/forest/pickup.js';
import { resetWorm } from '../maps/desert/worm.js';
import { resetStarship } from '../maps/starship/starship.js';
import { resetBoxes } from '../systems/boxes.js';
import { closePicker } from '../ui/mapPicker.js';
import { fLevel, fPractice } from '../ui/tuningPanel.js';

// Match flow: restart, rebuild the map, and switch between duel, solo and practice.
export function restartMatch() {
  game.matchClock = 0;
  for (const s of ships) { s.bigLaser = 1; s.beam = null; }   // a new match: one Big laser shot each
  for (const s of ships) { s.score = 0; respawn(s); }
  resetDino(); resetWorm();
  resetPickup();
  resetBoxes();
  if (level.theme === 'ship') resetStarship();
  if (isSolo()) deactivate(ships[1]);
  clearBullets();
  PT.on.fill(0); DB.on.fill(0);
}
function deactivate(s) {
  s.active = false; s.alive = false; s.thrust = 0;
  s.group.visible = false; s.traj.visible = false; s.hullPts.visible = false; s.arrow.visible = false;
}
export function rebuildCave() {
  game.matchClock = 0;
  for (const s of ships) { s.bigLaser = 1; s.beam = null; }
  buildLevel();
  for (const s of ships) respawn(s);
  if (isSolo()) deactivate(ships[1]);
  clearBullets();
  PT.on.fill(0); DB.on.fill(0);
}

/* Modes: the duel, or practice with one ship in an empty arena. #practice links straight to it. */
const MODE_TEXT = {
  duel: {
    sub: 'Two ships, one cave, every constant on a slider.', restart: 'Restart match', name: 'Player 1',
    keys: '<kbd>W</kbd>thrust <kbd>A</kbd><kbd>D</kbd>turn <kbd>L Shift</kbd>fire <kbd>S</kbd>weapon <kbd>Q</kbd>all maps <kbd>M</kbd>sound',
    aria: 'Game view. Player 1 uses W, A, D and left Shift. Player 2 uses the arrow keys and the minus key.',
  },
  solo: {
    sub: 'One ship, your pick of map.', restart: 'Restart match', name: 'Player 1',
    keys: '<kbd>W</kbd><kbd>↑</kbd>thrust <kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd>turn <kbd>L Shift</kbd><kbd>-</kbd>fire <kbd>S</kbd><kbd>↓</kbd>weapon <kbd>Q</kbd>next map <kbd>M</kbd>sound',
    aria: 'Game view, one player. W or Up thrusts, A and D or Left and Right turn, left Shift or minus fires.',
  },
  practice: {
    sub: 'One ship, empty space, just the walls. Try the physics.', restart: 'Reset ship <kbd>R</kbd>', name: 'Practice',
    keys: '<kbd>W</kbd><kbd>↑</kbd>thrust <kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd>turn <kbd>L Shift</kbd><kbd>-</kbd>fire <kbd>S</kbd><kbd>↓</kbd>weapon <kbd>R</kbd>reset <kbd>M</kbd>sound',
    aria: 'Practice view. One ship in an empty arena. W or Up thrusts, A and D or Left and Right turn, left Shift or minus fires, R resets the ship.',
  },
};
export function applyLayout() { stage.dataset.split = isSolo() ? 'single' : P.split; }
export function setMode(mode, force = false) {
  closePicker();
  if (mode !== 'practice' && mode !== 'solo') mode = 'duel';
  const changed = mode !== game.mode;
  game.mode = mode;
  const t = MODE_TEXT[mode];
  document.querySelector('.sub').textContent = t.sub;
  document.getElementById('btnRestart').innerHTML = t.restart;
  document.querySelector('.hud[data-p="0"] .hud-name').textContent = t.name;
  document.querySelector('.hud[data-p="0"] .hud-keys').innerHTML = t.keys;
  stage.setAttribute('aria-label', t.aria);
  applyLayout();
  fLevel.hidden = isPractice();
  fPractice.hidden = !isPractice();
  if ((location.hash || '#duel').slice(1) !== mode) location.hash = mode;
  if (changed || force) { buildLevel(); restartMatch(); }
}
window.addEventListener('hashchange', () => setMode(location.hash.slice(1)));
