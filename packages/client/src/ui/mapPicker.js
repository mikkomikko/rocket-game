import { isPractice, P, SKIN } from '../config.js';
import { game } from '../state.js';
import { hexRGB } from '../util/math.js';
import { H, level, rowColor, W } from '../level/mask.js';
import { MAPS } from '../level/terrain.js';
import { generateLevel } from '../level/generate.js';
import { keysDown } from '../input.js';
import { rebuildCave } from '../game/modes.js';
import { MAP_ART } from './mapArt.js';
import { pane } from './tuningPanel.js';

/* Player 1's map picker: the Map button or Q opens it over Player 1's view and pauses the game. */
export const picker = { el: document.getElementById('picker'), grid: document.getElementById('mapGrid'), open: false, sel: 0, cards: [], thumbs: new Map(), job: 0 };
export function updateMapButton() {
  const keys = Object.keys(MAPS), cur = MAPS[level.builtMap] ? level.builtMap : 'cave';
  const next = MAPS[keys[(keys.indexOf(cur) + 1) % keys.length]].name;
  const btn = document.getElementById('btnMaps');
  btn.innerHTML = `Map: ${MAPS[cur].name} <kbd>Q</kbd>`;
  btn.title = `Next: ${next}`;
  btn.setAttribute('aria-label', `Map: ${MAPS[cur].name}. Press to switch to ${next}.`);
}
// Each press of the Map button (or Q) goes to the next map in the list.
let toastTimer = 0;
export function nextMap() {
  if (isPractice()) return;
  const keys = Object.keys(MAPS);
  P.map = keys[(keys.indexOf(level.builtMap) + 1) % keys.length];
  rebuildCave();
  pane.refresh();
  const el = document.getElementById('mapToast');
  el.querySelector('.toast-name').textContent = MAPS[P.map].name;
  el.querySelector('.toast-desc').textContent = MAPS[P.map].desc;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
}
const thumbKey = (k) => [k, SKIN[0], SKIN[1], P.seed, P.rockAmount, P.noiseScale, P.tunnelRadius].join('|');
// Build a map into the mask, copy a small picture of it, then put the real level back untouched.
function drawThumb(canvas, k) {
  const key = thumbKey(k);
  let img = picker.thumbs.get(key);
  if (!img) {
    const keepMask = level.mask.slice(), keepSpawns = level.spawns, keepMap = P.map, keepBuilt = level.builtMap;
    P.map = k;
    generateLevel(false);
    const tw = canvas.width, th = canvas.height, sx = W / tw, sy = H / th;
    const p1 = hexRGB(SKIN[0]), p2 = hexRGB(SKIN[1]);
    img = new ImageData(tw, th);
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        const r = Math.floor((j + 0.5) * sy), c = Math.floor((i + 0.5) * sx);
        const v = level.mask[r * W + c];
        const col = v === 0 ? (MAPS[k].thumbSky || [14, 10, 34]) : v === 2 ? [30, 24, 54] : v === 3 ? (c < W / 2 ? p1 : p2) : (MAPS[k].thumbRock || rowColor[r]);
        const o = (j * tw + i) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    level.mask.set(keepMask); level.spawns = keepSpawns; P.map = keepMap; level.builtMap = keepBuilt;
    picker.thumbs.set(key, img);
  }
  canvas.getContext('2d').putImageData(img, 0, 0);
}

function renderPicker() {
  picker.grid.textContent = '';
  picker.cards = Object.keys(MAPS).map((k, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-card';
    if (k === level.builtMap) b.setAttribute('aria-current', 'true');
    // A drawn picture when the map has one, otherwise a small preview of its layout.
    let cv = null, pic;
    if (MAP_ART[k]) {
      pic = document.createElement('span');
      pic.className = 'map-art';
      pic.innerHTML = MAP_ART[k]();
    } else {
      pic = cv = document.createElement('canvas');
      cv.width = 180; cv.height = 110;
      cv.setAttribute('aria-hidden', 'true');
    }
    const name = document.createElement('span');
    name.className = 'name'; name.textContent = MAPS[k].name;
    const desc = document.createElement('span');
    desc.className = 'desc'; desc.textContent = MAPS[k].desc || '';
    b.append(pic, name, desc);
    b.addEventListener('click', () => chooseMap(k));
    b.addEventListener('mouseenter', () => selectCard(idx, false));
    picker.grid.append(b);
    return { b, cv, k };
  });
  document.getElementById('pickerSeed').textContent = `Seed ${P.seed}`;
  // Draw the previews one at a time so the picker opens at once.
  const job = ++picker.job;
  let i = 0;
  const next = () => {
    if (job !== picker.job || !picker.open || i >= picker.cards.length) return;
    if (picker.cards[i].cv) drawThumb(picker.cards[i].cv, picker.cards[i].k);
    i++;
    setTimeout(next, 0);
  };
  setTimeout(next, 30);
}
function selectCard(i, focus = true) {
  const n = picker.cards.length;
  if (!n) return;
  picker.sel = ((i % n) + n) % n;
  picker.cards.forEach((c, k) => c.b.classList.toggle('selected', k === picker.sel));
  if (focus) picker.cards[picker.sel].b.focus();
}
function openPicker() {
  if (picker.open || isPractice()) return;
  picker.open = true;
  game.picking = true;
  keysDown.clear();
  picker.el.hidden = false;
  renderPicker();
  selectCard(Math.max(0, Object.keys(MAPS).indexOf(level.builtMap)));
}
export function closePicker() {
  if (!picker.open) return;
  picker.open = false;
  game.picking = false;
  picker.job++;
  picker.el.hidden = true;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
function chooseMap(k) {
  P.map = k;
  rebuildCave();
  pane.refresh();
  closePicker();
}
const pickerCols = () => Math.max(1, getComputedStyle(picker.grid).gridTemplateColumns.split(' ').length);
export function pickerKey(e) {
  const c = e.code;
  if ((c === 'Space' || c === 'Enter') && e.target.closest && e.target.closest('.pbtn')) return;
  const cols = pickerCols();
  const moves = { KeyA: -1, ArrowLeft: -1, KeyD: 1, ArrowRight: 1, KeyW: -cols, ArrowUp: -cols, KeyS: cols, ArrowDown: cols };
  if (c in moves) { e.preventDefault(); selectCard(picker.sel + moves[c]); }
  else if (c === 'Space' || c === 'Enter' || c === 'NumpadEnter') { e.preventDefault(); if (!e.repeat) chooseMap(picker.cards[picker.sel].k); }
  else if (c === 'Escape' || c === 'KeyQ') { e.preventDefault(); closePicker(); }
}
// The Map button flips between Clear space and the first map, the Cave. Q still opens the full picker.
document.getElementById('btnMaps').addEventListener('click', nextMap);
document.getElementById('btnMapList').addEventListener('click', openPicker);
document.getElementById('pickerClose').addEventListener('click', closePicker);
document.getElementById('pickerShuffle').addEventListener('click', () => {
  P.seed = Math.floor(Math.random() * 99999);
  pane.refresh();
  renderPicker();
  selectCard(picker.sel);
});
