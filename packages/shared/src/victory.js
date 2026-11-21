import { isPractice, P } from './config.js';
import { game } from './state.js';
import { simEvent } from './events.js';
import { mapRules } from './maps.js';
import { ships } from './ships/ship.js';

/* The match: the first player to P.winsToWin wins (kills in a duel, races in Floors). Once someone has,
 * game.winner holds their ship id, nothing scores and no ship takes damage until restartMatch (or, online,
 * a rematch) starts the next match. Practice, or a map where the players team up, has no target; a
 * one-player game is against the computer (cpu.js) and plays to the same target.
 * The client hears:
 *   matchWon(s)   ship s just won the match */

// Wins a player needs to take the match, or 0 when this match has none (P.winsToWin 0 turns it off).
export const winTarget = () => (isPractice() || mapRules().noMatchWins ? 0 : Math.max(0, Math.round(P.winsToWin) || 0));

export function scorePoint(s, n = 1) { if (game.winner < 0) s.score += n; }

export function checkWinner() {
  const need = winTarget();
  if (!need || game.winner >= 0) return;
  const s = ships.find((o) => o.score >= need);
  if (!s) return;
  game.winner = s.id;
  simEvent('matchWon', s);
}

// A new match: scores back to zero and no winner.
export function resetMatchScore() {
  game.winner = -1;
  for (const s of ships) s.score = 0;
}
