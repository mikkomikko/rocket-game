import { reducedMotion } from '../config.js';
import { isSolo, P, WEAPONS } from '@rocket-duel/shared/config.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { bigFree } from '@rocket-duel/shared/ships/bigLaser.js';
import { cams, viewH, viewSlot } from '../render/camera.js';
import { views } from '../ships/view.js';
import { net, switchWeapon } from '../net/online.js';

/* ------------------------------------------------------------------ *
 * Weapon box: rounded square next to the ship; old icon slides out left, new one slides in from the right
 * ------------------------------------------------------------------ */
const WICON = {
  basic: (c) => `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 16 H18" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity="0.45"/><circle cx="22" cy="16" r="5" fill="${c}"/><circle cx="23.5" cy="14.5" r="1.8" fill="#fff" opacity="0.8"/></svg>`,
  heavy: () => `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 9 L9 12 M3 16 H8 M5 23 L9 20" stroke="#ffd166" stroke-width="2.2" stroke-linecap="round"/><path d="M11 10.5 H21 C26 10.5 29 13 29 16 C29 19 26 21.5 21 21.5 H11 Z" fill="#ff9a3c"/><rect x="10" y="10" width="3.5" height="12" rx="1" fill="#c45a1e"/><path d="M17 13 H23" stroke="#ffe2b8" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/></svg>`,
  ice: () => `<svg viewBox="0 0 32 32" aria-hidden="true"><g stroke="#9fe7ff" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M16 4 V28 M5.6 10 L26.4 22 M5.6 22 L26.4 10"/><path d="M12.5 6 L16 9 L19.5 6 M12.5 26 L16 23 L19.5 26 M4.5 14 L8.6 12.3 L7.6 8 M27.5 18 L23.4 19.7 L24.4 24 M4.5 18 L8.6 19.7 L7.6 24 M27.5 14 L23.4 12.3 L24.4 8"/></g><circle cx="16" cy="16" r="2.4" fill="#e8fbff"/></svg>`,
  missile: () => `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="4.6" cy="27.4" r="2.8" fill="#b8b0c8" opacity="0.4"/><circle cx="8" cy="25.6" r="1.9" fill="#b8b0c8" opacity="0.6"/><g transform="rotate(45 16 16)"><path d="M14 21.5 L16 28 L18 21.5 Z" fill="#ff8f3d"/><path d="M13 16.5 L9.5 22.5 H13 Z M19 16.5 L22.5 22.5 H19 Z" fill="#c9971a"/><path d="M16 3 C18.6 5.6 19 8 19 10 V22 H13 V10 C13 8 13.4 5.6 16 3 Z" fill="#ffd23f"/><circle cx="16" cy="11" r="1.6" fill="#fff" opacity="0.85"/></g></svg>`,
  frag: () => `<svg viewBox="0 0 32 32" aria-hidden="true"><g stroke="#ffb347" stroke-width="2" stroke-linecap="round" opacity="0.7"><path d="M3.5 14 L7 15.5 M5 24 L8.4 21.6 M14 29 L14.6 25.4 M24 28 L22 24.8 M29 20 L25.6 19"/></g><circle cx="16" cy="18" r="8.5" fill="#8a7a3a"/><path d="M10.5 13.5 H21.5 M8.2 18 H23.8 M10.5 22.5 H21.5 M16 9.5 V26.5" stroke="#5e5226" stroke-width="1.3"/><rect x="13" y="6.5" width="6" height="4" rx="1" fill="#6b7290"/><path d="M19 8 C22 6 23 4.5 24.5 4" stroke="#c9b48a" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="25" cy="3.8" r="2.2" fill="#ffe066"/><circle cx="13" cy="15" r="2" fill="#fff" opacity="0.35"/></svg>`,
  laser: (c) => `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="10.5" width="8" height="11" rx="2" fill="#6b7290"/><rect x="9" y="11.5" width="21" height="9" rx="4.5" fill="${c}" opacity="0.55"/><rect x="9" y="14.4" width="21" height="3.2" rx="1.6" fill="#ffffff"/><circle cx="10" cy="16" r="3.4" fill="#ffffff"/></svg>`,
};
const weaponIcon = (s, k) => WICON[WEAPONS[k].id](views[s.id].hex);
const weaponColor = (s, k) => WEAPONS[k].color || views[s.id].hex;
const wbox = [0, 1].map((i) => ({ el: document.getElementById('wsel' + i), until: 0, cur: null }));
const wbtns = [...document.querySelectorAll('.hud-wbtn')];
wbtns.forEach((b) => b.addEventListener('click', () => {
  const i = Number(b.dataset.p);
  switchWeapon(ships[isSolo() ? 0 : i]);
}));
export function updateWeaponButtons() {
  for (const b of wbtns) {
    const s = ships[Number(b.dataset.p)];
    const w = WEAPONS[s.weapon];
    b.querySelector('.wname').textContent = w.id === 'laser' ? (s.bigLaser > 0 || bigFree() ? 'Big laser ×1' : 'Big laser (used)')
      : w.id === 'missile' && !bigFree() ? `Missile ×${s.missiles}` : w.name;
    b.querySelector('.wico').innerHTML = weaponIcon(s, s.weapon);
    b.setAttribute('aria-label', `Change weapon. Current: ${w.name}`);
  }
  // The touch weapon button shows the weapon of the ship this device flies.
  const tb = document.getElementById('touchWeapon');
  if (tb) {
    const s = ships[net.online ? net.id : 0];
    tb.querySelector('.wico').innerHTML = weaponIcon(s, s.weapon);
    tb.setAttribute('aria-label', `Change weapon. Current: ${WEAPONS[s.weapon].name}`);
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
  for (let id = 0; id < 2; id++) {
    const slot = viewSlot(id), s = ships[id], box = wbox[id], r = rects[slot];
    const show = box.until > now && s.alive && s.active && r;
    if (!show) { if (box.el.classList.contains('on')) box.el.classList.remove('on'); continue; }
    const cam = cams[slot];
    const g = views[id].group;
    const sx = r.x + (g.position.x - (cam.position.x + cam.left)) / (cam.right - cam.left) * r.w;
    const sy = r.y + (g.position.y - (cam.position.y + cam.bottom)) / (cam.top - cam.bottom) * r.h;
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
