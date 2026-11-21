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

describe('Floors on the server', () => {
  it('sends the race in every snapshot and burns a ship left on its pad', async () => {
    const f = join('room=new&map=floors'); await f.opened;
    const w = await f.next((m) => m.t === 'welcome');
    expect(w.P.map).toBe('floors');
    // Map state: [race, [lava 0, lava 1], [asteroid x, rot…], block hp digits]
    const first = await f.next((m) => m.t === 'snap' && m.map);
    expect(first.map[0]).toBe(0);
    expect(first.map[2]).toHaveLength(24);
    expect(first.map[3]).toBe('5'.repeat(20));
    // No inputs: the ship sits on its pad until the lava (3 s wait) reaches it.
    const snap = await f.next((m) => m.t === 'snap' && m.events.some((e) => e[0] === 'killed' && e[2] === 'lava'), 7000);
    expect(snap.events.find((e) => e[0] === 'killed')[1]).toEqual({ ship: w.id });
    expect(snap.map[1][w.id]).toBeGreaterThan(0);
    f.ws.close();
  }, 10000);
});
