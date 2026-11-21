import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../src/server.js';

let server;
beforeAll(() => { server = startServer({ port: 0, seed: 7, origins: ['http://game.test'] }); });
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
  const opened = new Promise((r, reject) => { ws.on('open', r); ws.on('error', reject); });
  return { ws, msgs, next, send, opened };
}
const hasEvent = (type) => (m) => m.t === 'snap' && m.events.some((e) => e[0] === type);

// Snapshot map state (shared maps/starship.js): [head, enemies, lasers, raygun, supplies, robot]; head[0] is
// the state: 1 choose, 2 between, 3 fight, 6 robot.
describe('the Starship and Robot hangar online', () => {
  it('runs the Starship: a level choice from a player starts the waves', async () => {
    const p = join('room=new&map=starship'); await p.opened;
    await p.next((m) => m.t === 'welcome');
    const first = await p.next((m) => m.t === 'snap' && m.map);
    expect(first.map[0][0]).toBe(1);   // waiting on the level chooser
    expect(first.map[4].every((on) => on === 1)).toBe(true);   // every ammo box and medkit is out
    p.send({ t: 'map', action: { level: 7 } });   // not a level: ignored
    p.send({ t: 'map', action: { level: 2 } });
    const chosen = await p.next(hasEvent('shipLevel'));
    expect(chosen.map[0][0]).toBe(2);
    expect(chosen.events.find((e) => e[0] === 'shipLevel')[1]).toBe(2);
    await p.next(hasEvent('shipWave'), 4000);
    await p.next(hasEvent('enemySpawned'), 3000);
    const snap = await p.next((m) => m.t === 'snap' && m.map[1].length >= 8 * 3, 3000);   // three red ships, 8 numbers each
    expect(snap.map[0][0]).toBe(3);
    expect(snap.map[0][1]).toBe(1);   // wave index 1: level 2
    p.ws.close();
  }, 12000);

  it('runs the Robot hangar: the giant robot drops in', async () => {
    const p = join('room=new&map=hangar'); await p.opened;
    await p.next((m) => m.t === 'welcome');
    const first = await p.next((m) => m.t === 'snap' && m.map);
    expect(first.map[0][0]).toBe(2);   // something big is coming
    expect(Array.isArray(first.map[5])).toBe(true);   // the robot's state
    const drop = await p.next(hasEvent('robotDrop'), 5000);
    expect(drop.map[0][0]).toBe(6);
    expect(drop.map[5][0]).toBe(1);   // the robot is dropping
    p.ws.close();
  }, 8000);
});
