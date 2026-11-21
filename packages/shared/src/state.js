// Shared game state, read and written by most modules.
// matchClock: time since the map or match started (Starship keeps its own run timer)
// winner: the ship id that reached P.winsToWin wins first, -1 while the match is on (see victory.js)
// predicting: a browser is replaying its own ship's inputs (no damage, no events).
export const game = { time: 0, paused: false, mode: 'duel', matchClock: 0, predicting: false, winner: -1 };
