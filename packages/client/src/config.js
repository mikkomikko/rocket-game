import { P } from '@rocket-duel/shared/config.js';

// Client-only settings: player colours, saved tuning and motion preferences.
export const P1HEX = '#ffe066', P2HEX = '#6ee7ff';
export const SKIN = [P1HEX, P2HEX];   // the colours in use now; the start screen changes them
export const STORAGE_KEY = 'rocket-duel-tuning-v1';
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reducedMotion) P.shake = 0;
