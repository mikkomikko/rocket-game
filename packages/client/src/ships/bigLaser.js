import * as THREE from 'three';
import { isPractice, P, PR, WEAPONS } from '../config.js';
import { carve, level, maskAt, solidAt } from '../level/mask.js';
import { glowMat, scene } from '../render/scene.js';
import { localToWorld, SHIP_RADIUS, ships } from './ship.js';
import { addShake, damage, shipMass } from './physics.js';
import { WHITE } from '../fx/pools.js';
import { terrainDebris } from '../fx/debris.js';
import { emit } from '../fx/particles.js';
import { DINO, DINO_S, killDino } from '../maps/forest/dino.js';
import { killWorm, WORM, WORM_R } from '../maps/desert/worm.js';
import { hitBreakable } from '../maps/floors.js';
import { killEnemy, segDist, SH } from '../maps/starship/starship.js';
import { RB } from '../maps/hangar/hangar.js';
import { hurtRobot } from '../maps/hangar/robot.js';
import { sfx } from '../audio/sfx.js';
import { animateWeaponBox, updateWeaponButtons } from '../ui/weaponBox.js';

/* ------------------------------------------------------------------ *
 * The Big laser: weapon 4. One shot per match, and dying does not give it back.
 * ------------------------------------------------------------------ */
export const BIG = { charge: 0.35, fire: 0.75, width: 44, damage: 90, enemyDamage: 260, push: 380 };
const LASER_IDX = WEAPONS.findIndex((w) => w.id === 'laser');
export const bigFree = () => isPractice() && PR.infiniteAmmo;   // Practice with infinite ammo: fire it as often as you like
const pbeams = ships.map((s) => {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0.5, 0, 0);
  const add = (mat, z) => { const m = new THREE.Mesh(geo, mat); m.position.z = z; m.frustumCulled = false; m.visible = false; scene.add(m); return m; };
  const glow = add(new THREE.MeshBasicMaterial({ color: s.hex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 2.5);
  const core = add(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 2.55);
  const orb = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat(s.color, 0.95));
  orb.position.z = 2.6; orb.frustumCulled = false; orb.visible = false;
  scene.add(orb);
  return { glow, core, orb };
});
export function fireBigLaser(s) {
  if (s.beam || (!(s.bigLaser > 0) && !bigFree())) return;
  if (!bigFree()) s.bigLaser = 0;
  sfx.laserCharge(s);
  s.beam = { phase: 'charge', t: BIG.charge, hit: new Set(), len: 0, ox: s.x, oy: s.y, ang: s.a + Math.PI / 2, carveT: 0 };
  s.fireCd = 0.4;
  updateWeaponButtons();
}
export function stepBigLaser(s, h) {
  const b = s.beam;
  if (!b) return;
  const nose = localToWorld(s, 0, 13);
  b.ox = nose.x; b.oy = nose.y; b.ang = s.a + Math.PI / 2;   // follows the nose, so you can sweep it
  b.t -= h;
  s.fireCd = Math.max(s.fireCd, 0.1);
  if (b.phase === 'charge') {
    const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 20;
    emit(b.ox + Math.cos(a) * r, b.oy + Math.sin(a) * r, -Math.cos(a) * r * 3 + s.vx, -Math.sin(a) * r * 3 + s.vy, 0.3, Math.random() < 0.5 ? s.color : WHITE, 0, 3 + Math.random() * 3);
    if (b.t <= 0) {
      b.phase = 'fire';
      b.t = BIG.fire;
      sfx.laserFire(s);
      addShake(s, 1.4);
      for (const o of ships) if (o !== s && o.active) addShake(o, 0.6);
      const m = shipMass(s);
      s.vx -= Math.cos(b.ang) * BIG.push / m; s.vy -= Math.sin(b.ang) * BIG.push / m;
      s.landed = false;
    }
    return;
  }
  // The beam burns through rock (digging a tunnel) and stops at hard walls and pads.
  const dx = Math.cos(b.ang), dy = Math.sin(b.ang);
  let d = 0;
  while (d < 2200) {
    const v = maskAt(b.ox + dx * d, b.oy + dy * d);
    if (v === 2 || v === 3 || (v === 1 && !P.destructible)) break;
    d += 5;
  }
  b.len = d;
  if (level.theme === 'floors') hitBreakable(b.ox + dx * (d + 3), b.oy + dy * (d + 3));
  b.carveT -= h;
  if (b.carveT <= 0 && P.destructible && level.theme !== 'floors') {
    b.carveT = 0.06;
    for (let t = 8; t < d; t += 14) {
      const x = b.ox + dx * t, y = b.oy + dy * t;
      if (solidAt(x, y) || solidAt(x + dy * 18, y - dx * 18) || solidAt(x - dy * 18, y + dx * 18)) { if (Math.random() < 0.05) terrainDebris(x, y, 0.5); carve(x, y, BIG.width * 0.5); }
    }
  }
  const half = BIG.width / 2;
  if (level.theme === 'desert' && WORM.state === 'fly' && segDist(WORM.hx, WORM.hy, b.ox, b.oy, b.ang, d) < half + WORM_R) killWorm();
  if (level.theme === 'forest' && DINO.active && segDist(DINO.x, DINO.y + 36 * DINO_S, b.ox, b.oy, b.ang, d) < half + 40 * DINO_S) killDino();
  for (const o of ships) {
    if (o === s || !o.active || !o.alive || b.hit.has(o) || level.theme === 'floors' || level.theme === 'ship') continue;
    if (segDist(o.x, o.y, b.ox, b.oy, b.ang, d) < half + SHIP_RADIUS * P.shipSize * 0.8) {
      b.hit.add(o);
      damage(o, BIG.damage);
      const m = shipMass(o);
      o.vx += dx * 320 / m; o.vy += dy * 320 / m;
      o.landed = false;
      for (let j = 0; j < 20; j++) emit(o.x, o.y, (Math.random() - 0.5) * 260, (Math.random() - 0.5) * 260, 0.4, j % 2 ? s.color : WHITE, 0.2, 4);
    }
  }
  if (level.theme === 'ship') {
    for (const e of SH.enemies) {
      if (e.dead || b.hit.has(e)) continue;
      if (segDist(e.x, e.y, b.ox, b.oy, b.ang, d) < half + e.K.r) {
        b.hit.add(e);
        e.hp -= BIG.enemyDamage;
        e.flash = 0.15;
        if (e.hp <= 0) killEnemy(e, s);
      }
    }
    if (SH.spec && SH.spec.mode === 'robot' && RB.on && !RB.dead && !b.hit.has(RB) && segDist(RB.x, RB.y + 300, b.ox, b.oy, b.ang, d) < half + 120) {
      b.hit.add(RB);
      hurtRobot(BIG.enemyDamage, s);
    }
  }
  const ex = b.ox + dx * d, ey = b.oy + dy * d;
  for (let j = 0; j < 3; j++) emit(ex, ey, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, 0.35, j % 2 ? s.color : WHITE, 0.3, 4 + Math.random() * 4);
  if (b.t <= 0) {
    s.beam = null;
    if (s.weapon === LASER_IDX && !bigFree()) { s.weapon = 0; animateWeaponBox(s.id, LASER_IDX, 0); updateWeaponButtons(); }
  }
}
export function drawBigLasers(now) {
  ships.forEach((s, i) => {
    const pb = pbeams[i], b = s.alive ? s.beam : null;
    pb.orb.visible = !!b;
    pb.glow.visible = pb.core.visible = !!b && b.phase === 'fire';
    if (!b) return;
    const k = b.phase === 'charge' ? 1 - b.t / BIG.charge : 1;
    pb.orb.position.set(b.ox, b.oy, 2.6);
    pb.orb.scale.setScalar(b.phase === 'charge' ? 14 + 50 * k : 70 + 10 * Math.sin(now / 30));
    if (b.phase !== 'fire') return;
    const fade = Math.min(1, b.t / 0.15);
    for (const [m, w, op] of [[pb.glow, BIG.width + 26, 0.6], [pb.core, BIG.width * 0.42, 1]]) {
      m.position.set(b.ox, b.oy, m.position.z);
      m.rotation.z = b.ang;
      m.scale.set(Math.max(1, b.len), w * (0.85 + 0.15 * Math.sin(now / 25)) * fade, 1);
      m.material.opacity = op;
    }
  });
}
