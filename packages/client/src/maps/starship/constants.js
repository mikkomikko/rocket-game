import * as THREE from 'three';

// Starship tuning (waves, enemy kinds, laser timings) is gameplay and lives in shared; the colour is looks.
export { EKIND, LASER_DAMAGE, LASER_FIRE, LASER_WARN, WAVES } from '@rocket-duel/shared/maps/starship.js';
export const ENEMY_RED = new THREE.Color('#ff4d5e');
