/* Simulation events: what the simulation reports so a client can show and play it (sound, particles,
 * camera shake, UI). The simulation never waits for an answer, and with no listener an event does nothing.
 * Listeners run immediately, in the middle of the step, so they see the state at that moment. */
const listeners = new Map(), anyListeners = [];
export function onSim(type, fn) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
}
// Hears every event as (type, args): a server uses it to pass them all on.
export function onAnySim(fn) { anyListeners.push(fn); }
// Runs fn with events switched off (a browser replaying its own predicted moves).
let muted = false;
export function quietly(fn) { muted = true; try { fn(); } finally { muted = false; } }
export function simEvent(type, ...args) {
  if (muted) return;
  const list = listeners.get(type);
  if (list) for (const fn of list) fn(...args);
  for (const fn of anyListeners) fn(type, args);
}
