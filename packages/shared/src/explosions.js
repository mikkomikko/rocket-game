import { isPractice, P, PR, SHARD_IDX, WEAPONS } from './config.js';
import { B, spawnBullet } from './bullets.js';
import { carve } from './level/mask.js';
import { simEvent } from './events.js';
import { mapRules } from './maps.js';
import { random } from './random.js';
import { ships } from './ships/ship.js';
import { addShake, damage, shipMass } from './ships/physics.js';

// Hits that dig, freeze and blast: what a shot does where it lands.
export function freezeShip(s) {
  if (!s.alive || s.invulnT > 0 || (isPractice() && PR.noDamage)) return;
  s.frozenT = WEAPONS[2].freeze;
  s.thrust = 0; s.av = 0;
  simEvent('frozen', s);
  addShake(s, 0.4);
}
// A Cannon shell or a missile (kind): a big crater, splash damage and a shove for any ship nearby.
function bigBlast(x, y, kind, owner, direct) {
  const wp = WEAPONS[kind], map = mapRules(), big = wp.blast / 64;
  if (map.breakAt) { for (let k = 0, n = kind === 1 ? 6 : 3; k < n; k++) map.breakAt(x + (random() - 0.5) * 30, y + (random() - 0.5) * 30); }
  else if (P.destructible) carve(x, y, P.holeRadius * wp.hole);
  const R = wp.blast;
  for (const s of ships) {
    if (!s.active || !s.alive || s === direct) continue;
    if (map.coop && owner < 2) continue;
    const ddx = s.x - x, ddy = s.y - y, d = Math.hypot(ddx, ddy);
    if (d > R) continue;
    const f = 1 - d / R;   // falloff; your own ship takes half
    damage(s, P.bulletDamage * wp.damage * 0.6 * f * (s.id === owner ? 0.5 : 1));
    const m = shipMass(s), push = (wp.push ?? 260) * f / m;
    s.vx += (ddx / (d || 1)) * push; s.vy += (ddy / (d || 1)) * push;
    s.landed = false;
  }
  map.blastHit?.(x, y, R, owner, P.bulletDamage * wp.damage * 0.5);
  for (const s of ships) if (s.active && s.alive) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < 500) addShake(s, 1.1 * big * (1 - d / 500));
  }
  simEvent('blast', x, y, kind);
}
// A frag grenade bursts: shards fly out every way at once, evenly spaced with a little seeded jitter.
// Each is a bullet of its own (SHARD_IDX) that hits whatever it meets, the grenade's owner excepted.
function fragBurst(x, y, kind, owner) {
  const f = WEAPONS[kind].frag;
  const a0 = random() * Math.PI * 2;
  for (let k = 0; k < f.n; k++) {
    const a = a0 + (k + (random() - 0.5) * 0.7) * Math.PI * 2 / f.n;
    const sp = P.bulletSpeed * f.speed * (0.75 + random() * 0.5);
    const i = spawnBullet(owner, x, y, Math.cos(a) * sp, Math.sin(a) * sp, P.bulletLife * f.life * (0.7 + random() * 0.6), SHARD_IDX);
    if (i >= 0) B.seq[i] = 0;   // not a shot the player fired: online play must not mistake it for one
  }
  simEvent('fragBurst', x, y, owner);
}
// A shot hits terrain (kind = weapon index). simEvent 'explosion' comes first, while the rock is still there.
export function explode(x, y, kind = 0, owner = -1, direct = null) {
  simEvent('explosion', x, y, kind);
  const wp = WEAPONS[kind];
  if (wp?.blast) bigBlast(x, y, kind, owner, direct);
  if (wp?.frag) fragBurst(x, y, kind, owner);
  if (wp?.blast) return;
  if (mapRules().breakAt) mapRules().breakAt(x, y);   // Floors walls can't be shot; only the orange blocks break
  else if (P.destructible) carve(x, y, P.holeRadius * (wp?.hole || 1));   // a shard chips a smaller hole
}
