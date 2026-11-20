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
  { id: 'ball', name: 'Bouncer', color: '#ff5fd2', speed: 0.7, rate: 0.25, cost: 4, damage: 0.4, hole: 0, recoil: 2, knockback: 1.5, life: 1.6, grav: 1.5, size: 13, trail: 0.05, tLife: 0.9, tWidth: 4.5,
    ball: 5 },            // seconds the target stays trapped in the bouncy ball
];
export const FREEZE_COLOR = '#9fe7ff';
/* Bouncer: a hit wraps the ship in a heavy, very bouncy ball. The pilot can't steer or fire, the ball falls a bit
 * harder, bounces off terrain and the map edges, rolls along the ground and takes no crash damage. */
export const BALL_IDX = WEAPONS.findIndex((w) => w.id === 'ball');
export const BALL_COLOR = '#ff5fd2';
export const BALL_R = 19;          // ball radius (world units at ship size 1)
export const BALL_MASS = 4;        // extra mass while trapped: heavier to knock around, hits the other ship harder
export const BALL_BOUNCE = 0.86;   // share of impact speed kept on each bounce
export const BALL_GRAV = 1.3;      // gravity multiplier while trapped

// Practice mode: one ship in an empty, walled arena. These toggles stay out of the tuning JSON.
export const PR = { infiniteAmmo: true, noDamage: false, grid: true, spawn: 'floor' };
export const isPractice = () => game.mode === 'practice';
// One ship on screen: the practice arena, or "solo" (one player on a real map).
export const isSolo = () => game.mode === 'practice' || game.mode === 'solo';
