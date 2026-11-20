import { SKIN } from '../config.js';
import { hexRGB } from '../util/math.js';
import { levelMat, srgb3 } from '../render/scene.js';
import { ships } from '../ships/ship.js';
import { pointers } from '../render/camera.js';
import { updateWeaponButtons } from './weaponBox.js';

/* ------------------------------------------------------------------ *
 * Skins: one colour per player, applied to the ship, its aim guide, shield,
 * bullets, landing pad, opponent pointer and HUD.
 * ------------------------------------------------------------------ */
export const SKINS = [
  { id: 'sun', name: 'Sun', hex: '#ffe066' },
  { id: 'sky', name: 'Sky', hex: '#6ee7ff' },
  { id: 'mint', name: 'Mint', hex: '#6dfbb0' },
  { id: 'bubblegum', name: 'Bubblegum', hex: '#ff8fc8' },
  { id: 'orchid', name: 'Orchid', hex: '#c9a0ff' },
  { id: 'tangerine', name: 'Tangerine', hex: '#ffab4a' },
  { id: 'lime', name: 'Lime', hex: '#c8f560' },
  { id: 'pearl', name: 'Pearl', hex: '#f1eefc' },
];
export const skinOf = (id) => SKINS.find((k) => k.id === id) || SKINS[0];
const shadeHex = (hex, f) => '#' + hexRGB(hex).map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('');
export function applySkins(ids) {
  ids.forEach((id, i) => {
    const hex = skinOf(id).hex, s = ships[i];
    SKIN[i] = hex;
    s.hex = hex;
    s.color.set(hex);
    s.hullMat.color.set(hex);
    s.shadeMat.color.set(hex).multiplyScalar(0.6);
    s.aura.material.color.set(hex);
    s.shield.material.color.set(hex);
    s.crossMat.color.set(hex);
    s.traj.material.color.set(hex);
    s.arrow.setColor(hex);
    const a = s.aimGeo.attributes.color;
    for (let k = 0; k < a.count; k++) a.setXYZ(k, s.color.r, s.color.g, s.color.b);
    a.needsUpdate = true;
    // Each player's pointer shows the other player's colour.
    pointers[1 - i].glow.material.color.set(hex);
    pointers[1 - i].arrow.material.color.set(hex);
    document.documentElement.style.setProperty(i ? '--p2' : '--p1', hex);
  });
  levelMat.uniforms.uP1.value.copy(srgb3(SKIN[0]));
  levelMat.uniforms.uP2.value.copy(srgb3(SKIN[1]));
  updateWeaponButtons();
}
// The ship drawn as a small SVG, the same outline as in the game.
export const rocketSVG = (hex) => `<svg viewBox="-10 -14 20 34" aria-hidden="true"><path d="M-3.5 8 L0 19 L3.5 8Z" fill="#ff8f3d"/><path d="M-1.6 8 L0 13.5 L1.6 8Z" fill="#fff1c2"/><path d="M0 -12 L-8 8 L-3 4.5 L0 4.5Z" fill="${hex}"/><path d="M0 -12 L0 4.5 L3 4.5 L8 8Z" fill="${shadeHex(hex, 0.6)}"/><path d="M0 -7 L2.6 -0.5 L-2.6 -0.5Z" fill="#1b1640"/><path d="M0 -6.2 L-1.9 -1.2 L-0.9 -1.2Z" fill="#b9b0ff" opacity="0.7"/></svg>`;
