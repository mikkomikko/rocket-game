import { describe, expect, it } from 'vitest';
import { DEFAULTS, P } from '../src/config.js';
import { game } from '../src/state.js';
import { H, level, W } from '../src/level/mask.js';
import { generateMap } from '../src/level/generate.js';
import { MAPS } from '../src/level/terrain.js';

// FNV-1a over the mask: changes if a single cell changes.
const hash = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return (h >>> 0).toString(16); };

// Mask checksums at the default tuning (seed 7), recorded in the browser before the code moved here.
const EXPECTED = {
  cave: '91163eb4', clear: '8cae7785', open: 'c9b31cf7', forest: '926e3d9d', desert: '432c035d', pillars: '7ef59cfb',
  maze: '8968ec1a', divide: '9b49fff1', floors: '7bf7aa2d', starship: '1c7bc925', hangar: '31a4c95d',
};
const THEMES = { forest: 'forest', desert: 'desert', floors: 'floors', starship: 'ship', hangar: 'ship' };

describe('level generation (runs without a browser)', () => {
  it('covers every map', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(MAPS).sort());
  });
  for (const [map, expected] of Object.entries(EXPECTED)) {
    it(`builds ${map} exactly as before`, () => {
      Object.assign(P, structuredClone(DEFAULTS), { map });
      game.mode = 'duel';
      generateMap();
      expect(level.mask.length).toBe(W * H);
      expect(hash(level.mask)).toBe(expected);
      expect(level.theme).toBe(THEMES[map] || 'rock');
      expect(level.spawns).toHaveLength(2);
    });
  }
  it('builds the empty practice arena', () => {
    Object.assign(P, structuredClone(DEFAULTS), { map: 'hangar' });
    game.mode = 'practice';
    generateMap();
    expect(hash(level.mask)).toBe('1fa7d745');
    expect(level.theme).toBe('rock');
    game.mode = 'duel';
  });
});
