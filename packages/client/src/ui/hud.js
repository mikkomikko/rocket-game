import { DEG, isPractice, isSolo, MINIGUN_TIME, P } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { clamp, wrapAngle } from '@rocket-duel/shared/math.js';
import { level } from '@rocket-duel/shared/level/mask.js';
import { MAPS } from '@rocket-duel/shared/level/terrain.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { appEl } from './header.js';
import { activeMap } from '../maps/index.js';
import { updateVictory } from './victory.js';

/* HUD */
// The small top-centre panel shown while the UI is hidden: health bar, ammo strip and level.
const mini = {
  players: [0, 1].map((i) => {
    const el = document.querySelector(`.mh-p[data-p="${i}"]`);
    return { el, tag: el.querySelector('.mh-tag'), hp: el.querySelector('.mh-hp > i'), ammo: el.querySelector('.mh-ammo > i'), note: el.querySelector('.mh-note'), last: {} };
  }),
  level: document.getElementById('miniLevel'), last: {},
};
function setMini(key, value) {
  if (mini.last[key] === value) return;
  mini.last[key] = value;
  mini[key].textContent = value;
}
function setMP(m, key, value, apply) {
  if (m.last[key] === value) return;
  m.last[key] = value;
  apply(value);
}
function updateMiniHud() {
  const alone = isSolo() && !ships[1].active, cpu = game.mode === 'solo' && !alone;
  for (let i = 0; i < 2; i++) {
    const m = mini.players[i], s = ships[i];
    const show = !!s && !(alone && i === 1);
    setMP(m, 'show', show, (v) => { m.el.hidden = !v; });
    if (!show) continue;
    setMP(m, 'tag', alone ? '' : cpu ? (i ? 'CPU' : 'You') : `P${i + 1}`, (v) => { m.tag.textContent = v; });
    const hp = s.alive ? Math.round(clamp(s.hp / 100, 0, 1) * 1000) / 10 : 0;
    // hue 120 = green at full health, 60 = yellow at half, 0 = red when empty
    setMP(m, 'hp', hp, (v) => { m.hp.style.width = `${v}%`; m.hp.style.backgroundColor = `hsl(${Math.round(v * 1.2)} 78% 50%)`; });
    const gun = s.alive && s.minigunT > 0;
    const am = gun ? s.minigunT / MINIGUN_TIME : clamp(s.ammo / P.ammoMax, 0, 1);
    setMP(m, 'ammo', Math.round(am * 1000) / 10, (v) => { m.ammo.style.width = `${v}%`; });
    setMP(m, 'gun', gun, (v) => { m.el.classList.toggle('minigun', v); });
    setMP(m, 'dead', !s.alive, (v) => { m.el.classList.toggle('dead', v); });
    setMP(m, 'note', !s.alive ? 'Respawning' : gun ? 'Minigun' : '', (v) => { m.note.textContent = v; });
  }
  const lv = activeMap().hudLevel?.() || `Level: ${isPractice() ? 'Practice' : (MAPS[level.builtMap] || MAPS.cave).name}`;
  setMini('level', lv);
}
const huds = [...document.querySelectorAll('.hud')].map((el) => ({
  score: el.querySelector('.hud-score'), hull: el.querySelector('.meter-fill.hull'), ammo: el.querySelector('.meter-fill.ammo'),
  status: el.querySelector('.hud-status'), pad: el.querySelector('.hud-pad'), tele: el.querySelector('.hud-tele'), last: {},
}));
function setIfChanged(h, key, el, prop, value) {
  if (h.last[key] === value) return;
  h.last[key] = value;
  if (prop === 'text') el.textContent = value; else el.style[prop] = value;
}
export function updateHud() {
  updateVictory();
  if (appEl.classList.contains('ui-hidden')) updateMiniHud();
  for (const s of ships) {
    const h = huds[s.id];
    setIfChanged(h, 'score', h.score, 'text', String(s.score));
    setIfChanged(h, 'hull', h.hull, 'transform', `scaleX(${(s.hp / 100).toFixed(3)})`);
    setIfChanged(h, 'ammo', h.ammo, 'transform', `scaleX(${clamp(s.ammo / P.ammoMax, 0, 1).toFixed(3)})`);
    let status = '';
    const back = `Back in ${Math.max(0, s.respawnT).toFixed(1)} s`;
    if (!s.alive) status = s.eaten ? `${activeMap().eatenText || 'Eaten by the dino!'} ${back}` : s.lava ? `Burned in the lava! ${back}` : back;
    else if (s.landed && s.onPad) status = (s.hp < 99.5 || s.ammo < P.ammoMax - 0.5) ? 'Rearming on the pad' : 'Ready on the pad';
    else if (s.landed) status = 'Landed';
    else if (s.invulnT > 0) status = 'Shielded';
    if (s.alive && activeMap().shipStatus) status = activeMap().shipStatus(s);
    if (s.alive && s.minigunT > 0) status = `Minigun! ${Math.ceil(s.minigunT)} s left`;
    if (s.alive && s.frozenT > 0) status = `Frozen! ${s.frozenT.toFixed(1)} s`;
    if (s.alive && s.msgUntil > game.time) status = s.msg;
    setIfChanged(h, 'status', h.status, 'text', status);
    if (isPractice() && h.tele) {
      const tilt = Math.round(wrapAngle(s.a) / DEG);
      setIfChanged(h, 'tele', h.tele, 'text',
        `Speed ${Math.round(Math.hypot(s.vx, s.vy))}  ·  vx ${Math.round(s.vx)}  ·  vy ${Math.round(s.vy)}\n` +
        `Tilt ${tilt}°  ·  Thrust ${Math.round(s.thrust * 100)} %\n` +
        `Last impact ${Math.round(s.lastImpact)}  ·  safe ≤ ${P.safeImpact}`);
    }
    const idx = s.id === 0 ? P.p1Pad : P.p2Pad;
    setIfChanged(h, 'pad', h.pad, 'text', s.padActive ? `Gamepad ${idx + 1}: stick turns, A thrusts, X fires, Y switches weapon` : '');
  }
}
