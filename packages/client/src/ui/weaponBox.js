import { isSolo, P, reducedMotion, WEAPONS } from '../config.js';
import { clamp } from '../util/math.js';
import { ships } from '../ships/ship.js';
import { cycleWeapon } from '../ships/weapons.js';
import { bigFree } from '../ships/bigLaser.js';
import { cams, viewH } from '../render/camera.js';

/* ------------------------------------------------------------------ *
 * Weapon box: rounded square next to the ship; old icon slides out left, new one slides in from the right
 * ------------------------------------------------------------------ */
const WICON = {
  basic: (c) => `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 16 H18" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity="0.45"/><circle cx="22" cy="16" r="5" fill="${c}"/><circle cx="23.5" cy="14.5" r="1.8" fill="#fff" opacity="0.8"/></svg>`,
  heavy: () => `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 9 L9 12 M3 16 H8 M5 23 L9 20" stroke="#ffd166" stroke-width="2.2" stroke-linecap="round"/><path d="M11 10.5 H21 C26 10.5 29 13 29 16 C29 19 26 21.5 21 21.5 H11 Z" fill="#ff9a3c"/><rect x="10" y="10" width="3.5" height="12" rx="1" fill="#c45a1e"/><path d="M17 13 H23" stroke="#ffe2b8" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/></svg>`,
  ice: () => `<svg viewBox="0 0 32 32" aria-hidden="true"><g stroke="#9fe7ff" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M16 4 V28 M5.6 10 L26.4 22 M5.6 22 L26.4 10"/><path d="M12.5 6 L16 9 L19.5 6 M12.5 26 L16 23 L19.5 26 M4.5 14 L8.6 12.3 L7.6 8 M27.5 18 L23.4 19.7 L24.4 24 M4.5 18 L8.6 19.7 L7.6 24 M27.5 14 L23.4 12.3 L24.4 8"/></g><circle cx="16" cy="16" r="2.4" fill="#e8fbff"/></svg>`,
  ball: () => `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="#ff5fd2" opacity="0.3"/><g stroke="#ff5fd2" stroke-width="1.8" opacity="0.75"><path d="M5 16 H27 M10.5 6.5 L21.5 25.5 M21.5 6.5 L10.5 25.5"/></g><circle cx="16" cy="16" r="12" fill="none" stroke="#ff5fd2" stroke-width="2.4"/><circle cx="11.5" cy="10.5" r="2.4" fill="#fff" opacity="0.8"/></svg>`,
  laser: (c) => `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="10.5" width="8" height="11" rx="2" fill="#6b7290"/><rect x="9" y="11.5" width="21" height="9" rx="4.5" fill="${c}" opacity="0.55"/><rect x="9" y="14.4" width="21" height="3.2" rx="1.6" fill="#ffffff"/><circle cx="10" cy="16" r="3.4" fill="#ffffff"/></svg>`,
};
const weaponIcon = (s, k) => WICON[WEAPONS[k].id](s.hex);
const weaponColor = (s, k) => WEAPONS[k].color || s.hex;
const wbox = [0, 1].map((i) => ({ el: document.getElementById('wsel' + i), until: 0, cur: null }));
const wbtns = [...document.querySelectorAll('.hud-wbtn')];
wbtns.forEach((b) => b.addEventListener('click', () => {
  const i = Number(b.dataset.p);
  cycleWeapon(ships[isSolo() ? 0 : i]);
}));
export function updateWeaponButtons() {
  for (const b of wbtns) {
    const s = ships[Number(b.dataset.p)];
    const w = WEAPONS[s.weapon];
    b.querySelector('.wname').textContent = w.id === 'laser' ? (s.bigLaser > 0 || bigFree() ? 'Big laser ×1' : 'Big laser (used)') : w.name;
    b.querySelector('.wico').innerHTML = weaponIcon(s, s.weapon);
    b.setAttribute('aria-label', `Change weapon. Current: ${w.name}`);
  }
}
export function animateWeaponBox(i, from, to) {
  const s = ships[i], box = wbox[i];
  box.el.style.setProperty('--wc', weaponColor(s, to));
  box.el.classList.add('on');
  box.until = performance.now() + 1500;
  // Drop any icons still sliding from a quick earlier press, keep only the one showing
  for (const c of [...box.el.children]) if (c !== box.cur) c.remove();
  const old = box.cur || Object.assign(document.createElement('div'), { className: 'wsel-icon', innerHTML: weaponIcon(s, from) });
  if (!old.parentNode) box.el.appendChild(old);
  const nu = Object.assign(document.createElement('div'), { className: 'wsel-icon', innerHTML: weaponIcon(s, to) });
  box.el.appendChild(nu);
  box.cur = nu;
  const opts = { duration: reducedMotion ? 1 : 260, easing: 'cubic-bezier(.25, .8, .3, 1)', fill: 'forwards' };
  old.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-110%)', opacity: 0.2 }], opts).onfinish = () => old.remove();
  nu.animate([{ transform: 'translateX(110%)', opacity: 0.2 }, { transform: 'translateX(0)', opacity: 1 }], opts);
}
// Keep each box beside its ship in that player's view, and hide it a moment after the last switch.
export function updateWeaponBoxes(rects) {
  const now = performance.now();
  for (let i = 0; i < 2; i++) {
    const s = ships[i], box = wbox[i], r = rects[i];
    const show = box.until > now && s.alive && s.active && r;
    if (!show) { if (box.el.classList.contains('on')) box.el.classList.remove('on'); continue; }
    const cam = cams[i];
    const sx = r.x + (s.group.position.x - (cam.position.x + cam.left)) / (cam.right - cam.left) * r.w;
    const sy = r.y + (s.group.position.y - (cam.position.y + cam.bottom)) / (cam.top - cam.bottom) * r.h;
    const off = 18 * P.shipSize * P.zoom + 10;
    let left = sx + off, top = viewH - sy - 20;
    if (left + 40 > r.x + r.w - 4) left = sx - off - 40;   // flip to the left side near the view edge
    const cssTop = viewH - (r.y + r.h);
    top = clamp(top, cssTop + 4, cssTop + r.h - 44);
    box.el.style.left = `${Math.round(left)}px`;
    box.el.style.top = `${Math.round(top)}px`;
  }
}
updateWeaponButtons();
