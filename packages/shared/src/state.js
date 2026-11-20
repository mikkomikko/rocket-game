// Shared game state, read and written by most modules.
// matchClock: time since the map or match started (Starship keeps its own run timer)
export const game = { time: 0, paused: false, mode: 'duel', matchClock: 0 };
