import { afterAll, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { P } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { damage } from '@rocket-duel/shared/ships/physics.js';
import { runMatch } from '../src/match.js';

// One match run in this process, talked to through a fake port, so the test can reach into its state.
const port = new EventEmitter();
const sent = [];
port.postMessage = (m) => { if (m.k === 'send') sent.push({ to: m.to, ...JSON.parse(m.data) }); };
const match = runMatch({ map: 'cave', seed: 7, room: 'test' }, port);
afterAll(() => match.stop());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lastSnap = (cid) => sent.filter((m) => m.t === 'snap' && m.to.includes(cid)).at(-1);
const msg = (cid, m) => port.emit('message', { k: 'msg', cid, data: JSON.stringify(m) });

describe('the match to P.winsToWin online', () => {
  it('sends the winner in snapshots, and starts the next match when a player asks', async () => {
    port.emit('message', { k: 'join', cid: 1 });
    port.emit('message', { k: 'join', cid: 2 });
    await wait(100);
    expect(lastSnap(1).winner).toBe(-1);

    msg(2, { t: 'rematch' });   // nobody has won yet: nothing happens
    ships[0].score = P.winsToWin - 1;
    ships[1].score = 3;
    ships[1].invulnT = 0;
    ships[1].hp = 1;
    ships[1].alive = true;
    damage(ships[1], 10);
    await wait(100);
    const won = lastSnap(2);
    expect(won.winner).toBe(0);
    expect(sent.some((m) => m.t === 'snap' && m.events.some((e) => e[0] === 'matchWon' && e[1].ship === 0))).toBe(true);

    msg(2, { t: 'rematch' });
    await wait(100);
    expect(game.winner).toBe(-1);
    expect(lastSnap(1).winner).toBe(-1);
    expect(ships.map((s) => s.score)).toEqual([0, 0]);
  });

  it('starts from 0 - 0 when a new opponent takes a free seat', async () => {
    ships[0].score = 2; ships[1].score = 1;
    port.emit('message', { k: 'leave', cid: 2 });
    game.time += 60;   // the held seat runs out
    await wait(100);
    port.emit('message', { k: 'join', cid: 3 });
    expect(ships.map((s) => s.score)).toEqual([0, 0]);
  });
});
