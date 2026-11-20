import * as THREE from 'three';
import { P } from '@rocket-duel/shared/config.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { onSim } from '@rocket-duel/shared/events.js';
import { localToWorld, ships } from '@rocket-duel/shared/ships/ship.js';
import { B, MAXB } from '@rocket-duel/shared/bullets.js';
import { BIG } from '@rocket-duel/shared/ships/bigLaser.js';
import { views } from '../ships/view.js';
import { BALL_COL, DUST, EMBER, FIRE, ICE_COL, WHITE } from './pools.js';
import { TR, trailPoint } from './trails.js';
import { spray, surfaceAt, terrainDebris, terrainMaterial } from './debris.js';
import { emit } from './particles.js';
import { emitSmoke, SM } from './smoke.js';
import { groundRGB } from '../maps/index.js';
import { sfx } from '../audio/sfx.js';
import { animateWeaponBox, updateWeaponButtons } from '../ui/weaponBox.js';

/* ------------------------------------------------------------------ *
 * Effects: the sounds, particles, camera shake and UI updates for what the simulation reports
 * (see @rocket-duel/shared/events.js), plus the looks that run every step (exhaust, trails, frost).
 * ------------------------------------------------------------------ */
function shake(s, amount) { const c = views[s.id].cam; c.shake = Math.max(c.shake, amount * P.shake); }

// Ice shots don't dig: they shatter into frost.
export function iceBurst(x, y, n) {
  sfx.tink(x, y);
  for (let j = 0; j < n; j++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 130;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.4, j % 3 ? ICE_COL : WHITE, 0.6, 2 + Math.random() * 3);
  }
  emit(x, y, 0, 0, 0.15, ICE_COL, 0, 16);
}
export function ballPop(x, y, n) {
  for (let j = 0; j < n; j++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 140;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.35 + Math.random() * 0.3, j % 3 ? BALL_COL : WHITE, 0.3, 2.5 + Math.random() * 2.5);
  }
}
export function dust(x, y, n, impact) {
  const rc = groundRGB(y);
  DUST.setRGB(rc[0] / 255 * 1.6, rc[1] / 255 * 1.6, rc[2] / 255 * 1.6, THREE.SRGBColorSpace);
  const count = Math.min(14, 3 + impact / 30);
  for (let j = 0; j < count; j++) {
    const sp = 20 + Math.random() * impact * 0.4;
    emit(x, y, n.x * sp + (Math.random() - 0.5) * 80, n.y * sp + (Math.random() - 0.5) * 80, 0.4 + Math.random() * 0.4, DUST, 1);
  }
  const sf = surfaceAt(x, y);
  spray(x, y, n.x, n.y, terrainMaterial(sf.hard), clamp(impact / 350, 0.15, 0.7));
}

onSim('shake', shake);
onSim('sound', (name, ...args) => sfx[name](...args));
onSim('dust', dust);
onSim('ballPop', ballPop);
onSim('iceBurst', iceBurst);
onSim('bulletEnd', (i) => trailPoint(i, true));
onSim('bulletsCleared', () => { SM.on.fill(0); TR.life.fill(0); });

onSim('killed', (s, how) => {
  if (how === 'eaten') { sfx.bump(s, 400); return; }
  sfx.death(s);
  if (how === 'lava') {
    for (let i = 0; i < 40; i++) emit(s.x + (Math.random() - 0.5) * 20, s.y, (Math.random() - 0.5) * 160, 80 + Math.random() * 220, 0.5 + Math.random() * 0.7, i % 2 ? FIRE : EMBER, 0.6, 3 + Math.random() * 5);
    for (let i = 0; i < 5; i++) emitSmoke(s.x, s.y + 10, (Math.random() - 0.5) * 30, 30 + Math.random() * 30, 1.5 + Math.random(), 8 + Math.random() * 6);
    shake(s, 1.2);
    return;
  }
  const color = views[s.id].color;
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 260;
    emit(s.x, s.y, s.vx * 0.4 + Math.cos(a) * sp, s.vy * 0.4 + Math.sin(a) * sp, 0.5 + Math.random() * 0.9, i % 3 ? color : FIRE, 0.4, 3 + Math.random() * 5);
  }
  emit(s.x, s.y, 0, 0, 0.35, color, 0, 70);
  emit(s.x, s.y, 0, 0, 0.2, WHITE, 0, 34);
  if (P.smoke) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = 15 + Math.random() * 70;
      emitSmoke(s.x, s.y, Math.cos(a) * sp + s.vx * 0.2, Math.sin(a) * sp + s.vy * 0.2, P.smokeLife * (0.8 + Math.random() * 0.6), 12 + Math.random() * 10);
    }
  }
  terrainDebris(s.x, s.y, 1.6);
  shake(s, 1.6);
  const other = ships[1 - s.id];
  if (other.active) shake(other, 0.4);
});
onSim('respawned', (s) => {
  const v = views[s.id];
  v.cam.x = s.x; v.cam.y = s.y;
  v.group.visible = true;
  sfx.respawn(s);
});
onSim('touchdown', (s, x, y, n, impact) => { dust(x, y, n, impact * 0.5); sfx.bump(s, impact * 0.4); });
onSim('crash', (s, x, y, n, impact) => { shake(s, Math.min(1, impact / 400)); dust(x, y, n, impact); sfx.bump(s, impact); });
onSim('thawed', (s) => {
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
    emit(s.x, s.y, s.vx * 0.3 + Math.cos(a) * sp, s.vy * 0.3 + Math.sin(a) * sp, 0.4 + Math.random() * 0.4, i % 2 ? ICE_COL : WHITE, 0.8, 2 + Math.random() * 3);
  }
});
onSim('frozen', (s) => { sfx.frost(s); iceBurst(s.x, s.y, 22); });

onSim('fired', (s, id, nose, ang) => {
  const dx = -Math.sin(ang), dy = Math.cos(ang);
  if (id === 'heavy') {
    sfx.cannon(s);
    for (let i = 0; i < 14; i++) {
      const a = ang + (Math.random() - 0.5) * 1.2, sp = 60 + Math.random() * 160;
      emit(nose.x, nose.y, -Math.sin(a) * sp + s.vx, Math.cos(a) * sp + s.vy, 0.2 + Math.random() * 0.2, i % 2 ? FIRE : EMBER, 0.2, 4 + Math.random() * 4);
    }
    if (P.smoke) for (let i = 0; i < 4; i++) emitSmoke(nose.x, nose.y, dx * 40 + s.vx * 0.3 + (Math.random() - 0.5) * 30, dy * 40 + s.vy * 0.3 + (Math.random() - 0.5) * 30, P.smokeLife * 0.6, 9 + Math.random() * 6);
    emit(nose.x, nose.y, s.vx, s.vy, 0.12, WHITE, 0, 30);
  } else {
    if (id === 'ice') sfx.freezer(s); else sfx.shoot(s);
    emit(nose.x, nose.y, dx * 80 + s.vx, dy * 80 + s.vy, 0.09, id === 'ice' ? ICE_COL : id === 'ball' ? BALL_COL : views[s.id].color, 0, id === 'ice' || id === 'ball' ? 16 : 12);
  }
});
// The little box by the ship slides the old weapon out and the new one in.
onSim('weaponChanged', (s, prev, next, quiet) => {
  animateWeaponBox(s.id, prev, next);
  if (!quiet) sfx.swap();
  updateWeaponButtons();
});
onSim('laserCharge', (s) => { sfx.laserCharge(s); updateWeaponButtons(); });
onSim('beamDig', (x, y) => { if (Math.random() < 0.05) terrainDebris(x, y, 0.5); });
onSim('laserHitShip', (s, o) => {
  for (let j = 0; j < 20; j++) emit(o.x, o.y, (Math.random() - 0.5) * 260, (Math.random() - 0.5) * 260, 0.4, j % 2 ? views[s.id].color : WHITE, 0.2, 4);
});
onSim('shipHit', (x, y, s, kind) => {
  for (let j = 0; j < 8; j++) emit(x, y, (Math.random() - 0.5) * 180, (Math.random() - 0.5) * 180, 0.3, j % 2 ? (kind === 2 ? ICE_COL : views[s.id].color) : WHITE, 0.2);
});
onSim('explosion', (x, y, kind) => {
  if (kind !== 1) sfx.rock(x, y);
  terrainDebris(x, y, kind === 1 ? 2.6 : 1);
  const rc = groundRGB(y);
  DUST.setRGB(rc[0] / 255 * 1.6, rc[1] / 255 * 1.6, rc[2] / 255 * 1.6, THREE.SRGBColorSpace);
  emit(x, y, 0, 0, 0.14, EMBER, 0, 18);
  for (let j = 0; j < 7; j++) {
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 140;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 + Math.random() * 0.3, j % 2 ? FIRE : EMBER, 0.3);
  }
});
// The Cannon shell going off.
onSim('blast', (x, y) => {
  sfx.blast(x, y);
  emit(x, y, 0, 0, 0.22, WHITE, 0, 60);
  emit(x, y, 0, 0, 0.35, FIRE, 0, 110);
  for (let j = 0; j < 40; j++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 320;
    emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.35 + Math.random() * 0.6, j % 3 ? FIRE : EMBER, 0.5, 3 + Math.random() * 6);
  }
  if (P.smoke) for (let j = 0; j < 12; j++) {
    const a = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 80;
    emitSmoke(x, y, Math.cos(a) * sp, Math.sin(a) * sp, P.smokeLife * (0.7 + Math.random() * 0.5), 14 + Math.random() * 12);
  }
});

// Looks that run once per simulation step, after it: exhaust, frost, the Big laser's sparks, bullet trails.
export function stepEffects(h) {
  for (const s of ships) {
    if (!s.active || !s.alive || s.ballT > 0) continue;
    if (s.frozenT > 0) {
      if (Math.random() < 0.25) {
        const a = Math.random() * Math.PI * 2;
        emit(s.x + Math.cos(a) * 12, s.y + Math.sin(a) * 12, s.vx * 0.5 + Math.cos(a) * 20, s.vy * 0.5 + Math.sin(a) * 20, 0.5, ICE_COL, 0.3, 2.5 + Math.random() * 2);
      }
      continue;
    }
    const v = views[s.id], b = s.beam;
    if (b && (b.phase === 'charge' || b.t === BIG.fire)) {   // charging (including the step it fires)
      const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 20;
      emit(b.ox + Math.cos(a) * r, b.oy + Math.sin(a) * r, -Math.cos(a) * r * 3 + s.vx, -Math.sin(a) * r * 3 + s.vy, 0.3, Math.random() < 0.5 ? v.color : WHITE, 0, 3 + Math.random() * 3);
    } else if (b) {
      const ex = b.ox + Math.cos(b.ang) * b.len, ey = b.oy + Math.sin(b.ang) * b.len;
      for (let j = 0; j < 3; j++) emit(ex, ey, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, 0.35, j % 2 ? v.color : WHITE, 0.3, 4 + Math.random() * 4);
    }
    const fx = -Math.sin(s.a), fy = Math.cos(s.a);
    if (s.thrust > 0.05 && Math.random() < s.thrust * 0.9) {
      const t = localToWorld(s, 0, -7);
      const sp = 120 + Math.random() * 120;
      emit(t.x, t.y, s.vx - fx * sp + (Math.random() - 0.5) * 50, s.vy - fy * sp + (Math.random() - 0.5) * 50, 0.25 + Math.random() * 0.25, Math.random() < 0.5 ? FIRE : EMBER, 0.2, 3 + Math.random() * 3);
    }
    if (P.smoke && s.thrust > 0.02) {
      v.smokeAcc += P.smokeRate * s.thrust * h;
      while (v.smokeAcc >= 1) {
        v.smokeAcc -= 1;
        const t = localToWorld(s, (Math.random() - 0.5) * 3, -10);
        const sp = 30 + Math.random() * 40;
        emitSmoke(t.x, t.y, s.vx * 0.25 - fx * sp + (Math.random() - 0.5) * 24, s.vy * 0.25 - fy * sp + (Math.random() - 0.5) * 24,
          P.smokeLife * (0.75 + Math.random() * 0.5), (7 + Math.random() * 5) * P.shipSize);
      }
    }
  }
  for (let i = 0; i < MAXB; i++) {
    if (!B.on[i]) continue;
    const kind = B.kind[i];
    if (kind === 1 && P.smoke && Math.random() < 0.5) emitSmoke(B.x[i], B.y[i], (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, P.smokeLife * 0.35, 5 + Math.random() * 3);
    if (kind === 2 && Math.random() < 0.35) emit(B.x[i], B.y[i], (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.35, ICE_COL, 0.2, 2 + Math.random() * 2);
    trailPoint(i, false);
  }
}
