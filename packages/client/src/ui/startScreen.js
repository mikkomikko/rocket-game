import { isPractice, isSolo, P } from '../config.js';
import { game } from '../state.js';
import { level } from '../level/mask.js';
import { MAPS } from '../level/terrain.js';
import { keysDown } from '../input.js';
import { setMode } from '../game/modes.js';
import { togglePause } from './header.js';
import { closePicker, picker } from './mapPicker.js';
import { MAP_ART, svgWrap } from './mapArt.js';
import { pane } from './tuningPanel.js';
import { applySkins, rocketSVG, skinOf, SKINS } from './skins.js';

/* ------------------------------------------------------------------ *
 * Start screen: players, skins and map. Shown when the page opens and
 * from the New game button (or N).
 * ------------------------------------------------------------------ */
const SETUP_KEY = 'rocket-duel-setup-v1';
export const startEl = document.getElementById('startScreen');
export const setup = { players: 2, skins: ['sun', 'sky'], map: 'cave' };
let gameStarted = false;
try {
  const saved = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
  if (saved) {
    if (saved.players === 1 || saved.players === 2) setup.players = saved.players;
    if (Array.isArray(saved.skins) && saved.skins.length === 2 && saved.skins.every((k) => SKINS.some((x) => x.id === k)) && saved.skins[0] !== saved.skins[1]) setup.skins = saved.skins;
    if (saved.map === 'practice' || MAPS[saved.map]) setup.map = saved.map;
  }
} catch (e) { /* no saved setup */ }
const hashMode = location.hash.slice(1);
if (hashMode === 'practice') { setup.players = 1; setup.map = 'practice'; }
else if (hashMode === 'solo') setup.players = 1;
else if (hashMode === 'duel') setup.players = 2;
if (setup.players === 2 && setup.map === 'practice') setup.map = 'cave';

const PRACTICE_CARD = {
  name: 'Practice arena',
  desc: 'Empty space with a grid. Infinite ammo and a speed readout to learn the physics.',
  art: () => svgWrap('practice', `
    <rect width="180" height="110" fill="#120f2e"/>
    <path d="${Array.from({ length: 9 }, (_, i) => `M${i * 22 + 2} 0V110`).join('')}${Array.from({ length: 6 }, (_, i) => `M0 ${i * 22 + 0}H180`).join('')}" stroke="#2b2650" stroke-width="1"/>
    <rect x="3" y="3" width="174" height="104" rx="4" fill="none" stroke="#3a3466" stroke-width="6"/>
    <path d="M60 86 C 70 40, 110 30, 132 50" fill="none" stroke="${skinOf(setup.skins[0]).hex}" stroke-width="1.6" stroke-dasharray="3 4" opacity="0.7"/>
    <g transform="translate(60 86) rotate(20) scale(1.1)">${rocketSVG(skinOf(setup.skins[0]).hex).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`),
};
const startMapList = () => (setup.players === 1 ? ['practice'] : []).concat(Object.keys(MAPS));

function renderStart() {
  // Players
  startEl.querySelectorAll('.seg-btn').forEach((b) => {
    const n = +b.dataset.players;
    b.setAttribute('aria-pressed', String(setup.players === n));
    b.querySelector('.seg-ico').innerHTML = (n === 1 ? [0] : [0, 1]).map((i) => rocketSVG(skinOf(setup.skins[i]).hex)).join('');
  });
  // Skins
  const rows = document.getElementById('skinRows');
  rows.textContent = '';
  [0, 1].forEach((i) => {
    const row = document.createElement('div');
    row.className = 'skin-row';
    row.hidden = setup.players === 1 && i === 1;
    const cur = skinOf(setup.skins[i]), other = setup.skins[1 - i];
    row.style.setProperty('--skin', cur.hex);
    row.innerHTML = `<span class="skin-preview">${rocketSVG(cur.hex)}</span><div><div class="skin-who">Player ${i + 1} <span>${cur.name}</span></div><div class="swatches" role="group" aria-label="Player ${i + 1} colour"></div></div>`;
    const sw = row.querySelector('.swatches');
    for (const k of SKINS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--c', k.hex);
      b.setAttribute('aria-pressed', String(k.id === cur.id));
      const taken = setup.players === 2 && k.id === other;
      if (taken) b.setAttribute('aria-disabled', 'true');
      b.title = taken ? `${k.name} (Player ${2 - i} has it)` : k.name;
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => {
        if (taken) return;
        // In 1 player mode, Player 2 swaps over if it had this colour, so a later 2 player game still has two colours.
        if (k.id === other) setup.skins[1 - i] = setup.skins[i];
        setup.skins[i] = k.id;
        renderStart();
        rows.querySelectorAll('.skin-row')[i].querySelector(`.swatch[aria-pressed="true"]`).focus();
      });
      sw.append(b);
    }
    rows.append(row);
  });
  // Maps
  const grid = document.getElementById('startMaps');
  grid.textContent = '';
  for (const k of startMapList()) {
    const def = k === 'practice' ? PRACTICE_CARD : MAPS[k];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-card';
    b.dataset.map = k;
    b.setAttribute('aria-pressed', String(setup.map === k));
    const pic = document.createElement('span');
    pic.className = 'map-art';
    pic.innerHTML = k === 'practice' ? def.art() : MAP_ART[k] ? MAP_ART[k]() : '';
    const name = document.createElement('span');
    name.className = 'name'; name.textContent = def.name;
    const desc = document.createElement('span');
    desc.className = 'desc'; desc.textContent = def.desc || '';
    b.title = def.desc || def.name;
    b.append(pic, name, desc);
    b.addEventListener('click', () => {
      setup.map = k;
      grid.querySelectorAll('.map-card').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.map === k)));
    });
    b.addEventListener('dblclick', startGame);
    grid.append(b);
  }
  document.getElementById('startGo').style.setProperty('--p1', skinOf(setup.skins[0]).hex);
  document.getElementById('startBack').hidden = !gameStarted;
}
startEl.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
  setup.players = +b.dataset.players;
  if (setup.players === 2 && setup.map === 'practice') setup.map = MAPS[P.map] ? P.map : 'cave';
  renderStart();
  startEl.querySelector(`.seg-btn[data-players="${setup.players}"]`).focus();
}));

export function openStart() {
  if (!startEl.hidden) return;
  closePicker();
  if (gameStarted) {
    // Start from what is being played now.
    setup.players = isSolo() ? 1 : 2;
    setup.map = isPractice() ? 'practice' : (MAPS[level.builtMap] ? level.builtMap : setup.map);
  }
  renderStart();
  startEl.hidden = false;
  game.picking = true;
  keysDown.clear();
  document.getElementById('startGo').focus();
}
function closeStart() {
  startEl.hidden = true;
  game.picking = picker.open;
  keysDown.clear();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
function startGame() {
  applySkins(setup.skins);
  let mode;
  if (setup.players === 1 && setup.map === 'practice') mode = 'practice';
  else {
    if (setup.map !== 'practice') P.map = setup.map;
    mode = setup.players === 1 ? 'solo' : 'duel';
  }
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch (e) { /* saving is optional */ }
  closeStart();
  if (game.paused) togglePause();
  setMode(mode, true);
  pane.refresh();
  gameStarted = true;
}
export function startKey(e) {
  if (e.code === 'Escape' && gameStarted) { e.preventDefault(); closeStart(); return; }
  const onButton = e.target && e.target.closest && e.target.closest('button');
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !onButton && !e.repeat) { e.preventDefault(); startGame(); }
}
document.getElementById('startGo').addEventListener('click', startGame);
document.getElementById('startBack').addEventListener('click', closeStart);
document.getElementById('btnNewGame').addEventListener('click', openStart);
