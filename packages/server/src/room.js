import { parentPort, workerData } from 'node:worker_threads';
import { runMatch } from './match.js';

// A room's worker thread: one match, with module state of its own (see server.js).
runMatch(workerData, parentPort);
