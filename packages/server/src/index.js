import { startServer } from './server.js';

// Settings come from the environment: PORT (8787), MAP (cave), SEED (7).
const port = +(process.env.PORT || 8787);
const map = process.env.MAP || 'cave';
const seed = +(process.env.SEED || 7);
startServer({ port, map, seed });
console.log(`Rocket duel server on ws://localhost:${port} (map ${map}, seed ${seed})`);
