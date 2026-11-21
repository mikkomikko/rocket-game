import { game } from './state.js';
import { ships } from './ships/ship.js';
import { shipVsShip, updateShip } from './ships/physics.js';
import { cycleWeapon } from './ships/weapons.js';
import { stepBullets } from './bullets.js';
import { stepBoxes } from './boxes.js';
import { mapRules } from './maps.js';
import { checkWinner } from './victory.js';
import { cpuInput, cpuPlays } from './cpu.js';

// One fixed simulation step of the duel: clocks, ships (from each ship's input), bullets, the map's
// creatures and pickups (its rules' simStep), supply boxes, and whether someone has won the match.
// inputsFor(s), if given, lists the [seq, input] pairs ship s plays this step (a server: one per input it
// has received, so a ship takes exactly the steps its player did). With none, the ship waits.
export function stepSim(h, inputsFor = null) {
  game.time += h;
  game.matchClock += h;
  for (const s of ships) { s.px = s.x; s.py = s.y; s.pa = s.a; }
  if (!inputsFor && cpuPlays()) cpuInput(ships[1], h);   // one player: the computer flies ship 1
  for (const s of ships) {
    if (!s.active) continue;
    if (!inputsFor) { updateShip(s, h); continue; }
    for (const [seq, inp] of inputsFor(s)) {
      s.input = inp; s.inputSeq = seq;
      if (inp.cycle) cycleWeapon(s);   // a weapon switch rides with the input of the step it was pressed in
      updateShip(s, h);
    }
  }
  shipVsShip();
  stepBullets(h);
  mapRules().simStep?.(h);
  stepBoxes(h);
  checkWinner();
}
