import './styles/index.css';
import { P, PR } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { level, solidAt } from '@rocket-duel/shared/level/mask.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { startLoop } from './loop.js';
import { setMode } from './game/modes.js';
import { applySkins } from './ui/skins.js';
import { openStart, setup } from './ui/startScreen.js';

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */
applySkins(setup.skins);
setMode(location.hash.slice(1), true);
openStart();
window.__duelStarted = true;
window.__duel = { P, PR, ships, level, game, solidAt, setMode };
startLoop();
