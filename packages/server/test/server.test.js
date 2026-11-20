import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../src/server.js';

let server;
beforeAll(() => { server = startServer({ port: 0, map: 'cave', seed: 7 }); });
afterAll(() => server.close());

// A test player: keeps every message, and can wait for one that matches.
function join() {
  const ws = new WebSocket(`ws://localhost:${server.port()}`);
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
  const send = (m) => ws.send(JSON.stringify(m));
  // Inputs go one per simulation step, numbered, as the browser sends them.
  let seq = 0;
  const input = (turn, thrust, fire, steps = 1) => {
    send({ t: 'input', seq: seq + 1, list: Array.from({ length: steps }, () => [turn, thrust, fire ? 1 : 0]) });
    seq += steps;
    return seq;
  };
  const opened = new Promise((r) => ws.on('open', r));
  return { ws, msgs, next, send, input, opened };
}
const lastSnap = (p) => p.msgs.filter((m) => m.t === 'snap').at(-1);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('the online duel server', () => {
  let a, b;
  it('seats two players and turns a third away', async () => {
    a = join(); await a.opened;
    const wa = await a.next((m) => m.t === 'welcome');
    b = join(); await b.opened;
    const wb = await b.next((m) => m.t === 'welcome');
    expect([wa.id, wb.id]).toEqual([0, 1]);
    expect(wa.P.map).toBe('cave');
    const c = join(); await c.opened;
    await c.next((m) => m.t === 'full');
  });

  it('sends snapshots about 30 times a second', async () => {
    const n0 = a.msgs.filter((m) => m.t === 'snap').length;
    await wait(500);
    const n = a.msgs.filter((m) => m.t === 'snap').length - n0;
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(20);
  });

  it('flies a ship from its player\'s input', async () => {
    const y0 = lastSnap(a).ships[0][0][1];
    a.input(0, 1, false, 72);   // 0.6 s of thrust: one input per step
    await wait(800);
    const [vals] = lastSnap(b).ships[0];   // the other player sees it too
    expect(vals[1]).toBeGreaterThan(y0 + 20);
  });

  it('moves a ship only as far as its player\'s inputs go', async () => {
    await wait(300);   // every input sent so far is used up
    const before = lastSnap(a).ships[0][0];
    await wait(300);
    expect(lastSnap(a).ships[0][0]).toEqual(before);   // no new inputs: the ship waits
  });

  it('applies numbered inputs in order and acknowledges them', async () => {
    const last = a.input(0.5, 0, false, 30);   // a quarter second of steps at once
    await a.next((m) => m.t === 'snap' && m.acks[0] === last);
  });

  it('passes on shots, craters and weapon switches as events', async () => {
    b.send({ t: 'cycle' });
    b.input(0, 0.6, true, 180);   // 1.5 s of firing
    await wait(1800);
    const events = a.msgs.filter((m) => m.t === 'snap').flatMap((m) => m.events);
    const types = new Set(events.map((e) => e[0]));
    expect(types.has('fired')).toBe(true);
    expect(types.has('weaponChanged')).toBe(true);
    expect(types.has('carve')).toBe(true);
    const fired = events.find((e) => e[0] === 'fired');
    expect(fired[1]).toEqual({ ship: 1 });
    // Every shot carries the number of the input that fired it (row: slot, x, y, vx, vy, kind, owner, seq).
    const rows = a.msgs.filter((m) => m.t === 'snap').flatMap((m) => {
      const out = [];
      for (let k = 0; k < m.bullets.length; k += 8) out.push(m.bullets.slice(k, k + 8));
      return out;
    }).filter((r) => r[6] === 1);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r[7]).toBeGreaterThan(0);
  });

  it('gives a late joiner every crater so far', async () => {
    const carved = a.msgs.filter((m) => m.t === 'snap').flatMap((m) => m.events).filter((e) => e[0] === 'carve').length;
    b.ws.close();
    await wait(200);
    expect(lastSnap(a).ships[1][0][12]).toBe(false);   // 'active': the empty seat's ship is gone
    const late = join(); await late.opened;
    const w = await late.next((m) => m.t === 'welcome');
    expect(w.id).toBe(1);
    expect(w.carves.length).toBeGreaterThanOrEqual(carved);
    late.ws.close();
  });
});
