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
 * New game page, a page of its own over the whole window: the game behind it is inert and isn't drawn
 * (loop.js). Shown when the page opens and from the New game button (or N). Two screens
 * (docs/decisions/new-game-page.md):
 *   mode    three tiles: 1 player, 2 players, Online.
 *   setup   the pilots face off on two halves (ship design and colour each), then the map row and Launch.
 * Online starts a room on the server; an invite link (?room=abc123) opens straight on setup as
 * "Join online game", with no mode or map to choose.
 * ------------------------------------------------------------------ */
const SETUP_KEY = 'rocket-duel-setup-v1';
export const startEl = document.getElementById('startScreen');
export const setup = { players: 2, online: false, skins: ['sun', 'sky'], designs: ['arrow', 'arrow'], map: 'cave' };
const joinRoom = new URLSearchParams(location.search).get('room');
let gameStarted = false;
let step = 'mode';
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

const MODES = [
  { id: '1', name: '1 player', tag: 'Against the computer', desc: 'A computer pilot flies the other ship.' },
  { id: '2', name: '2 players', tag: 'Split screen', desc: 'Two pilots on one keyboard.' },
  { id: 'online', name: 'Online', tag: 'Play a friend', desc: 'Over the internet. You get a link to send.' },
];
const modeOf = () => (setup.online ? 'online' : String(setup.players));
const MAP_KIND = { practice: 'Practice', forest: 'Creatures', desert: 'Creatures', floors: 'Race', starship: 'Co-op', hangar: 'Co-op' };
const FRIEND = '#6b6496';   // the online friend's ship before they pick one

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
const mapDef = (k) => (k === 'practice' ? PRACTICE_CARD : MAPS[k]);
const startMapList = () => (setup.online ? ONLINE_MAPS : (setup.players === 1 ? ['practice'] : []).concat(Object.keys(MAPS)));
// Keeps the chosen map one the current choice of players can play.
function fitMap() { if (!startMapList().includes(setup.map)) setup.map = MAPS[P.map] && startMapList().includes(P.map) ? P.map : 'cave'; }
fitMap();

// The mode tiles always show the Arrow, the default design, in the players' colours.
const tileShip = (i) => rocketSVG(skinOf(setup.skins[i]).hex, 'arrow');
const $ = (id) => document.getElementById(id);

function tileArt(id) {
  if (id === '1') return `<span class="start-tile-ship">${tileShip(0)}</span><span class="start-tile-ship start-flip">${tileShip(1)}<em>CPU</em></span>`;
  if (id === '2') return `<span class="start-tile-ship">${tileShip(0)}</span><span class="start-tile-ship start-flip">${tileShip(1)}</span>`;
  return `<span class="start-tile-ship">${tileShip(0)}</span><span class="start-tile-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg></span><span class="start-tile-ship start-flip start-ghost">${rocketSVG(FRIEND, 'arrow')}</span>`;
}

function half(i) {
  const online = setup.online || !!joinRoom, solo = setup.players === 1;
  if (i === 1 && online) {
    const note = joinRoom ? 'Already in the game, waiting for you' : 'Picks a ship when they open your link';
    return `<div class="start-half start-half-2 start-half-empty"><p class="start-who">Your friend</p><p class="start-keys">${note}</p><span class="start-big start-ghost" aria-hidden="true"><span class="start-big-ship">${rocketSVG(FRIEND, 'arrow')}</span></span></div>`;
  }
  const who = online ? 'You' : solo ? (i ? 'Computer pilot' : 'You') : `Player ${i + 1}`;
  const keys = solo && i ? 'Flies itself' : online || solo ? 'WASD or the arrows' : i ? 'The arrows' : 'WASD';
  const cur = skinOf(setup.skins[i]), d = designOf(setup.designs[i]), other = setup.skins[1 - i];
  const swatches = SKINS.map((k) => {
    const taken = !online && setup.players === 2 && k.id === other;
    const title = taken ? `${k.name} (Player ${2 - i} has it)` : k.name;
    return `<button type="button" class="start-swatch" style="--s:${k.hex}" data-act="skin" data-i="${i}" data-v="${k.id}" data-key="s${i}-${k.id}" aria-pressed="${k.id === cur.id}"${taken ? ' aria-disabled="true"' : ''} aria-label="${title}" title="${title}"></button>`;
  }).join('');
  return `<div class="start-half start-half-${i + 1}" style="--half-c:${cur.hex}">
    <p class="start-who">${who}</p><p class="start-keys${solo && i ? '' : ' keys-only'}">${keys}</p>
    <span class="start-big" aria-hidden="true"><span class="start-big-ship">${rocketSVG(cur.hex, d.id)}</span></span>
    <div class="start-cycle" role="group" aria-label="${who} ship">
      <button type="button" class="start-arrow" data-act="cycle" data-i="${i}" data-v="-1" data-key="c${i}-" aria-label="Previous ship for ${who}">‹</button>
      <span class="start-design" aria-live="polite">${d.name}</span>
      <button type="button" class="start-arrow" data-act="cycle" data-i="${i}" data-v="1" data-key="c${i}+" aria-label="Next ship for ${who}">›</button>
    </div>
    <div class="start-swatches" role="group" aria-label="${who} colour">${swatches}</div>
  </div>`;
}

function renderStart() {
  const joining = !!joinRoom, online = joining || setup.online;
  if (joining) step = 'setup';
  $('startModeStep').hidden = step !== 'mode';
  $('startSetupStep').hidden = step !== 'setup';
  startEl.setAttribute('aria-labelledby', step === 'mode' ? 'startTitle' : 'startSetupTitle');
  startEl.style.setProperty('--p1', skinOf(setup.skins[0]).hex);
  $('startBackToGame').hidden = $('startBackToGame2').hidden = !gameStarted || joining;
  if (step === 'mode') {
    $('startTiles').innerHTML = MODES.map((m) => {
      const last = modeOf() === m.id;
      return `<button type="button" class="start-tile" data-act="mode" data-v="${m.id}" data-key="mode-${m.id}"${last ? ' aria-current="true"' : ''}>
        <span class="start-tile-art" aria-hidden="true">${tileArt(m.id)}</span>
        <span class="start-tile-name">${m.name}</span><span class="start-tile-tag">${m.tag}</span><span class="start-tile-desc">${m.desc}</span>
        ${last ? '<span class="start-tile-last">Last played</span>' : ''}</button>`;
    }).join('');
    return;
  }
  $('startSetupTitle').textContent = joining ? 'Join online game' : `Pick your ${online ? 'ship' : 'ships'} and a map`;
  $('startJoin').hidden = !joining;
  $('startBack').hidden = joining;
  $('startBackMode').textContent = MODES.find((m) => m.id === modeOf()).name;
  $('startHalves').innerHTML = `${half(0)}<span class="start-vs" aria-hidden="true">vs</span>${half(1)}`;
  $('startMapRow').hidden = joining;
  const def = mapDef(setup.map);
  $('startMapName').textContent = def.name;
  $('startMapKind').textContent = MAP_KIND[setup.map] || 'Duel';
  $('startMapDesc').textContent = def.desc || '';
  renderMaps();
  $('startGo').textContent = joining ? 'Join game' : setup.online ? 'Create online game' : 'Launch';
  $('startHint').innerHTML = joining ? '<kbd>Enter</kbd>join' : `<kbd>Enter</kbd>${setup.online ? 'create the game' : 'launch'} <kbd>Esc</kbd>back`;
}

function renderMaps() {
  $('startMaps').innerHTML = startMapList().map((k) => {
    const d = mapDef(k), art = k === 'practice' ? d.art() : MAP_ART[k] ? MAP_ART[k]() : '';
    return `<button type="button" class="start-map" data-act="map" data-v="${k}" data-key="m-${k}" aria-pressed="${setup.map === k}" title="${d.name}"><span class="start-map-art">${art}</span><span class="start-map-name">${d.name}</span></button>`;
  }).join('');
}

/* A ship or colour change updates the pilots' halves in place instead of rebuilding them, so they don't
 * move: the half's colour glow fades to the new colour (--half-c is a registered colour, see the CSS), and
 * on a design change (dir 1 next, -1 previous) the old ship slides out one way as the new one slides in
 * from the other. */
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const SLIDE = 120;   // px
function updateHalves(changed, dir) {
  [0, 1].forEach((i) => {
    const el = $('startHalves').querySelector(`.start-half-${i + 1}:not(.start-half-empty)`);
    if (!el) return;
    const cur = skinOf(setup.skins[i]), other = setup.skins[1 - i], online = setup.online || !!joinRoom;
    el.style.setProperty('--half-c', cur.hex);
    el.querySelector('.start-design').textContent = designOf(setup.designs[i]).name;
    el.querySelectorAll('.start-swatch').forEach((b) => {
      const k = skinOf(b.dataset.v), taken = !online && setup.players === 2 && k.id === other;
      const title = taken ? `${k.name} (Player ${2 - i} has it)` : k.name;
      b.setAttribute('aria-pressed', String(k.id === cur.id));
      if (taken) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      b.title = title;
      b.setAttribute('aria-label', title);
    });
    const big = el.querySelector('.start-big'), svg = rocketSVG(cur.hex, setup.designs[i]);
    const ship = [...big.querySelectorAll('.start-big-ship:not(.is-leaving)')].pop();
    if (i !== changed || !dir) { if (ship.innerHTML !== svg) ship.innerHTML = svg; return; }   // a recolour: no slide
    const next = document.createElement('span');
    next.className = 'start-big-ship';
    next.innerHTML = svg;
    ship.classList.add('is-leaving');
    big.append(next);
    const dx = reduceMotion.matches ? 0 : SLIDE * dir;
    ship.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-dx}px)` }],
      { duration: 220, easing: 'cubic-bezier(0.4, 0, 1, 1)' }).finished.then(() => ship.remove(), () => ship.remove());
    next.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'translateX(0)' }],
      { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  });
  startEl.style.setProperty('--p1', skinOf(setup.skins[0]).hex);
  if (startMapList().includes('practice')) {   // the Practice arena card draws Player 1's ship
    const strip = $('startMaps'), x = strip.scrollLeft;
    renderMaps();
    strip.scrollLeft = x;
  }
}

// Re-renders and puts focus back on the same control (they are rebuilt).
function rerender() {
  const key = startEl.contains(document.activeElement) && document.activeElement.dataset.key;
  renderStart();
  if (key) startEl.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}
let enterTimer;
// Shows a screen with its entrance, focused where Enter does the expected thing next.
function showStep(next) {
  step = next;
  renderStart();
  startEl.classList.remove('is-enter');
  void startEl.offsetWidth;   // restart the entrance animation
  startEl.classList.add('is-enter');
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => startEl.classList.remove('is-enter'), 700);   // later re-renders don't replay it
  startEl.scrollTop = 0;
  if (step === 'mode') startEl.querySelector('.start-tile[aria-current="true"]')?.focus({ preventScroll: true });
  else {
    const strip = $('startMaps'), on = strip.querySelector('[aria-pressed="true"]');
    const x = on ? on.offsetLeft - strip.offsetLeft : 0;   // only scroll when the chosen map is out of view
    strip.scrollLeft = on && x + on.offsetWidth > strip.clientWidth ? x - 8 : 0;
    $('startGo').focus({ preventScroll: true });
  }
}

startEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  const { act, v } = b.dataset, i = +b.dataset.i;
  if (act === 'mode') {
    setup.online = v === 'online';
    if (!setup.online) setup.players = +v;
    fitMap();
    showStep('setup');
    return;
  }
  if (act === 'cycle') {
    const n = DESIGNS.findIndex((d) => d.id === setup.designs[i]);
    setup.designs[i] = DESIGNS[(n + +v + DESIGNS.length) % DESIGNS.length].id;
    updateHalves(i, +v);
    return;
  } else if (act === 'skin') {
    // In 1 player and online games, Player 2 swaps over if it had this colour, so a later 2 player game
    // still has two colours (online, the second colour is the opponent's).
    if (setup.skins[1 - i] === v) setup.skins[1 - i] = setup.skins[i];
    setup.skins[i] = v;
    updateHalves(i, 0);
    return;
  } else if (act === 'map') setup.map = v;
  else return;
  rerender();
});
startEl.addEventListener('dblclick', (e) => { if (e.target.closest('[data-act="map"]')) startGame(); });

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
  startEl.hidden = false;
  appEl.inert = true;
  game.picking = true;
  keysDown.clear();
  showStep(joinRoom ? 'setup' : 'mode');
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
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch (e) { /* saving is optional */ }
  if (joinRoom || setup.online) {
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
  closeStart();
  if (game.paused) togglePause();
  setMode(mode, true);
  pane.refresh();
  gameStarted = true;
}
// Keys while the page is open: Esc goes back a screen (or to the game), Enter on the setup screen launches.
export function startKey(e) {
  if (e.code === 'Escape') {
    if (step === 'setup' && !joinRoom) { e.preventDefault(); showStep('mode'); }
    else if (gameStarted && !joinRoom) { e.preventDefault(); closeStart(); }
    return;
  }
  const onButton = e.target && e.target.closest && e.target.closest('button');
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !onButton && !e.repeat) {
    e.preventDefault();
    if (step === 'setup') startGame();
    else showStep('setup');
  }
}
$('startGo').addEventListener('click', startGame);
$('startBack').addEventListener('click', () => showStep('mode'));
$('startBackToGame').addEventListener('click', closeStart);
$('startBackToGame2').addEventListener('click', closeStart);
document.getElementById('btnNewGame').addEventListener('click', openStart);
