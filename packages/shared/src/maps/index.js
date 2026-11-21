import { forestRules } from './forest.js';
import { desertRules } from './desert.js';
import { floorsRules } from './floors.js';
import { shipRules } from './starship.js';

/* Map rules: the part of each map theme that is gameplay (creatures, pickups, what shots hit), as plain
 * state and logic that the server runs too. Each is an object of optional hooks, by level theme:
 *
 *   start()              a match starts on this map (or the map was just built)
 *   simStep(h)           one fixed step, called from stepSim after the bullets
 *   encode() / apply(d)  online: the rules' state for a snapshot, and taking it back in a browser
 *   action(s, a)         a map control from ship s's player (a level choice, a restart); online the
 *                        browser sends it with mapAction(a) (client net/online.js) and the server runs it
 *   and any of the gameplay hooks that mapRules() answers (see the client's maps/index.js): coop,
 *   bulletHit, blastHit, beamHit, breakAt, blocksShot, shipsSafe, onKill, onRespawn, sealedHalls,
 *   noMatchWins (no first to P.winsToWin on this map).
 *
 * The client's theme for a map spreads these in and adds the looks. A theme without rules here can't
 * be played online yet. */
export const RULES = { forest: forestRules, desert: desertRules, floors: floorsRules, ship: shipRules };
export const rulesFor = (theme) => RULES[theme] || {};
