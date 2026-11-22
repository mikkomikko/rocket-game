import { isPractice, isSolo, P } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { level } from '@rocket-duel/shared/level/mask.js';
import { MAPS } from '@rocket-duel/shared/level/terrain.js';
import { ONLINE_MAPS } from '@rocket-duel/shared/net.js';
import { keysDown } from '../input.js';
import { setMode } from '../game/modes.js';
import { togglePause } from './header.js';
import { closePicker, picker } from './mapPicker.js';
import { MAP_ART, svgWrap } from './mapArt.js';
import { pane } from './tuningPanel.js';
import { applySkins, rocketSVG, skinOf, SKINS } from './skins.js';
import { designOf, DESIGNS } from '../ships/designs.js';
import { connect, hasSeat, net } from '../net/online.js';
import { appEl } from './header.js';
import { isTouch } from '../touch.js';

/* ------------------------------------------------------------------ *
 * Start screen: players, skins (colour and ship design) and map. A page of its own over the whole
 * window: the game behind it is inert and isn't drawn (loop.js). Shown when the page opens and
 * from the New game button (or N). Online starts a room on the server; an
 * invite link (?room=abc123) opens it as "Join online game" instead.
 * ------------------------------------------------------------------ */
const SETUP_KEY = 'rocket-duel-setup-v1';
export const startEl = document.getElementById('startScreen');
export const setup = { players: 2, online: false, skins: ['sun', 'sky'], designs: [DESIGNS[0].id, DESIGNS[0].id], map: 'cave' };
const joinRoom = new URLSearchParams(location.search).get('room');
let gameStarted = false;
try {
  const saved = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
  if (saved) {
    if (saved.players === 1 || saved.players === 2) setup.players = saved.players;
    setup.online = saved.online === true;
    if (Array.isArray(saved.skins) && saved.skins.length === 2 && saved.skins.every((k) => SKINS.some((x) => x.id === k)) && saved.skins[0] !== saved.skins[1]) setup.skins = saved.skins;
    if (Array.isArray(saved.designs) && saved.designs.length === 2) setup.designs = saved.designs.map((d) => designOf(d).id);
    if (saved.map === 'practice' || MAPS[saved.map]) setup.map = saved.map;
  }
} catch (e) { /* no saved setup */ }
const hashMode = location.hash.slice(1);
if (hashMode === 'practice') { setup.players = 1; setup.map = 'practice'; setup.online = false; }
else if (hashMode === 'solo') { setup.players = 1; setup.online = false; }
else if (hashMode === 'duel' && !setup.online) setup.players = 2;
if (isTouch) setup.players = 1;   // no split screen on a touch device: 1 player or online
if (setup.players === 2 && setup.map === 'practice') setup.map = 'cave';

const PRACTICE_CARD = {
  name: 'Practice arena',
  desc: 'Empty space with a grid. Infinite ammo and a speed readout to learn the physics.',
  art: () => svgWrap('practice', `
    <rect width="180" height="110" fill="#120f2e"/>
    <path d="${Array.from({ length: 9 }, (_, i) => `M${i * 22 + 2} 0V110`).join('')}${Array.from({ length: 6 }, (_, i) => `M0 ${i * 22 + 0}H180`).join('')}" stroke="#2b2650" stroke-width="1"/>
    <rect x="3" y="3" width="174" height="104" rx="4" fill="none" stroke="#3a3466" stroke-width="6"/>
    <path d="M60 86 C 70 40, 110 30, 132 50" fill="none" stroke="${skinOf(setup.skins[0]).hex}" stroke-width="1.6" stroke-dasharray="3 4" opacity="0.7"/>
    <g transform="translate(60 86) rotate(20) scale(1.1)">${rocketSVG(skinOf(setup.skins[0]).hex, setup.designs[0]).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`),
};
const startMapList = () => (setup.online ? ONLINE_MAPS : (setup.players === 1 ? ['practice'] : []).concat(Object.keys(MAPS)));
// Keeps the chosen map one the current choice of players can play.
function fitMap() { if (!startMapList().includes(setup.map)) setup.map = MAPS[P.map] && startMapList().includes(P.map) ? P.map : 'cave'; }
fitMap();

function renderStart() {
  const joining = !!joinRoom, online = joining || setup.online;
  document.getElementById('startTitle').textContent = joining ? 'Join online game' : 'New game';
  document.getElementById('startJoin').hidden = !joining;
  document.getElementById('startPlayersRow').hidden = joining;
  document.getElementById('startMapRow').hidden = joining;
  document.getElementById('startGo').textContent = joining ? 'Join game' : setup.online ? 'Create online game' : 'Start game';
  startEl.querySelector('.start-hint').innerHTML = online ? `<kbd>Enter</kbd>${joining ? 'join' : 'create the game'}` : '<kbd>Enter</kbd>start <kbd>N</kbd>new game during play';
  // Players
  startEl.querySelectorAll('.seg-btn').forEach((b) => {
    const k = b.dataset.players, n = +k;
    b.setAttribute('aria-pressed', String(k === 'online' ? setup.online : !setup.online && setup.players === n));
    b.querySelector('.seg-ico').innerHTML = (n === 1 ? [0] : [0, 1]).map((i) => rocketSVG(skinOf(setup.skins[i]).hex, setup.designs[i])).join('');
  });
  // Skins
  const rows = document.getElementById('skinRows');
  rows.textContent = '';
  [0, 1].forEach((i) => {
    const row = document.createElement('div');
    row.className = 'skin-row';
    row.hidden = (online || setup.players === 1) && i === 1;
    const cur = skinOf(setup.skins[i]), other = setup.skins[1 - i];
    const who = online ? 'Your ship' : `Player ${i + 1}`;
    row.style.setProperty('--skin', cur.hex);
    const design = designOf(setup.designs[i]);
    row.innerHTML = `<span class="skin-preview">${rocketSVG(cur.hex, design.id)}</span><div><div class="skin-who">${who} <span>${design.name}, ${cur.name}</span></div><div class="designs" role="group" aria-label="${who} ship"></div><div class="swatches" role="group" aria-label="${who} colour"></div></div>`;
    const ds = row.querySelector('.designs');
    for (const d of DESIGNS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'design';
      b.setAttribute('aria-pressed', String(d.id === design.id));
      b.title = d.name;
      b.innerHTML = `${rocketSVG(cur.hex, d.id)}<span>${d.name}</span>`;
      b.addEventListener('click', () => {
        setup.designs[i] = d.id;
        renderStart();
        rows.querySelectorAll('.skin-row')[i].querySelector(`.design[aria-pressed="true"]`).focus();
      });
      ds.append(b);
    }
    const sw = row.querySelector('.swatches');
    for (const k of SKINS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--c', k.hex);
      b.setAttribute('aria-pressed', String(k.id === cur.id));
      const taken = !online && setup.players === 2 && k.id === other;
      if (taken) b.setAttribute('aria-disabled', 'true');
      b.title = taken ? `${k.name} (Player ${2 - i} has it)` : k.name;
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => {
        if (taken) return;
        // In 1 player and online games, Player 2 swaps over if it had this colour, so a later 2 player game
        // still has two colours (online, the second colour is the opponent's).
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
  setup.online = b.dataset.players === 'online';
  if (!setup.online) setup.players = +b.dataset.players;
  fitMap();
  renderStart();
  startEl.querySelector(`.seg-btn[data-players="${setup.players}"]`).focus();
}));

export function openStart() {
  if (!startEl.hidden || net.online) return;   // online, Leave game takes you back
  // An invite link: rejoin at once if this tab already has a seat there (a reload), else ask first.
  if (joinRoom && hasSeat(joinRoom)) { connect({ room: joinRoom, skins: setup.skins, designs: setup.designs }); gameStarted = true; return; }
  if (joinRoom) appEl.dataset.online = '';   // no local tuning or match controls behind it either
  closePicker();
  if (gameStarted) {
    // Start from what is being played now.
    setup.players = isSolo() ? 1 : 2;
    setup.online = false;
    setup.map = isPractice() ? 'practice' : (MAPS[level.builtMap] ? level.builtMap : setup.map);
  }
  renderStart();
  startEl.hidden = false;
  startEl.scrollTop = 0;
  appEl.inert = true;
  game.picking = true;
  keysDown.clear();
  document.getElementById('startGo').focus({ preventScroll: true });
}
function closeStart() {
  startEl.hidden = true;
  appEl.inert = false;
  game.picking = picker.open;
  keysDown.clear();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
function startGame() {
  applySkins(setup.skins, setup.designs);
  if (joinRoom || setup.online) {
    try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch (e) { /* saving is optional */ }
    closeStart();
    connect({ room: joinRoom, map: setup.map, skins: setup.skins, designs: setup.designs });
    gameStarted = true;
    return;
  }
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
