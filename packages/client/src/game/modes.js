import { isPractice, isSolo, P } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { stage } from '../render/scene.js';
import { armForMatch, ships } from '@rocket-duel/shared/ships/ship.js';
import { respawn } from '@rocket-duel/shared/ships/physics.js';
import { clearBullets } from '@rocket-duel/shared/bullets.js';
import { DB } from '../fx/debris.js';
import { PT } from '../fx/particles.js';
import { resetBoxes } from '@rocket-duel/shared/boxes.js';
import { resetMatchScore } from '@rocket-duel/shared/victory.js';
import { cpuPlays, resetCpu } from '@rocket-duel/shared/cpu.js';
import { closePicker, updateMapButton } from '../ui/mapPicker.js';
import { fLevel, fPractice } from '../ui/tuningPanel.js';
import { activeMap, applyTheme } from '../maps/index.js';
import { generateMap } from '@rocket-duel/shared/level/generate.js';
import { views } from '../ships/view.js';
import { singleView } from '../render/camera.js';

// Match flow: restart, rebuild the map, and switch between duel, solo and practice.
export function restartMatch() {
  game.matchClock = 0;
  for (const s of ships) armForMatch(s);
  resetMatchScore();
  resetCpu();
  for (const s of ships) respawn(s);
  activeMap().reset?.();
  resetBoxes();
  if (isSolo() && !cpuPlays()) deactivate(ships[1]);
  clearBullets();
  PT.on.fill(0); DB.on.fill(0);
}
function deactivate(s) {
  s.active = false; s.alive = false; s.thrust = 0;
  const v = views[s.id];
  v.group.visible = false; v.traj.visible = false; v.hullPts.visible = false; v.arrow.visible = false;
}
// Builds the map, then switches the map theme and the Map button to it.
export function buildLevel() {
  generateMap();
  applyTheme();
  updateMapButton();
}
export function rebuildCave() {
  game.matchClock = 0;
  for (const s of ships) armForMatch(s);
  buildLevel();
  for (const s of ships) respawn(s);
  if (isSolo() && !cpuPlays()) deactivate(ships[1]);
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
    sub: 'You against a computer pilot, on your pick of map.', restart: 'Restart match', name: 'You',
    keys: '<kbd>W</kbd><kbd>↑</kbd>thrust <kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd>turn <kbd>L Shift</kbd><kbd>-</kbd>fire <kbd>S</kbd><kbd>↓</kbd>weapon <kbd>Q</kbd>next map <kbd>M</kbd>sound',
    aria: 'Game view, one player. W or Up thrusts, A and D or Left and Right turn, left Shift or minus fires.',
  },
  practice: {
    sub: 'One ship, empty space, just the walls. Try the physics.', restart: 'Reset ship <kbd>R</kbd>', name: 'Practice',
    keys: '<kbd>W</kbd><kbd>↑</kbd>thrust <kbd>A</kbd><kbd>D</kbd><kbd>←</kbd><kbd>→</kbd>turn <kbd>L Shift</kbd><kbd>-</kbd>fire <kbd>S</kbd><kbd>↓</kbd>weapon <kbd>R</kbd>reset <kbd>M</kbd>sound',
    aria: 'Practice view. One ship in an empty arena. W or Up thrusts, A and D or Left and Right turn, left Shift or minus fires, R resets the ship.',
  },
};
export function applyLayout() { stage.dataset.split = singleView() ? 'single' : P.split; }
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
