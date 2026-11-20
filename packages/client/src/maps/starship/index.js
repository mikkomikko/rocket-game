import { segDist } from '@rocket-duel/shared/math.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { WAVES } from './constants.js';
import { buildStarship, bulletHitsEnemy, chooseLevel, clearStarship, drawStarship, killEnemy, resetStarship, restartStarship, SH, stepStarship } from './starship.js';
import { RB, rbLocal } from '../hangar/hangar.js';
import { hurtRobot } from '../hangar/robot.js';
import { level } from '@rocket-duel/shared/level/mask.js';

const robotUp = () => SH.spec && SH.spec.mode === 'robot' && RB.on && !RB.dead;

// Starship and Robot hangar: co-op fights against red robot ships and the giant robot.
export const ship = {
  shader: { steel: 1 },
  material: 'metal',
  coop: true,
  enter() { SH.spec = level.spec; buildStarship(); },
  leave() { clearStarship(); },
  reset() { resetStarship(); },
  step(h) { stepStarship(h); },
  draw(now) { drawStarship(now); },
  bulletHit(x, y, owner, dmg, kind) { return owner < 2 && bulletHitsEnemy(owner, x, y, dmg, kind); },
  blastHit(x, y, R, owner, dmg) {
    for (const e of SH.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < R + e.K.r) { e.hp -= dmg; e.flash = 0.08; if (e.hp <= 0 && owner < 2) killEnemy(e, ships[owner]); }
    }
    if (owner < 2 && robotUp() && Math.hypot(RB.x - x, RB.y + 300 - y) < R + 150) hurtRobot(dmg, ships[owner]);
  },
  beamHit(b, s, len, half, dmg) {
    for (const e of SH.enemies) {
      if (e.dead || b.hit.has(e)) continue;
      if (segDist(e.x, e.y, b.ox, b.oy, b.ang, len) < half + e.K.r) {
        b.hit.add(e);
        e.hp -= dmg;
        e.flash = 0.15;
        if (e.hp <= 0) killEnemy(e, s);
      }
    }
    if (robotUp() && !b.hit.has(RB) && segDist(RB.x, RB.y + 300, b.ox, b.oy, b.ang, len) < half + 120) {
      b.hit.add(RB);
      hurtRobot(dmg, s);
    }
  },
  shipsSafe() { return RB.cut; },   // the robot's death cutscene
  onKill() { SH.deaths++; },
  keydown(e) {
    if (e.code === 'KeyR' && SH.state === 'done') { restartStarship(); return true; }
    const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    if (digit && SH.state === 'choose') { chooseLevel(+digit[1]); return true; }
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
