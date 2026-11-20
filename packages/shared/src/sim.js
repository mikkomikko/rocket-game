import { game } from './state.js';
import { ships } from './ships/ship.js';
import { shipVsShip, updateShip } from './ships/physics.js';
import { stepBullets } from './bullets.js';

// One fixed simulation step of the duel: clocks, ships (from each ship's input) and bullets.
// Map creatures, pickups and boxes still step on the client after this.
// inputsFor(s), if given, lists the [seq, input] pairs ship s plays this step (a server: one per input it
// has received, so a ship takes exactly the steps its player did). With none, the ship waits.
export function stepSim(h, inputsFor = null) {
  game.time += h;
  game.matchClock += h;
  for (const s of ships) { s.px = s.x; s.py = s.y; s.pa = s.a; }
  for (const s of ships) {
    if (!s.active) continue;
    if (!inputsFor) { updateShip(s, h); continue; }
    for (const [seq, inp] of inputsFor(s)) { s.input = inp; s.inputSeq = seq; updateShip(s, h); }
  }
  shipVsShip();
  stepBullets(h);
}
