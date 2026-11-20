// Shared game state, read and written by most modules.
// matchClock: time since the map or match started (Starship keeps its own run timer)
export const game = { time: 0, paused: false, mode: 'duel', matchClock: 0 };
export const mon = { p1Speed: 0, p1Mass: 1, keys: '', pads: '', fps: 0, presetStatus: 'Nothing saved yet.' };
