import { reducedMotion } from './config.js';
import { BALL_IDX, isPractice, P, PR, WEAPONS } from '@rocket-duel/shared/config.js';
import { mon } from './state.js';
import { game } from '@rocket-duel/shared/state.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { gridMesh, renderer, scene, skyMat } from './render/scene.js';
import { ships } from './ships/ship.js';
import { shipMass, shipVsShip, updateShip } from './ships/physics.js';
import { pointScale } from './fx/pools.js';
import { stepBullets } from './fx/bullets.js';
import { stepTerrainBits } from './fx/debris.js';
import { stepParticles } from './fx/particles.js';
import { stepSmoke } from './fx/smoke.js';
import { drawBoxes, stepBoxes } from './systems/boxes.js';
import { drawBigLasers } from './ships/bigLaser.js';
import { keysDown, padsSeen, prettyKey, readInputs } from './input.js';
import { cams, updateCamera, viewRects } from './render/camera.js';
import { drawDebug, drawPools } from './render/draw.js';
import { updateHud } from './ui/hud.js';
import { sfx } from './audio/sfx.js';
import { updateWeaponBoxes } from './ui/weaponBox.js';
import { activeMap, allMaps } from './maps/index.js';
import { field } from './render/field.js';

// The fixed-step simulation (step) and the render loop (frame).
function step(h) {
  game.time += h;
  game.matchClock += h;
  for (const s of ships) { s.px = s.x; s.py = s.y; s.pa = s.a; }
  for (const s of ships) if (s.active) updateShip(s, h);
  shipVsShip();
  stepBullets(h);
  stepParticles(h);
  stepTerrainBits(h);
  stepSmoke(h);
  activeMap().step?.(h);
  stepBoxes(h);
}

/* Game state and loop */

let last = performance.now(), acc = 0, fpsAcc = 0, fpsFrames = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  fpsAcc += dt; fpsFrames++;
  sfx.frame();
  if (fpsAcc > 0.5) { mon.fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }

  readInputs();
  const h = 1 / P.physicsHz;
  if (!game.paused && !game.picking) {
    acc += dt * P.timeScale;
    let n = 0;
    while (acc >= h && n < 40) { step(h); acc -= h; n++; }
    if (n >= 40) acc = 0;
  }
  const alpha = clamp(acc / h, 0, 1);

  if (field.dirty) { field.tex.needsUpdate = true; field.dirty = false; }
  for (const s of ships) {
    if (!s.alive) { s.group.visible = false; s.flame.visible = false; drawDebug(s, alpha); continue; }
    s.group.visible = true;
    s.group.position.set(s.px + (s.x - s.px) * alpha, s.py + (s.y - s.py) * alpha, 1);
    s.group.rotation.z = s.pa + (s.a - s.pa) * alpha;
    s.group.scale.setScalar(P.shipSize);
    s.shield.visible = s.invulnT > 0;
    if (s.shield.visible) s.shield.material.opacity = (0.45 + 0.25 * Math.sin(game.time * 9)) * Math.min(1, s.invulnT / 0.4);
    s.aura.material.opacity = 0.16 + 0.18 * s.thrust + (s.minigunT > 0 ? 0.15 + 0.1 * Math.sin(game.time * 12) : 0);
    s.flame.visible = s.thrust > 0.02;
    s.flame.scale.set(0.85 + 0.15 * s.thrust, s.thrust * (0.8 + Math.random() * 0.4), 1);
    // No crosshair by default: only while a crosshair box is running (it blinks in the last 3 s).
    s.aim.visible = s.active && s.crossT > 0 && (s.crossT > 3 || Math.sin(game.time * 16) > -0.3);
    s.ice.visible = s.frozenT > 0;
    if (s.ice.visible) {
      const fade = Math.min(1, s.frozenT / 0.6);   // thaws over the last moment
      const blink = s.frozenT < 1.2 ? 0.75 + 0.25 * Math.sin(game.time * 22) : 1;
      s.ice.userData.shell.material.opacity = 0.55 * fade * blink;
      s.ice.userData.ring.material.opacity = 0.6 * fade;
      s.ice.userData.ring.rotation.z = game.time * 0.6 - s.group.rotation.z;
    }
    s.ball.visible = s.ballT > 0;
    if (s.ball.visible) {
      const u = s.ball.userData, age = WEAPONS[BALL_IDX].ball - s.ballT;
      const fade = Math.min(1, s.ballT / 0.4);   // pops at the end
      const blink = s.ballT < 1.2 ? 0.7 + 0.3 * Math.sin(game.time * 22) : 1;
      u.mats.forEach((m, k) => { m.opacity = u.base[k] * fade * blink; });
      s.ball.scale.setScalar(Math.min(1, 0.4 + age * 5) * (1 + 0.04 * Math.sin(game.time * 9)));
      u.shine.rotation.z = -s.group.rotation.z;   // the highlight stays put while the ball spins
    }
    drawDebug(s, alpha);
  }
  for (const m of allMaps()) m.draw?.(now, alpha);
  drawBoxes(now);
  drawBigLasers(now);
  gridMesh.visible = isPractice() && PR.grid;
  pointScale.value = P.zoom * renderer.getPixelRatio();
  skyMat.uniforms.uTime.value = reducedMotion ? 0 : now / 1000;
  drawPools();

  const rects = viewRects();
  renderer.setScissorTest(true);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    renderer.setViewport(r.x, r.y, r.w, r.h);
    renderer.setScissor(r.x, r.y, r.w, r.h);
    updateCamera(i, r, dt, alpha);
    renderer.render(scene, cams[i]);
  }

  updateWeaponBoxes(rects);
  updateHud();
  const s0 = ships[0];
  mon.p1Speed = Math.hypot(s0.vx, s0.vy);
  mon.p1Mass = shipMass(s0);
  mon.keys = keysDown.size ? `${keysDown.size} held: ${[...keysDown].map(prettyKey).join('  ')}` : 'None';
  mon.pads = padsSeen.length ? padsSeen.join('\n') : 'None connected. Press a button on the pad.';
}
export function startLoop() { requestAnimationFrame((t) => { last = t; frame(t); }); }
