/* Simulation events: what the simulation reports so a client can show and play it (sound, particles,
 * camera shake, UI). The simulation never waits for an answer, and with no listener an event does nothing.
 * Listeners run immediately, in the middle of the step, so they see the state at that moment. */
const listeners = new Map();
export function onSim(type, fn) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
}
export function simEvent(type, ...args) {
  const list = listeners.get(type);
  if (list) for (const fn of list) fn(...args);
}
