import * as THREE from 'three';
import { isPractice, isSolo, P, P1HEX, P2HEX } from '../config.js';
import { game } from '../state.js';
import { approach, clamp } from '../util/math.js';
import { H, level, W } from '../level/mask.js';
import { glowMat, renderer, scene, skyMesh, stage } from './scene.js';
import { shapeGeo, ships } from '../ships/ship.js';
import { ENEMY_RED } from '../maps/starship/constants.js';
import { activeMap } from '../maps/index.js';

/* ------------------------------------------------------------------ *
 * Cameras, split screen and the loop
 * ------------------------------------------------------------------ */
export const cams = [0, 1].map(() => new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10));
// Layer 1 is seen only by Player 1's camera and layer 2 only by Player 2's (used for the opponent pointers).
cams.forEach((c, i) => c.layers.enable(i + 1));
export let viewW = 1, viewH = 1;
new ResizeObserver(() => {
  viewW = Math.max(1, stage.clientWidth);
  viewH = Math.max(1, stage.clientHeight);
  renderer.setSize(viewW, viewH, false);
}).observe(stage);

export function viewRects() {
  if (isSolo()) return [{ x: 0, y: 0, w: viewW, h: viewH }];
  if (P.split === 'stacked') {
    const top = Math.floor(viewH / 2);
    return [{ x: 0, y: viewH - top, w: viewW, h: top }, { x: 0, y: 0, w: viewW, h: viewH - top }];
  }
  const left = Math.floor(viewW / 2);
  return [{ x: 0, y: 0, w: left, h: viewH }, { x: left, y: 0, w: viewW - left, h: viewH }];
}

// Clear space only: an arrow in each player's view that points at the opponent.
// Off screen it sits on the edge of the view; on screen it hovers over the opponent, pointing down.
const pointerGeo = shapeGeo([[0, 9], [8, -6], [0, -2.5], [-8, -6]]);
export const pointers = [0, 1].map((i) => {
  const hex = i === 0 ? P2HEX : P1HEX;   // Player 1 sees Player 2's colour, and the other way round
  const g = new THREE.Group();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), glowMat(new THREE.Color(hex), 0.35));
  const arrow = new THREE.Mesh(pointerGeo, new THREE.MeshBasicMaterial({ color: hex, transparent: true, side: THREE.DoubleSide }));
  arrow.position.z = 0.01;
  g.add(glow, arrow);
  g.visible = false;
  g.traverse((o) => o.layers.set(i + 1));
  scene.add(g);
  return { g, arrow, glow };
});
function updatePointer(i, cx, cy, hw, hh, a) {
  const { g, arrow } = pointers[i], me = ships[i], o = ships[1 - i];
  const on = level.builtMap === 'clear' && !isPractice() && me.active && o.active && o.alive;
  g.visible = on;
  if (!on) return;
  const ox = o.px + (o.x - o.px) * a, oy = o.py + (o.y - o.py) * a;
  const k = 1 / P.zoom, m = 26 * k;
  const dx = ox - cx, dy = oy - cy;
  g.scale.setScalar(k * 1.3);
  if (Math.abs(dx) < hw - m && Math.abs(dy) < hh - m) {
    g.position.set(ox, oy + 22 * P.shipSize + 16 * k, 3);
    g.rotation.z = Math.PI;
  } else {
    const t = Math.min((hw - m) / Math.max(Math.abs(dx), 1e-6), (hh - m) / Math.max(Math.abs(dy), 1e-6));
    g.position.set(cx + dx * t, cy + dy * t, 3);
    g.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
  }
  arrow.material.opacity = 0.75 + 0.25 * Math.sin(game.time * 6);
}

// Starship only: red arrows on the edge of each player's view, pointing at every red robot that is off screen.
const enemyArrows = [0, 1].map((i) => Array.from({ length: 14 }, () => {
  const g = new THREE.Group();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), glowMat(ENEMY_RED, 0.4));
  const arrow = new THREE.Mesh(pointerGeo, new THREE.MeshBasicMaterial({ color: '#ff4d5e', side: THREE.DoubleSide }));
  arrow.position.z = 0.01;
  g.add(glow, arrow);
  g.visible = false;
  g.traverse((o) => o.layers.set(i + 1));
  scene.add(g);
  return g;
}));
function updateEnemyArrows(i, cx, cy, hw, hh) {
  const list = enemyArrows[i];
  let n = 0;
  const enemies = ships[i].active && activeMap().enemies?.();
  if (enemies) {
    const k = 1 / P.zoom, m = 22 * k;
    for (const e of enemies) {
      if (e.dead || n >= list.length) continue;
      const dx = e.x - cx, dy = e.y - cy;
      if (Math.abs(dx) < hw && Math.abs(dy) < hh) continue;   // already on screen
      const t = Math.min((hw - m) / Math.max(Math.abs(dx), 1e-6), (hh - m) / Math.max(Math.abs(dy), 1e-6));
      const g = list[n++];
      g.visible = true;
      g.position.set(cx + dx * t, cy + dy * t, 3.1);
      g.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
      g.scale.setScalar(k * (e.kind === 'boss' ? 1.9 : e.kind === 'jugg' ? 1.4 : 1));
    }
  }
  for (; n < list.length; n++) list[n].visible = false;
}

let camZ = 1;   // extra zoom while a map's camera focus is on
export function updateCamera(i, rect, dt, alpha) {
  const s = ships[i], cam = cams[i], c = s.cam;
  let tx, ty;
  if (s.alive) {
    tx = s.px + (s.x - s.px) * alpha + s.vx * P.lookahead;
    ty = s.py + (s.y - s.py) * alpha + s.vy * P.lookahead;
  } else { tx = s.deathX; ty = s.deathY; }
  const focus = activeMap().cameraFocus?.();
  if (focus) [tx, ty] = focus;
  camZ = approach(camZ, focus ? 0.78 : 1, dt * 0.6);
  const k = P.cameraLag > 0.001 ? 1 - Math.exp(-dt / (focus ? Math.max(P.cameraLag, 0.35) : P.cameraLag)) : 1;
  c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
  const zz = P.zoom * camZ;
  const hw = rect.w / zz / 2, hh = rect.h / zz / 2;
  const cx = hw * 2 >= W ? W / 2 : clamp(c.x, hw, W - hw);
  const cy = hh * 2 >= H ? H / 2 : clamp(c.y, hh, H - hh);
  c.x = cx; c.y = cy;
  skyMesh.position.set(W / 2 + (cx - W / 2) * 0.55, H / 2 + (cy - H / 2) * 0.55, -1);
  let sx = 0, sy = 0;
  if (c.shake > 0.05) {
    sx = (Math.random() - 0.5) * 2 * c.shake;
    sy = (Math.random() - 0.5) * 2 * c.shake;
    c.shake *= Math.exp(-dt * 9);
  } else c.shake = 0;
  cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
  cam.position.set(cx + sx, cy + sy, 5);
  cam.updateProjectionMatrix();
  updatePointer(i, cx, cy, hw, hh, alpha);
  updateEnemyArrows(i, cx, cy, hw, hh);
}
