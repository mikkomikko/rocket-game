import { startServer } from './server.js';

/* Settings come from the environment:
 *   PORT (8787)
 *   ORIGINS      pages allowed to connect, comma separated (https://example.com,https://www.example.com); empty: any
 *   STATIC_DIR   serve the built browser game from this folder (packages/client/dist), so one address does both
 *   MAX_ROOMS    (200) matches at once
 *   LAG          (0 ms) a simulated slow connection
 *   SEED         the same map seed in every room (default: a new one each time) */
const env = process.env;
const port = +(env.PORT || 8787);
const origins = (env.ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const server = startServer({
  port, origins,
  staticDir: env.STATIC_DIR || null,
  maxRooms: +(env.MAX_ROOMS || 200),
  lag: +(env.LAG || 0),
  seed: env.SEED ? +env.SEED : null,
  log: (text) => console.log(`${new Date().toISOString()} ${text}`),
});
console.log(`Rocket duel server on port ${port}${env.STATIC_DIR ? `, serving ${env.STATIC_DIR}` : ''}${origins.length ? `, origins ${origins.join(' ')}` : ''}${env.LAG ? `, ${env.LAG} ms lag` : ''}`);
// Hosts stop a machine with SIGTERM (a deploy, a restart): close the rooms and the port first.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close().then(() => process.exit(0)));
