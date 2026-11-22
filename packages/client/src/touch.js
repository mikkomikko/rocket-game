import { P } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { clamp, wrapAngle } from '@rocket-duel/shared/math.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { net, switchWeapon } from './net/online.js';

/* ------------------------------------------------------------------ *
 * Touch controls, on phones and tablets only: a stick in the bottom right and two buttons in the bottom
 * left. The stick points where the ship should face and how far it is pushed sets the thrust. A touch
 * device plays one ship (1 player, practice or online): no split screen, no key legends (CSS: .touch).
 * ------------------------------------------------------------------ */
// ?touch forces them on (to try them with a mouse).
export const isTouch = new URLSearchParams(location.search).has('touch')
  || (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
if (isTouch) document.documentElement.classList.add('touch');

const DEAD = 0.18;   // the stick's centre, as a share of its reach, does nothing
export const touch = { active: false, dx: 0, dy: 0, dist: 0, fire: false };

if (isTouch) {
  const stage = document.getElementById('stage');
  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch { /* the finger still steers without it */ } };
  const box = document.createElement('div');
  box.className = 'touch-ui';
  box.innerHTML = `
    <div class="tc-buttons">
      <button class="tc-btn tc-fire" type="button" aria-label="Fire"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M16 3v7M16 22v7M3 16h7M22 16h7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="16" cy="16" r="2.6" fill="currentColor"/></svg></button>
      <button class="tc-btn tc-weapon" id="touchWeapon" type="button" aria-label="Change weapon"><span class="wico"></span></button>
    </div>
    <div class="tc-stick" role="presentation"><div class="tc-knob"></div></div>`;
  stage.append(box);

  const stick = box.querySelector('.tc-stick'), knob = box.querySelector('.tc-knob');
  let stickId = null;
  const moveStick = (e) => {
    const r = stick.getBoundingClientRect(), reach = r.width / 2;
    let dx = (e.clientX - (r.left + reach)) / reach, dy = (e.clientY - (r.top + reach)) / reach;
    const d = Math.hypot(dx, dy);
    if (d > 1) { dx /= d; dy /= d; }
    touch.dx = dx; touch.dy = dy; touch.dist = Math.min(1, d);
    // The knob stays inside the base: it travels as far as the base's radius less its own.
    const travel = reach - knob.offsetWidth / 2;
    knob.style.transform = `translate(${dx * travel}px, ${dy * travel}px)`;
  };
  const releaseStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    touch.active = false; touch.dist = 0;
    knob.style.transform = '';
    stick.classList.remove('on');
  };
  stick.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    capture(stick, e);
    touch.active = true;
    stick.classList.add('on');
    moveStick(e);
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  stick.addEventListener('pointerup', releaseStick);
  stick.addEventListener('pointercancel', releaseStick);
  stick.addEventListener('lostpointercapture', releaseStick);

  // Fire: held. Weapon: once per press. Each button follows its own finger, so both work with the stick.
  const fireBtn = box.querySelector('.tc-fire');
  const fireOff = () => { touch.fire = false; fireBtn.classList.remove('on'); };
  fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(fireBtn, e); touch.fire = true; fireBtn.classList.add('on'); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) fireBtn.addEventListener(t, fireOff);
  const weaponBtn = box.querySelector('.tc-weapon');
  weaponBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    weaponBtn.classList.add('on');
    if (!game.paused) switchWeapon(ships[0]);   // online it switches your own ship whichever seat you have
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) weaponBtn.addEventListener(t, () => weaponBtn.classList.remove('on'));
  // No long-press menus or text selection on the controls.
  box.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => { fireOff(); touch.active = false; touch.dist = 0; knob.style.transform = ''; stick.classList.remove('on'); stickId = null; });
}

// Turns the stick into the ship's input: turn toward the stick's direction, braking in time so the nose
// stops on it instead of swinging past, and thrust by how far the stick is pushed beyond its centre.
export function readTouch(inp) {
  if (!isTouch) return;
  inp.fire = inp.fire || touch.fire;
  if (!touch.active || touch.dist < DEAD) return;
  const s = ships[net.online ? net.id : 0];
  // Screen y points down, the world's up; a ship at angle a points along (-sin a, cos a).
  const target = Math.atan2(-touch.dx, -touch.dy);
  const err = wrapAngle(target - s.a);
  const want = Math.sign(err) * Math.min(P.rotSpeed, Math.sqrt(2 * P.rotAccel * Math.abs(err)) * 0.85);
  inp.turn = clamp(want / P.rotSpeed, -1, 1);
  inp.thrust = Math.max(inp.thrust, (touch.dist - DEAD) / (1 - DEAD));
}
