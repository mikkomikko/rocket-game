import { shipRules, SH, WAVES } from '@rocket-duel/shared/maps/starship.js';
import { RB, rbLocal } from '@rocket-duel/shared/maps/hangar.js';
import { askRestart, buildStarship, clearStarship, drawStarship, pickLevel, restartStarship, starshipLooks } from './starship.js';
import { resetRobotLooks, robotLooks } from '../hangar/robot.js';

// Starship and Robot hangar: co-op fights against red robot ships and the giant robot. The fight runs in
// the shared rules (shipRules); this adds how it looks and the players' level and restart keys.
export const ship = {
  ...shipRules,
  shader: { steel: 1 },
  material: 'metal',
  enter() { shipRules.start(); resetRobotLooks(); buildStarship(); },
  leave() { shipRules.start(); resetRobotLooks(); clearStarship(); },
  reset() { shipRules.start(); resetRobotLooks(); },
  step(h) { starshipLooks(); robotLooks(h); },
  draw(now, alpha) { drawStarship(now, alpha); },
  // On its own a browser restarts by rebuilding the map; every other control goes to the shared rules.
  action(s, a) { if (a && a.restart === true) { if (SH.state === 'done') restartStarship(); } else shipRules.action(s, a); },
  keydown(e) {
    if (e.code === 'KeyR' && SH.state === 'done') { askRestart(); return true; }
    const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    if (digit && SH.state === 'choose') { pickLevel(+digit[1]); return true; }
    return false;
  },
  hudLevel() {
    if (SH.state === 'off') return null;
    const next = SH.wave + 1;
    if (SH.spec.mode === 'robot') return SH.state === 'done' ? 'Level: robot destroyed!' : 'Level: giant robot';
    if (SH.state === 'fight') return WAVES[SH.wave].boss ? 'Level: boss' : `Level ${SH.wave + 1} of ${WAVES.length - 1}`;
    if (SH.state === 'choose') return 'Level: choose 1 to 5';
    if (SH.state === 'escape') return 'Level: escape!';
    if (SH.state === 'done') return 'Level: escaped!';
    return WAVES[next] && WAVES[next].boss ? 'Level: boss next' : `Level ${next + 1} next`;
  },
  enemies() { return SH.enemies; },
  cameraFocus() { return RB.cut ? rbLocal(0, 260) : null; },   // the robot's last moments: every camera turns to watch it fall
};
