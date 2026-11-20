import { game } from './state.js';
import { ships } from './ships/ship.js';
import { shipVsShip, updateShip } from './ships/physics.js';
import { stepBullets } from './bullets.js';

// One fixed simulation step of the duel: clocks, ships (from each ship's input) and bullets.
// Map creatures, pickups and boxes still step on the client after this.
export function stepSim(h) {
  game.time += h;
  game.matchClock += h;
  for (const s of ships) { s.px = s.x; s.py = s.y; s.pa = s.a; }
  for (const s of ships) if (s.active) updateShip(s, h);
  shipVsShip();
  stepBullets(h);
}
