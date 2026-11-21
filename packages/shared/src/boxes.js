import { isPractice, MISSILES, P, PR } from './config.js';
import { H, level, solidAt, W } from './level/mask.js';
import { simEvent } from './events.js';
import { mapRules } from './maps.js';
import { random } from './random.js';
import { ships } from './ships/ship.js';

/* ------------------------------------------------------------------ *
 * Floating supply boxes on every map: ammo (and the missiles back), and health (+50).
 * They hang in open air that both players can reach and come back at a new spot a while after they
 * are taken. If a player runs dry, or every ammo box is gone, new ammo boxes appear right away.
 * State only; the client draws them (systems/boxes.js) and hears:
 *   boxesReset()                    a new set of boxes (a new map or match)
 *   boxPlaced(i, sparkle)           box i appeared at a new spot (sparkle: it popped in during play)
 *   boxTaken(s, kind, x, y)         ship s took a box of that kind at (x, y)
 * ------------------------------------------------------------------ */
export const HEALTH_GAIN = 50;
export const BOX_KINDS = { ammo: { n: 3, back: 12 }, health: { n: 2, back: 20 } };
export const KIND_IDS = Object.keys(BOX_KINDS);
export const boxes = [];   // { kind, x, y, on, t }: t counts down to the box's return while it is off
let spots = [];

// Open-air spots: points with clear space all round that a ship can fly to from a spawn.
function findBoxSpots() {
  const C = 8, gw = Math.ceil(W / C), gh = Math.ceil(H / C);
  const free = new Uint8Array(gw * gh), seen = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = i * C + C / 2, y = j * C + C / 2;
    free[j * gw + i] = (!solidAt(x, y) && !solidAt(x - 9, y) && !solidAt(x + 9, y) && !solidAt(x, y - 9) && !solidAt(x, y + 9)) ? 1 : 0;
  }
  // Flood from each spawn, so boxes never sit in sealed-off pockets.
  const q = [];
  for (const sp of level.spawns) {
    for (const dy of [20, 34, 50]) {
      const i = Math.floor(sp.x / C), j = Math.floor((sp.y + dy) / C);
      if (i >= 0 && j >= 0 && i < gw && j < gh && free[j * gw + i] && !seen[j * gw + i]) { seen[j * gw + i] = 1; q.push(j * gw + i); break; }
    }
  }
  for (let k = 0; k < q.length; k++) {
    const c = q[k], i = c % gw, j = (c / gw) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
      const n = nj * gw + ni;
      if (free[n] && !seen[n]) { seen[n] = 1; q.push(n); }
    }
  }
  // Floors: the orange blocks seal each hallway until they are shot, so the whole hallway counts.
  if (mapRules().sealedHalls) seen.set(free);
  const clear = (x, y, R) => {
    for (const r of [R * 0.35, R * 0.7, R]) for (let a = 0; a < 12; a++) {
      if (solidAt(x + Math.cos(a * Math.PI / 6) * r, y + Math.sin(a * Math.PI / 6) * r)) return false;
    }
    return !solidAt(x, y);
  };
  const farFromSpawns = (x, y) => level.spawns.every((sp) => Math.hypot(x - sp.x, y - sp.y) > 140);
  for (const R of [52, 38, 26]) {
    const out = [];
    for (let j = 1; j < gh - 1; j += 2) for (let i = 1; i < gw - 1; i += 2) {
      if (!seen[j * gw + i]) continue;
      const x = i * C + C / 2, y = j * C + C / 2;
      if (farFromSpawns(x, y) && clear(x, y, R)) out.push([x, y]);
    }
    if (out.length >= 30 || R === 26) return out;
  }
  return [];
}
function pickBoxSpot(near) {
  const taken = boxes.filter((b) => b.on || b.placing);
  let ok = spots.filter(([x, y]) =>
    taken.every((b) => Math.hypot(b.x - x, b.y - y) > 130) &&
    ships.every((s) => !s.active || !s.alive || Math.hypot(s.x - x, s.y - y) > 90));
  if (!ok.length) ok = spots;
  if (!ok.length) return null;
  if (near) {   // someone ran dry: drop it in their part of the map
    ok = ok.slice().sort((a, b) => Math.hypot(a[0] - near.x, a[1] - near.y) - Math.hypot(b[0] - near.x, b[1] - near.y));
    ok = ok.slice(0, Math.max(1, Math.ceil(ok.length * 0.2)));
  }
  return ok[Math.floor(random() * ok.length)];
}
function placeBox(i, near, sparkle) {
  const b = boxes[i];
  b.placing = true;
  const p = pickBoxSpot(near);
  b.placing = false;
  if (!p) { b.on = false; b.t = 5; return; }
  b.x = p[0]; b.y = p[1]; b.on = true; b.t = 0;
  simEvent('boxPlaced', i, sparkle);
}
export function resetBoxes() {
  boxes.length = 0;
  spots = findBoxSpots();
  const scale = Math.max(1, Math.round((W * H) / (1800 * 1100)));
  for (const kind of KIND_IDS) {
    for (let i = 0; i < BOX_KINDS[kind].n * scale; i++) boxes.push({ kind, x: 0, y: 0, on: false, t: 0 });
  }
  simEvent('boxesReset');
  for (let i = 0; i < boxes.length; i++) placeBox(i, null, false);
}
export function stepBoxes(h) {
  boxes.forEach((b, i) => {
    if (!b.on) { b.t -= h; if (b.t <= 0) placeBox(i, null, true); return; }
    for (const s of ships) {
      if (!s.active || !s.alive) continue;
      if (Math.hypot(s.x - b.x, s.y - b.y) > 24 * Math.max(1, P.shipSize)) continue;
      if (b.kind === 'ammo') {
        if (s.ammo >= P.ammoMax - 0.5 && s.missiles >= MISSILES) continue;
        s.ammo = P.ammoMax;
        s.missiles = MISSILES;
      } else {
        if (s.hp >= 99.5) continue;
        s.hp = Math.min(100, s.hp + HEALTH_GAIN);
      }
      b.on = false; b.t = BOX_KINDS[b.kind].back;
      simEvent('boxTaken', s, b.kind, b.x, b.y);
      break;
    }
  });
  // Never leave the map without ammo: if every ammo box is gone, or a player has run dry, bring new ones in now.
  const ammo = boxes.map((b, i) => i).filter((i) => boxes[i].kind === 'ammo');
  if (!ammo.length) return;
  const dry = ships.find((s) => s.active && s.alive && s.ammo < 1 && !(s.minigunT > 0) && !(isPractice() && PR.infiniteAmmo));
  const noneLeft = ammo.every((i) => !boxes[i].on);
  if (dry || noneLeft) {
    for (const i of ammo) if (!boxes[i].on) placeBox(i, dry || null, true);
  }
}

// Online: the boxes as flat rows of kind (index into KIND_IDS), on, x, y.
export function encodeBoxes() { return boxes.flatMap((b) => [KIND_IDS.indexOf(b.kind), b.on ? 1 : 0, Math.round(b.x), Math.round(b.y)]); }
export function applyBoxes(rows) {
  const n = rows.length / 4;
  if (n !== boxes.length) { boxes.length = 0; for (let i = 0; i < n; i++) boxes.push({ kind: 'ammo', x: 0, y: 0, on: false, t: 0 }); simEvent('boxesReset'); }
  boxes.forEach((b, i) => { b.kind = KIND_IDS[rows[i * 4]]; b.on = !!rows[i * 4 + 1]; b.x = rows[i * 4 + 2]; b.y = rows[i * 4 + 3]; });
}
