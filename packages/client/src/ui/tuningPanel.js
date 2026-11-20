import { Pane } from 'tweakpane';
import { STORAGE_KEY } from '../config.js';
import { DEFAULTS, P, PR, PRESETS } from '@rocket-duel/shared/config.js';
import { mon } from '../state.js';
import { level } from '@rocket-duel/shared/level/mask.js';
import { MAPS } from '@rocket-duel/shared/level/terrain.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { applyLayout, rebuildCave, restartMatch } from '../game/modes.js';

/* ------------------------------------------------------------------ *
 * Tuning panel
 * ------------------------------------------------------------------ */
export const pane = new Pane({ container: document.getElementById('panel') });
const tabs = pane.addTab({ pages: [{ title: 'Movement' }, { title: 'Obstacles' }, { title: 'Shooting' }] });
const [tMove, tObst, tShoot] = tabs.pages;

const bind = (page, key, opts) => page.addBinding(P, key, opts);
bind(tMove, 'gravity', { label: 'Gravity', min: 0, max: 600, step: 1 });
bind(tMove, 'thrustForce', { label: 'Thrust force', min: 0, max: 2000, step: 5 });
bind(tMove, 'thrustRampUp', { label: 'Thrust ramp up', min: 1, max: 60, step: 0.5 });
bind(tMove, 'thrustRampDown', { label: 'Thrust ramp down', min: 1, max: 60, step: 0.5 });
bind(tMove, 'mass', { label: 'Mass', min: 0.2, max: 5, step: 0.05 });
bind(tMove, 'ammoWeight', { label: 'Weight per bullet', min: 0, max: 0.05, step: 0.001 });
bind(tMove, 'rotSpeed', { label: 'Turn speed', min: 0.5, max: 12, step: 0.1 });
bind(tMove, 'rotAccel', { label: 'Turn response', min: 1, max: 200, step: 1 });
bind(tMove, 'linearDrag', { label: 'Air drag', min: 0, max: 3, step: 0.01 });
bind(tMove, 'maxSpeed', { label: 'Max speed', min: 50, max: 1500, step: 5 });
bind(tMove, 'shipSize', { label: 'Ship size', min: 0.5, max: 2.5, step: 0.05 });
tMove.addBinding(mon, 'p1Speed', { label: 'P1 speed', readonly: true, view: 'graph', min: 0, max: 800, interval: 33 });
tMove.addBinding(mon, 'p1Mass', { label: 'P1 mass now', readonly: true, format: (v) => v.toFixed(2) });

bind(tObst, 'restitution', { label: 'Bounce', min: 0, max: 1.2, step: 0.01 });
bind(tObst, 'wallFriction', { label: 'Wall friction', min: 0, max: 1, step: 0.01 });
bind(tObst, 'safeImpact', { label: 'Safe impact speed', min: 0, max: 600, step: 5 });
bind(tObst, 'damagePerSpeed', { label: 'Damage per speed', min: 0, max: 2, step: 0.01 });
bind(tObst, 'lethalImpact', { label: 'Lethal impact speed', min: 50, max: 1500, step: 5 });
bind(tObst, 'landMaxSpeed', { label: 'Landing max speed', min: 0, max: 400, step: 5 });
bind(tObst, 'landMaxAngle', { label: 'Landing max tilt °', min: 0, max: 90, step: 1 });
bind(tObst, 'shipBounce', { label: 'Ship vs ship bounce', min: 0, max: 1.5, step: 0.05 });
bind(tObst, 'invulnTime', { label: 'Spawn shield, s', min: 0, max: 5, step: 0.1 });
bind(tObst, 'respawnTime', { label: 'Respawn delay, s', min: 0.2, max: 6, step: 0.1 });
bind(tObst, 'repairRate', { label: 'Pad repair per s', min: 0, max: 60, step: 1 });
bind(tObst, 'shake', { label: 'Screen shake', min: 0, max: 20, step: 0.5 });

bind(tShoot, 'bulletSpeed', { label: 'Bullet speed', min: 50, max: 2000, step: 10 });
bind(tShoot, 'inheritVelocity', { label: 'Inherit ship speed', min: 0, max: 1.5, step: 0.05 });
bind(tShoot, 'fireRate', { label: 'Shots per s', min: 0.5, max: 40, step: 0.5 });
bind(tShoot, 'spread', { label: 'Spread °', min: 0, max: 30, step: 0.5 });
bind(tShoot, 'bulletLife', { label: 'Bullet lifetime, s', min: 0.1, max: 5, step: 0.1 });
bind(tShoot, 'bulletGravity', { label: 'Bullet gravity', min: 0, max: 2, step: 0.05 });
bind(tShoot, 'recoil', { label: 'Recoil', min: 0, max: 200, step: 1 });
bind(tShoot, 'knockback', { label: 'Knockback on hit', min: 0, max: 400, step: 5 });
bind(tShoot, 'bulletDamage', { label: 'Damage per hit', min: 0, max: 100, step: 1 });
bind(tShoot, 'ammoMax', { label: 'Ammo capacity', min: 1, max: 300, step: 1 });
bind(tShoot, 'rearmRate', { label: 'Pad rearm per s', min: 0, max: 200, step: 1 });
bind(tShoot, 'destructible', { label: 'Shots dig the cave' });
bind(tShoot, 'holeRadius', { label: 'Crater radius', min: 1, max: 40, step: 1 });

export const fPractice = pane.addFolder({ title: 'Practice', expanded: true });
fPractice.addBinding(PR, 'infiniteAmmo', { label: 'Infinite ammo' }).on('change', () => { if (PR.infiniteAmmo) ships[0].ammo = P.ammoMax; });
fPractice.addBinding(PR, 'noDamage', { label: 'No damage' });
fPractice.addBinding(PR, 'grid', { label: 'Grid, 50 units' });
fPractice.addBinding(PR, 'spawn', { label: 'Start', options: { 'On the floor': 'floor', 'Mid-air': 'air' } });
fPractice.addButton({ title: 'Reset ship (R)' }).on('click', restartMatch);

export const fLevel = pane.addFolder({ title: 'Map', expanded: true });
fLevel.addBinding(P, 'map', { label: 'Map', options: Object.fromEntries(Object.entries(MAPS).map(([k, v]) => [v.name, k])) })
  .on('change', () => { if (P.map !== level.builtMap) rebuildCave(); });
fLevel.addBinding(P, 'lavaSpeed', { label: 'Floors: lava speed', min: 0, max: 300, step: 5 });
fLevel.addBinding(P, 'lavaAccel', { label: 'Floors: lava speed-up', min: 0, max: 20, step: 0.5 });
fLevel.addBinding(P, 'lavaDelay', { label: 'Floors: lava wait, s', min: 0, max: 10, step: 0.5 });
fLevel.addBinding(P, 'seed', { label: 'Seed', min: 0, max: 99999, step: 1 });
fLevel.addBinding(P, 'rockAmount', { label: 'Rock amount', min: 0.3, max: 0.7, step: 0.01 });
fLevel.addBinding(P, 'noiseScale', { label: 'Cave scale', min: 40, max: 400, step: 5 });
fLevel.addBinding(P, 'tunnelRadius', { label: 'Tunnel width', min: 20, max: 120, step: 1 });
fLevel.addButton({ title: 'Rebuild map' }).on('click', rebuildCave);
fLevel.addButton({ title: 'Surprise me' }).on('click', () => {
  const keys = Object.keys(MAPS).filter((k) => k !== P.map);
  P.map = keys[Math.floor(Math.random() * keys.length)];
  P.seed = Math.floor(Math.random() * 99999);
  rebuildCave();
  pane.refresh();
});
fLevel.addButton({ title: 'Random seed' }).on('click', () => { P.seed = Math.floor(Math.random() * 99999); pane.refresh(); rebuildCave(); });

const fSound = pane.addFolder({ title: 'Sound', expanded: false });
fSound.addBinding(P, 'sound', { label: 'Sound on (M)' });
fSound.addBinding(P, 'volume', { label: 'Volume', min: 0, max: 1, step: 0.01 });

const fView = pane.addFolder({ title: 'View and debug', expanded: false });
fView.addBinding(P, 'split', { label: 'Split', options: { 'Side by side': 'side', Stacked: 'stacked' } }).on('change', applyLayout);
fView.addBinding(P, 'smoke', { label: 'Engine smoke' });
fView.addBinding(P, 'smokeLife', { label: 'Smoke fade, s', min: 0.3, max: 8, step: 0.1 });
fView.addBinding(P, 'smokeRate', { label: 'Smoke puffs per s', min: 5, max: 150, step: 1 });
fView.addBinding(P, 'zoom', { label: 'Zoom', min: 0.5, max: 4, step: 0.05 });
fView.addBinding(P, 'cameraLag', { label: 'Camera lag, s', min: 0, max: 1, step: 0.01 });
fView.addBinding(P, 'lookahead', { label: 'Camera lookahead, s', min: 0, max: 1, step: 0.01 });
fView.addBinding(P, 'showTrajectory', { label: 'Trajectory preview' });
fView.addBinding(P, 'trajectorySeconds', { label: 'Preview length, s', min: 0.5, max: 8, step: 0.5 });
fView.addBinding(P, 'showHull', { label: 'Hull sample points' });
fView.addBinding(P, 'showVelocity', { label: 'Velocity arrow' });
fView.addBinding(P, 'timeScale', { label: 'Time scale', min: 0.05, max: 2, step: 0.05 });
fView.addBinding(P, 'physicsHz', { label: 'Physics rate', options: { '60 Hz': 60, '120 Hz': 120, '240 Hz': 240 } });
fView.addBinding(mon, 'fps', { label: 'Frames per s', readonly: true, format: (v) => String(Math.round(v)) });

const padOptions = { None: -1, 'Gamepad 1': 0, 'Gamepad 2': 1, 'Gamepad 3': 2, 'Gamepad 4': 3 };
const fInput = pane.addFolder({ title: 'Input', expanded: false });
fInput.addBinding(P, 'p1Pad', { label: 'Player 1 pad', options: padOptions });
fInput.addBinding(P, 'p2Pad', { label: 'Player 2 pad', options: padOptions });
fInput.addBinding(P, 'deadzone', { label: 'Stick deadzone', min: 0, max: 0.6, step: 0.01 });
fInput.addBinding(mon, 'keys', { label: 'Keys held', readonly: true, interval: 50 });
fInput.addBinding(mon, 'pads', { label: 'Gamepads', readonly: true, multiline: true, rows: 3, interval: 500 });

const fPresets = pane.addFolder({ title: 'Presets', expanded: true });
fPresets.addBlade({
  view: 'list', label: 'Start from',
  options: [{ text: 'Classic', value: 'classic' }, { text: 'Floaty', value: 'floaty' }, { text: 'Twitchy', value: 'twitchy' }, { text: 'Heavy', value: 'heavy' }],
  value: 'classic',
}).on('change', (ev) => {
  const keep = { map: P.map, seed: P.seed, rockAmount: P.rockAmount, noiseScale: P.noiseScale, tunnelRadius: P.tunnelRadius, split: P.split, p1Pad: P.p1Pad, p2Pad: P.p2Pad };
  applyTuning({ ...DEFAULTS, ...PRESETS[ev.value], ...keep });
  mon.presetStatus = `Loaded the ${ev.value} handling.`;
});
fPresets.addButton({ title: 'Save in this browser' }).on('click', () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(P)); mon.presetStatus = `Saved at ${new Date().toLocaleTimeString()}.`; }
  catch (e) { mon.presetStatus = 'This browser blocked saving. Use the JSON box instead.'; }
});
fPresets.addButton({ title: 'Load from this browser' }).on('click', () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { mon.presetStatus = 'Nothing saved in this browser yet.'; return; }
    applyTuning(JSON.parse(raw));
    mon.presetStatus = 'Loaded your saved tuning.';
  } catch (e) { mon.presetStatus = 'Couldn’t read the saved tuning.'; }
});
fPresets.addButton({ title: 'Copy or paste JSON' }).on('click', openJson);
fPresets.addButton({ title: 'Reset everything to defaults' }).on('click', () => { applyTuning(DEFAULTS); mon.presetStatus = 'Back to defaults.'; });
fPresets.addBinding(mon, 'presetStatus', { label: 'Status', readonly: true, interval: 300 });

function applyTuning(obj) {
  for (const k of Object.keys(DEFAULTS)) {
    if (obj && k in obj && typeof obj[k] === typeof DEFAULTS[k]) P[k] = obj[k];
  }
  applyLayout();
  for (const s of ships) s.ammo = Math.min(s.ammo, P.ammoMax);
  pane.refresh();
}

/* JSON dialog */
const dlg = document.getElementById('jsonDialog');
const jsonText = document.getElementById('jsonText');
const jsonMsg = document.getElementById('jsonMsg');
function openJson() {
  jsonText.value = JSON.stringify(P, null, 2);
  jsonMsg.textContent = '';
  dlg.showModal();
  jsonText.select();
}
document.getElementById('jsonApply').addEventListener('click', () => {
  try {
    applyTuning(JSON.parse(jsonText.value));
    jsonMsg.textContent = 'Applied.';
    mon.presetStatus = 'Applied tuning from JSON.';
  } catch (e) {
    jsonMsg.textContent = 'That isn’t valid JSON. Check for a missing comma or quote.';
  }
});
document.getElementById('jsonClose').addEventListener('click', () => dlg.close());
