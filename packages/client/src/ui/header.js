import { game } from '@rocket-duel/shared/state.js';
import { stage } from '../render/scene.js';
import { WAVES } from '../maps/starship/constants.js';
import { askRestart, pickLevel } from '../maps/starship/starship.js';
import { restartMatch } from '../game/modes.js';

/* ------------------------------------------------------------------ *
 * Header buttons
 * ------------------------------------------------------------------ */
const mainEl = document.getElementById('main');
const btnPause = document.getElementById('btnPause');
const btnPanel = document.getElementById('btnPanel');
export function togglePause() {
  game.paused = !game.paused;
  btnPause.setAttribute('aria-pressed', String(game.paused));
  document.getElementById('pauseOverlay').hidden = !game.paused;
}
export function togglePanel() {
  const hidden = mainEl.classList.toggle('panel-hidden');
  btnPanel.setAttribute('aria-pressed', String(!hidden));
}
document.getElementById('btnRestart').addEventListener('click', restartMatch);
document.getElementById('finishRestart').addEventListener('click', askRestart);
// The five level buttons on the Starship's level chooser (online the server runs the choice).
WAVES.slice(0, 5).forEach((w, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lvl-btn';
  b.innerHTML = `<b>${i + 1}</b><span>${w.bots} robot${w.bots > 1 ? 's' : ''}</span>`;
  b.setAttribute('aria-label', `Level ${i + 1}: ${w.bots} robot${w.bots > 1 ? 's' : ''}`);
  b.addEventListener('click', () => pickLevel(i + 1));
  document.getElementById('levelRow').append(b);
});

btnPause.addEventListener('click', togglePause);
btnPanel.addEventListener('click', togglePanel);
// Hide UI works on every map: header, tuning panel, player panels and the wave bar all go away.
export const appEl = document.querySelector('.app');
export function toggleUI() {
  const hidden = appEl.classList.toggle('ui-hidden');
  document.getElementById('btnUI').setAttribute('aria-pressed', String(hidden));
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
document.getElementById('btnUI').addEventListener('click', toggleUI);
document.getElementById('btnShowUI').addEventListener('click', toggleUI);
// After a mouse click on any button, hand the keyboard back to the ships (Space would re-press it).
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && e.detail > 0) setTimeout(() => b.blur(), 0);
});
stage.addEventListener('pointerdown', () => {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
});
if (window.matchMedia('(max-width: 820px)').matches) togglePanel();
