import { game } from './state.js';

/* ------------------------------------------------------------------ *
 * Constants and tuning parameters: the rules every client and the server share.
 * ------------------------------------------------------------------ */

export const DEG = Math.PI / 180;

export const DEFAULTS = {
  // Movement
  gravity: 16, thrustForce: 400, thrustRampUp: 30, thrustRampDown: 26,
  mass: 2.4, ammoWeight: 0.004, rotSpeed: 5.2, rotAccel: 48,
  linearDrag: 0.5, maxSpeed: 520, shipSize: 1,
  // Obstacles
  restitution: 0.35, wallFriction: 0.25, safeImpact: 120, damagePerSpeed: 0.35,
  lethalImpact: 420, landMaxSpeed: 110, landMaxAngle: 25, invulnTime: 1.2,
  respawnTime: 1.6, repairRate: 12, shipBounce: 0.6, shake: 6,
  // Shooting
  bulletSpeed: 650, inheritVelocity: 0.6, fireRate: 9, spread: 2, bulletLife: 1.6,
  bulletGravity: 0.3, recoil: 18, knockback: 60, bulletDamage: 8, ammoMax: 60,
  rearmRate: 25, destructible: true, holeRadius: 7,
  // Match: the first player to this many wins (kills, or races in Floors) wins the match
  winsToWin: 5,
  cpuSkill: 0.3,   // the computer opponent in a one-player game: 0 easy, 1 hard (aim, reaction, trigger discipline)
  // Level
  lavaSpeed: 70, lavaAccel: 2, lavaDelay: 3,
  map: 'cave', seed: 7, rockAmount: 0.5, noiseScale: 140, tunnelRadius: 46,
  // View and debug
  zoom: 1.5, cameraLag: 0.12, lookahead: 0.22, split: 'side',
  showTrajectory: false, trajectorySeconds: 2, showHull: false, showVelocity: false,
  timeScale: 1, physicsHz: 120,
  smoke: true, smokeLife: 3, smokeRate: 45,
  sound: true, volume: 0.7,
  // Input
  p1Pad: 0, p2Pad: 1, deadzone: 0.18,
};

export const PRESETS = {
  classic: {},
  floaty: { gravity: 90, thrustForce: 300, linearDrag: 0.6, rotSpeed: 3, rotAccel: 12, maxSpeed: 380, thrustRampUp: 6, restitution: 0.5 },
  twitchy: { gravity: 230, thrustForce: 820, rotSpeed: 6.5, rotAccel: 90, linearDrag: 0.1, maxSpeed: 720, thrustRampUp: 40, thrustRampDown: 40 },
  heavy: { mass: 2.2, thrustForce: 950, gravity: 200, rotSpeed: 3, rotAccel: 10, ammoWeight: 0.02, restitution: 0.1, wallFriction: 0.5, recoil: 60 },
};

export const P = structuredClone(DEFAULTS);

/* Weapons. The Blaster uses the Shooting sliders as they are; the others scale from them. */
export const WEAPONS = [
  { id: 'basic', name: 'Blaster', color: null, speed: 1, rate: 1, cost: 1, damage: 1, hole: 1, recoil: 1, knockback: 1, life: 1, grav: 1, size: 8, trail: 0.032, tLife: 0.45, tWidth: 2.6 },
  { id: 'heavy', name: 'Cannon', color: '#ff9a3c', speed: 0.42, rate: 0.13, cost: 5, damage: 4.5, hole: 4.6, recoil: 14, knockback: 4, life: 2.2, grav: 4, size: 18, trail: 0.07, tLife: 1.3, tWidth: 7,
    blast: 64 },          // splash radius: ships inside it take falloff damage and get shoved
  { id: 'ice', name: 'Freezer', color: '#9fe7ff', speed: 0.85, rate: 0.3, cost: 3, damage: 0.25, hole: 0, recoil: 1.5, knockback: 0.3, life: 1.3, grav: 1, size: 11, trail: 0.05, tLife: 0.9, tWidth: 4.2,
    freeze: 5 },          // seconds the target stays frozen
  { id: 'laser', name: 'Big laser', color: null, speed: 1, rate: 1, cost: 0, damage: 1, hole: 0, recoil: 0, knockback: 1, life: 1, grav: 1, size: 8, trail: 0.03, tLife: 0.45, tWidth: 2.6 },   // one shot per match: see fireBigLaser
  { id: 'missile', name: 'Missile', color: '#ffd23f', speed: 0.3, rate: 0.12, cost: 0, damage: 3.5, hole: 2.2, recoil: 3, knockback: 2.5, life: 1.25, grav: 0, size: 10, trail: 0.05, tLife: 0.7, tWidth: 3.2,
    blast: 34, push: 140,          // a smaller splash than the Cannon's
    homing: { cruise: 0.62, accel: 2.6, turn: 3.2, closeTurn: 16, close: 200, fuse: 6 } },   // see steerMissile
];
export const FREEZE_COLOR = '#9fe7ff';
/* Missile: launches slowly along the nose, speeds up to its cruise speed (cruise × bulletSpeed) and steers towards the
 * other ship in an arc, turning at most turn rad/s (up to closeTurn near the target, so it can't circle it forever).
 * Its fuel is its life (life × bulletLife): a target farther away than it can fly in that time escapes, and the
 * missile goes off where its fuel runs out. fuse: extra hit radius, so a near miss still counts. */
export const MISSILE_IDX = WEAPONS.findIndex((w) => w.id === 'missile');
export const MISSILE_COLOR = '#ffd23f';
export const MISSILES = 2;   // missiles per match (they don't come back on respawn); an ammo box fills them up again
// The Forest planet's minigun pickup: seconds it lasts, and how much faster it fires.
export const MINIGUN_TIME = 30, MINIGUN_RATE = 4;

// Practice mode: one ship in an empty, walled arena. These toggles stay out of the tuning JSON.
export const PR = { infiniteAmmo: true, noDamage: false, grid: true, spawn: 'floor' };
export const isPractice = () => game.mode === 'practice';
// One ship on screen: the practice arena, or "solo" (one player on a real map).
export const isSolo = () => game.mode === 'practice' || game.mode === 'solo';
