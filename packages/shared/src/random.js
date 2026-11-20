import { mulberry32 } from './math.js';

/* Gameplay randomness (bullet spread, where a blast breaks blocks). It is seeded, so a server and its
 * clients can roll the same numbers. Looks (particles, sounds) keep using Math.random. */
let rng = mulberry32(1);
export const seedRandom = (seed) => { rng = mulberry32(seed); };
export const random = () => rng();
