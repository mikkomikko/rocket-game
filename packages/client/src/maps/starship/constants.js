import * as THREE from 'three';

// Starship tuning: enemy colour, wave list, enemy kinds and laser timings.
export const ENEMY_RED = new THREE.Color('#ff4d5e');
export const WAVES = [
  { bots: 1 }, { bots: 3 }, { bots: 5 }, { bots: 8 }, { bots: 10 },
  { bots: 5, juggs: 2 }, { bots: 5, juggs: 2, raygun: true }, { boss: true },
];
export const EKIND = {
  bot: { hp: 24, r: 13, speed: 210, keep: 260, scale: 1.15, fire: [1.1, 1.8], laser: 0, shots: 1 },
  jugg: { hp: 160, r: 27, speed: 120, keep: 340, scale: 2.4, fire: [1.4, 2.0], laser: 5, shots: 2 },
  boss: { hp: 720, r: 50, speed: 85, keep: 420, scale: 4.4, fire: [0.5, 0.7], laser: 5, shots: 3 },
};
export const LASER_WARN = 0.9, LASER_FIRE = 0.35, LASER_DAMAGE = 40;
