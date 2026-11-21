import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../src/server.js';

let server;
beforeAll(() => { server = startServer({ port: 0, seed: 7, pingEvery: 0.3, origins: ['http://game.test'] }); });
afterAll(() => server.close());

// A test player: keeps every message, and can wait for one that matches.
function join(query, origin = 'http://game.test') {
  const ws = new WebSocket(`ws://localhost:${server.port()}/?${query}`, { origin });
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
  // cycle: switch weapon on the first of these steps.
  const input = (turn, thrust, fire, steps = 1, cycle = false) => {
    send({ t: 'input', seq: seq + 1, list: Array.from({ length: steps }, (_, k) => [turn, thrust, fire ? 1 : 0, cycle && !k ? 1 : 0]) });
    seq += steps;
    return seq;
  };
  const opened = new Promise((r, reject) => { ws.on('open', r); ws.on('error', reject); });
  const closed = new Promise((r) => ws.on('close', r));
  return { ws, msgs, next, send, input, opened, closed };
}
const lastSnap = (p) => p.msgs.filter((m) => m.t === 'snap').at(-1);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('the online duel server', () => {
  let a, b, room;
  it('starts a room and gives it a name for the invite link', async () => {
    a = join('room=new&map=cave'); await a.opened;
    const wa = await a.next((m) => m.t === 'welcome');
    expect(wa.id).toBe(0);
    expect(wa.room).toMatch(/^[a-z0-9]{6}$/);
    expect(wa.P.map).toBe('cave');
    expect(wa.seats).toEqual(['here', null]);   // waiting for an opponent
    room = wa.room;
    expect(server.rooms()).toContain(room);
  });

  it('seats a second player from the link and turns a third away', async () => {
    b = join(`room=${room}`); await b.opened;
    const wb = await b.next((m) => m.t === 'welcome');
    expect(wb.id).toBe(1);
    await a.next((m) => m.t === 'seats' && m.seats[1] === 'here');
    const c = join(`room=${room}`); await c.opened;
    await c.next((m) => m.t === 'full');
  });

  it('runs each room as its own match', async () => {
    const other = join('room=new&map=open'); await other.opened;
    const w = await other.next((m) => m.t === 'welcome');
    expect(w.room).not.toBe(room);
    expect(w.id).toBe(0);
    expect(w.P.map).toBe('open');
    other.ws.close();
  });

  it('says so when a room does not exist, or a map it cannot run', async () => {
    const lost = join('room=nosuch'); await lost.opened;
    await lost.next((m) => m.t === 'noroom');
    const bad = join('room=new&map=nosuch'); await bad.opened;
    await bad.next((m) => m.t === 'error');
  });

  it('runs the Forest dino on the server', async () => {
    const f = join('room=new&map=forest'); await f.opened;
    await f.next((m) => m.t === 'welcome');
    // The dino's first run starts 4 s in: the snapshot's map state shows it, and its run event comes through.
    const snap = await f.next((m) => m.t === 'snap' && m.map && m.map[0][0] === true, 6000);
    expect(snap.map[1][0]).toBe(true);   // the minigun waits on its island
    await f.next((m) => m.t === 'snap' && m.events.some((e) => e[0] === 'dinoRun'));
    f.ws.close();
  }, 8000);

  it('sends snapshots about 30 times a second', async () => {
    const n0 = a.msgs.filter((m) => m.t === 'snap').length;
    await wait(500);
    const n = a.msgs.filter((m) => m.t === 'snap').length - n0;
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(20);
    expect(lastSnap(a).boxes.length).toBeGreaterThan(0);   // supply boxes: kind, on, x, y each
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
    b.input(0, 0.6, true, 180, true);   // the weapon switch rides on the first input   // 1.5 s of firing
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

  it('holds a dropped player\'s seat, and gives it back with every crater so far', async () => {
    const wb = b.msgs.find((m) => m.t === 'welcome');
    const score = lastSnap(a).ships[1][0][15];
    const carved = a.msgs.filter((m) => m.t === 'snap').flatMap((m) => m.events).filter((e) => e[0] === 'carve').length;
    b.ws.close();
    await a.next((m) => m.t === 'seats' && m.seats[1] === 'away');
    await wait(100);
    expect(lastSnap(a).ships[1][0][12]).toBe(false);   // 'active': the empty seat's ship is gone
    // Someone else with the link can't take the held seat.
    const c = join(`room=${room}`); await c.opened;
    await c.next((m) => m.t === 'full');
    // The player comes back with their token.
    b = join(`room=${room}&token=${wb.token}`); await b.opened;
    const back = await b.next((m) => m.t === 'welcome');
    expect(back.id).toBe(1);
    expect(back.token).toBe(wb.token);
    expect(back.carves.length).toBeGreaterThanOrEqual(carved);
    await a.next((m) => m.t === 'seats' && m.seats[1] === 'here' && a.msgs.filter((x) => x.t === 'seats').length > 2);
    await wait(100);
    expect(lastSnap(b).ships[1][0][15]).toBe(score);   // the score stays theirs
  });

  it('lets a reconnecting player take over a seat whose old connection is still open', async () => {
    const wb = b.msgs.find((m) => m.t === 'welcome');
    const again = join(`room=${room}&token=${wb.token}`); await again.opened;
    expect((await again.next((m) => m.t === 'welcome')).id).toBe(1);
    await b.next((m) => m.t === 'replaced');
    await b.closed;   // the server closes the stale one
    b = again;
  });

  it('keeps connections that answer its pings', async () => {
    await wait(1000);   // a few ping rounds
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('answers the health check', async () => {
    const res = await fetch(`http://localhost:${server.port()}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('refuses pages from other origins', async () => {
    const evil = join('room=new&map=cave', 'http://evil.test');
    await expect(evil.opened).rejects.toThrow();
  });
});
