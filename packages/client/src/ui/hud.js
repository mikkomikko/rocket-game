import { DEG, isPractice, isSolo, P } from '../config.js';
import { game } from '../state.js';
import { clamp, wrapAngle } from '../util/math.js';
import { level } from '../level/mask.js';
import { MAPS } from '../level/terrain.js';
import { ships } from '../ships/ship.js';
import { MINIGUN_TIME } from '../maps/forest/pickup.js';
import { FL } from '../maps/floors.js';
import { WAVES } from '../maps/starship/constants.js';
import { SH } from '../maps/starship/starship.js';
import { appEl } from './header.js';

/* HUD */
const floorOf = (s) => clamp(Math.floor((s.y - 300) / 400) + 2, 1, 10);
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
  const prac = isSolo();
  for (let i = 0; i < 2; i++) {
    const m = mini.players[i], s = ships[i];
    const show = !!s && !(prac && i === 1);
    setMP(m, 'show', show, (v) => { m.el.hidden = !v; });
    if (!show) continue;
    setMP(m, 'tag', prac ? '' : `P${i + 1}`, (v) => { m.tag.textContent = v; });
    const hp = s.alive ? Math.round(clamp(s.hp / 100, 0, 1) * 1000) / 10 : 0;
    // hue 120 = green at full health, 60 = yellow at half, 0 = red when empty
    setMP(m, 'hp', hp, (v) => { m.hp.style.width = `${v}%`; m.hp.style.backgroundColor = `hsl(${Math.round(v * 1.2)} 78% 50%)`; });
    const gun = s.alive && s.minigunT > 0;
    const am = gun ? s.minigunT / MINIGUN_TIME : clamp(s.ammo / P.ammoMax, 0, 1);
    setMP(m, 'ammo', Math.round(am * 1000) / 10, (v) => { m.ammo.style.width = `${v}%`; });
    setMP(m, 'gun', gun, (v) => { m.el.classList.toggle('minigun', v); });
    setMP(m, 'dead', !s.alive, (v) => { m.el.classList.toggle('dead', v); });
    setMP(m, 'note', !s.alive ? 'Respawning' : gun ? 'Minigun' : s.crossT > 0 ? `Crosshair ${Math.ceil(s.crossT)} s` : '', (v) => { m.note.textContent = v; });
  }
  let lv;
  if (level.theme === 'ship' && SH.state !== 'off') {
    const next = SH.wave + 1;
    if (SH.spec.mode === 'robot') lv = SH.state === 'done' ? 'Level: robot destroyed!' : 'Level: giant robot';
    else if (SH.state === 'fight') lv = WAVES[SH.wave].boss ? 'Level: boss' : `Level ${SH.wave + 1} of ${WAVES.length - 1}`;
    else if (SH.state === 'choose') lv = 'Level: choose 1 to 5';
    else if (SH.state === 'escape') lv = 'Level: escape!';
    else if (SH.state === 'done') lv = 'Level: escaped!';
    else lv = WAVES[next] && WAVES[next].boss ? 'Level: boss next' : `Level ${next + 1} next`;
  } else if (level.theme === 'floors') lv = `Level: floor ${floorOf(ships[0])} · floor ${floorOf(ships[1])}`;
  else lv = `Level: ${isPractice() ? 'Practice' : (MAPS[level.builtMap] || MAPS.cave).name}`;
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
  if (appEl.classList.contains('ui-hidden')) updateMiniHud();
  for (const s of ships) {
    const h = huds[s.id];
    setIfChanged(h, 'score', h.score, 'text', String(s.score));
    setIfChanged(h, 'hull', h.hull, 'transform', `scaleX(${(s.hp / 100).toFixed(3)})`);
    setIfChanged(h, 'ammo', h.ammo, 'transform', `scaleX(${clamp(s.ammo / P.ammoMax, 0, 1).toFixed(3)})`);
    let status = '';
    const back = `Back in ${Math.max(0, s.respawnT).toFixed(1)} s`;
    if (!s.alive) status = s.eaten ? `${level.theme === 'desert' ? 'Swallowed by the sandworm!' : 'Eaten by the dino!'} ${back}` : s.lava ? `Burned in the lava! ${back}` : back;
    else if (s.landed && s.onPad) status = (s.hp < 99.5 || s.ammo < P.ammoMax - 0.5) ? 'Rearming on the pad' : 'Ready on the pad';
    else if (s.landed) status = 'Landed';
    else if (s.invulnT > 0) status = 'Shielded';
    if (s.alive && level.theme === 'floors') {
      status = `Floor ${floorOf(s)} of 10 · lava ${Math.max(0, Math.round(s.y - FL.lava[s.id]))} below`;
    }
    if (s.alive && s.minigunT > 0) status = `Minigun! ${Math.ceil(s.minigunT)} s left`;
    if (s.alive && s.crossT > 0 && !status.startsWith('Minigun')) status = status ? `${status} · crosshair ${Math.ceil(s.crossT)} s` : `Crosshair ${Math.ceil(s.crossT)} s left`;
    if (s.alive && s.frozenT > 0) status = `Frozen! ${s.frozenT.toFixed(1)} s`;
    if (s.alive && s.ballT > 0) status = `Trapped in a ball! ${s.ballT.toFixed(1)} s`;
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
