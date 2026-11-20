import { isPractice, isSolo, P } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { ships } from './ships/ship.js';
import { cycleWeapon } from './ships/weapons.js';
import { restartMatch } from './game/modes.js';
import { togglePanel, togglePause, toggleUI } from './ui/header.js';
import { nextMap, picker, pickerKey } from './ui/mapPicker.js';
import { pane } from './ui/tuningPanel.js';
import { openStart, startEl, startKey } from './ui/startScreen.js';
import { activeMap } from './maps/index.js';

/* ------------------------------------------------------------------ *
 * Input: keyboard and gamepads merged into one action state per player
 * ------------------------------------------------------------------ */
const KEYMAP = [
  { left: ['KeyA'], right: ['KeyD'], thrust: ['KeyW'], fire: ['ShiftLeft'] },
  // "-" sits at a different physical key per layout: beside right Shift on Nordic/German (Slash), beside Backspace on US (Minus).
  { left: ['ArrowLeft'], right: ['ArrowRight'], thrust: ['ArrowUp'], fire: ['Slash', 'Minus', 'NumpadSubtract'] },
];
const GAME_CODES = new Set(KEYMAP.flatMap((m) => Object.values(m).flat()));
export const keysDown = new Set();
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target) || document.getElementById('jsonDialog').open) return;
  if (!startEl.hidden) { startKey(e); return; }
  if (picker.open) { pickerKey(e); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (GAME_CODES.has(e.code)) {
    e.preventDefault();
    keysDown.add(e.code);
    return;
  }
  if ((e.code === 'KeyS' || e.code === 'ArrowDown') && !e.repeat) {
    e.preventDefault();
    if (!game.paused) cycleWeapon(ships[isSolo() || e.code === 'KeyS' ? 0 : 1]);
    return;
  }
  if (e.code === 'KeyP' && !e.repeat) { e.preventDefault(); togglePause(); }
  if (e.code === 'KeyM' && !e.repeat) { e.preventDefault(); P.sound = !P.sound; pane.refresh(); }
  if (e.code === 'KeyH' && !e.repeat) { e.preventDefault(); togglePanel(); }
  if (e.code === 'KeyU' && !e.repeat) { e.preventDefault(); toggleUI(); }
  if (e.code === 'KeyN' && !e.repeat) { e.preventDefault(); openStart(); }
  if (e.code === 'KeyR' && !e.repeat && isPractice()) { e.preventDefault(); restartMatch(); }
  if (!e.repeat && activeMap().keydown?.(e)) e.preventDefault();
  if (e.code === 'KeyQ' && !e.repeat && !isPractice()) { e.preventDefault(); nextMap(); }
});
window.addEventListener('keyup', (e) => { keysDown.delete(e.code); });
window.addEventListener('blur', () => keysDown.clear());

const held = (codes) => codes.some((c) => keysDown.has(c));
export const padsSeen = [];

export function readInputs() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const s of ships) {
    const map = KEYMAP[s.id];
    let turn = (held(map.left) ? 1 : 0) - (held(map.right) ? 1 : 0);
    let thrust = held(map.thrust) ? 1 : 0;
    let fireBtn = held(map.fire);
    const idx = s.id === 0 ? P.p1Pad : P.p2Pad;
    const gp = idx >= 0 ? pads[idx] : null;
    s.padActive = !!(gp && gp.connected);
    if (s.padActive) {
      const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const val = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      let ax = gp.axes[0] || 0;
      const dz = P.deadzone;
      ax = Math.abs(ax) < dz ? 0 : Math.sign(ax) * (Math.abs(ax) - dz) / (1 - dz);
      let padTurn = -ax;
      if (btn(14)) padTurn = 1;
      if (btn(15)) padTurn = -1;
      turn = clamp(turn + padTurn, -1, 1);
      thrust = Math.max(thrust, btn(0) ? 1 : 0, btn(12) ? 1 : 0, val(7));
      fireBtn = fireBtn || btn(2) || btn(1) || btn(5);
      // Y (or the left bumper) switches weapon, once per press
      const sw = btn(3) || btn(4);
      if (sw && !s.padSwitch && !game.paused) cycleWeapon(isSolo() ? ships[0] : s);
      s.padSwitch = sw;
    }
    s.input.turn = turn;
    s.input.thrust = thrust;
    s.input.fire = fireBtn;
  }
  if (isSolo()) {
    // One ship: both key clusters and both pads fly it.
    const a = ships[0].input, b = ships[1].input;
    a.turn = clamp(a.turn + b.turn, -1, 1);
    a.thrust = Math.max(a.thrust, b.thrust);
    a.fire = a.fire || b.fire;
    ships[0].padActive = ships[0].padActive || ships[1].padActive;
  }
  padsSeen.length = 0;
  for (let i = 0; i < pads.length; i++) if (pads[i]) padsSeen.push(`Gamepad ${i + 1}: ${pads[i].id.replace(/\s*\(.*\)\s*/g, ' ').trim().slice(0, 30)}`);
}

const KEY_NAMES = { Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter', NumpadEnter: 'Enter', Numpad0: 'Num 0', ShiftLeft: 'L Shift', Slash: '-', Minus: '-', NumpadSubtract: '-' };
export const prettyKey = (c) => KEY_NAMES[c] || c.replace(/^Key/, '').replace(/^Digit/, '');
