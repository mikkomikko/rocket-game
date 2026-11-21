import { reducedMotion } from './config.js';
import { isPractice, P, PR } from '@rocket-duel/shared/config.js';
import { mon } from './state.js';
import { game } from '@rocket-duel/shared/state.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { gridMesh, renderer, scene, skyMat, uploadField } from './render/scene.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { shipMass } from '@rocket-duel/shared/ships/physics.js';
import { pointScale } from './fx/pools.js';
import { stepTerrainBits } from './fx/debris.js';
import { stepParticles } from './fx/particles.js';
import { stepSmoke } from './fx/smoke.js';
import { drawBoxes } from './systems/boxes.js';
import { drawBigLasers } from './render/bigLaser.js';
import { drawMissileSights } from './render/missileSight.js';
import { keysDown, padsSeen, prettyKey, readInputs } from './input.js';
import { cams, updateCamera, viewRects } from './render/camera.js';
import { drawDebug, drawPools } from './render/draw.js';
import { updateHud } from './ui/hud.js';
import { sfx } from './audio/sfx.js';
import { updateWeaponBoxes } from './ui/weaponBox.js';
import { activeMap, allMaps } from './maps/index.js';
import { stepEffects } from './fx/effects.js';
import { views } from './ships/view.js';
import { stepSim } from '@rocket-duel/shared/sim.js';
import { drawPos, easeCorrections, net, netStep, readOnlineInput, sendInputs, snapAlpha } from './net/online.js';

// The fixed-step simulation (step) and the render loop (frame).
function step(h) {
  if (net.online) netStep(h); else stepSim(h);
  stepEffects(h);
  stepParticles(h);
  stepTerrainBits(h);
  stepSmoke(h);
  activeMap().step?.(h);
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
  if (net.online) readOnlineInput();
  const h = 1 / P.physicsHz;
  if (!game.paused && !game.picking) {
    acc += dt * P.timeScale;
    let n = 0;
    while (acc >= h && n < 40) { step(h); acc -= h; n++; }
    if (n >= 40) acc = 0;
  }
  if (net.online) sendInputs();
  easeCorrections(dt);
  const alpha = clamp(acc / h, 0, 1);

  uploadField();
  for (const s of ships) {
    const v = views[s.id], p = drawPos(s, alpha);
    if (!s.alive) { v.group.visible = false; v.flame.visible = false; drawDebug(s, p.k); continue; }
    v.group.visible = true;
    v.group.position.set(p.x, p.y, 1);
    v.group.rotation.z = p.a;
    v.group.scale.setScalar(P.shipSize);
    v.shield.visible = s.invulnT > 0;
    if (v.shield.visible) v.shield.material.opacity = (0.45 + 0.25 * Math.sin(game.time * 9)) * Math.min(1, s.invulnT / 0.4);
    v.aura.material.opacity = 0.16 + 0.18 * s.thrust + (s.minigunT > 0 ? 0.15 + 0.1 * Math.sin(game.time * 12) : 0);
    v.flame.visible = s.thrust > 0.02;
    v.flame.scale.set(0.85 + 0.15 * s.thrust, s.thrust * (0.8 + Math.random() * 0.4), 1);
    // No crosshair by default: only while a crosshair box is running (it blinks in the last 3 s).
    v.aim.visible = s.active && s.crossT > 0 && (s.crossT > 3 || Math.sin(game.time * 16) > -0.3);
    v.ice.visible = s.frozenT > 0;
    if (v.ice.visible) {
      const fade = Math.min(1, s.frozenT / 0.6);   // thaws over the last moment
      const blink = s.frozenT < 1.2 ? 0.75 + 0.25 * Math.sin(game.time * 22) : 1;
      v.ice.userData.shell.material.opacity = 0.55 * fade * blink;
      v.ice.userData.ring.material.opacity = 0.6 * fade;
      v.ice.userData.ring.rotation.z = game.time * 0.6 - v.group.rotation.z;
    }
    drawDebug(s, p.k);
  }
  for (const m of allMaps()) m.draw?.(now, net.online ? snapAlpha() : alpha);   // online, the map runs on the server
  drawBoxes(now);
  drawBigLasers(now);
  drawMissileSights(alpha);
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
