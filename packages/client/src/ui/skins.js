import { SKIN } from '../config.js';
import { levelMat, srgb3 } from '../render/scene.js';
import { pointers } from '../render/camera.js';
import { updateWeaponButtons } from './weaponBox.js';
import { setDesign, setHullColor, views } from '../ships/view.js';
import { designOf } from '../ships/designs.js';

/* ------------------------------------------------------------------ *
 * Skins: each player picks a colour and a ship design (ships/designs.js). The colour
 * goes on the ship, its aim guide, shield, bullets, landing pad, opponent pointer and HUD.
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
// ids: a colour id per player; designs: a design id per player (left as they are when not given).
export function applySkins(ids, designs) {
  ids.forEach((id, i) => {
    const hex = skinOf(id).hex, s = views[i];
    SKIN[i] = hex;
    s.hex = hex;
    s.color.set(hex);
    if (designs) setDesign(s, designs[i]);
    setHullColor(s, hex);
    s.aura.material.color.set(hex);
    s.shield.material.color.set(hex);
    s.traj.material.color.set(hex);
    s.arrow.setColor(hex);
    // Each player's pointer shows the other player's colour.
    pointers[1 - i].glow.material.color.set(hex);
    pointers[1 - i].arrow.material.color.set(hex);
    document.documentElement.style.setProperty(i ? '--p2' : '--p1', hex);
  });
  levelMat.uniforms.uP1.value.copy(srgb3(SKIN[0]));
  levelMat.uniforms.uP2.value.copy(srgb3(SKIN[1]));
  updateWeaponButtons();
}
// The ship drawn as a small SVG in a design, the same outline as in the game.
export const rocketSVG = (hex, design) => designOf(design).svg(hex);
