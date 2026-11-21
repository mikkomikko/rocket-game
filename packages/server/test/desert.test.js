import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../src/server.js';

let server;
beforeAll(() => { server = startServer({ port: 0, seed: 7 }); });
afterAll(() => server.close());

// A test player: keeps every message, and can wait for one that matches.
function join(query) {
  const ws = new WebSocket(`ws://localhost:${server.port()}/?${query}`);
  const msgs = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    msgs.push(m);
    for (const w of [...waiters]) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const next = (test, ms = 3000) => new Promise((resolve, reject) => {
    const found = msgs.find(test);
    if (found) return resolve(found);
    const w = { test, resolve };
    waiters.push(w);
    setTimeout(() => reject(new Error('timed out waiting for a message')), ms);
  });
  const opened = new Promise((r, reject) => { ws.on('open', r); ws.on('error', reject); });
  return { ws, msgs, next, opened };
}

describe('the Dune sea on the server', () => {
  it('runs the sandworm and sends its state and events', async () => {
    const p = join('room=new&map=desert'); await p.opened;
    await p.next((m) => m.t === 'welcome');
    const off = await p.next((m) => m.t === 'snap');
    expect(off.map[0][0]).toBe(0);   // under the sand for the first 7 s
    expect(off.map).toHaveLength(1);
    // 7 s in the sand rumbles, 1.6 s later it bursts out: the snapshot carries its segments, and its burst event comes through.
    const fly = await p.next((m) => m.t === 'snap' && m.map[0][0] === 2, 11000);
    expect(fly.map[1]).toHaveLength(4 + 2 * 24);
    await p.next((m) => m.t === 'snap' && m.events.some((e) => e[0] === 'wormBurst'));
    p.ws.close();
  }, 13000);
});
