import { game } from '@rocket-duel/shared/state.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { winTarget } from '@rocket-duel/shared/victory.js';
import { reducedMotion } from '../config.js';
import { restartMatch } from '../game/modes.js';
import { askRematch, net } from '../net/online.js';

/* ------------------------------------------------------------------ *
 * The match to P.winsToWin: a circle per win beside each player's name (filled as they win), and the
 * card when someone takes the match, with stars bursting out from behind it. Online or against the CPU,
 * the winner sees "Victory!" and the loser "Defeat"; online either player can start the next match.
 * With one view (online, or against the CPU) your panel also shows the opponent's wins.
 * ------------------------------------------------------------------ */
const oppNames = [...document.querySelectorAll('.hud-opp-name')];
let oppName = '';
const pipSets = [...document.querySelectorAll('.wins')].map((el) => ({
  el, p: +el.closest('[data-p]').dataset.p, hud: el.closest('.hud'), key: '', have: 0,
}));

// You and the other ship, when one person plays: online, or against the CPU. null in split screen.
const myShip = () => (net.online ? net.id : game.mode === 'solo' ? 0 : null);

function updatePips() {
  const need = winTarget();
  const name = net.online ? 'Opponent' : 'CPU';
  if (name !== oppName) { oppName = name; for (const el of oppNames) el.textContent = name; }
  for (const set of pipSets) {
    const s = ships[set.p];
    const have = Math.min(need, s?.score ?? 0);
    const key = `${need}:${have}`;
    if (key === set.key) continue;
    const gained = set.key && have === set.have + 1;   // one more win: that circle pops in
    set.key = key; set.have = have;
    set.el.hidden = !need;
    set.hud?.classList.toggle('has-wins', !!need);
    if (!need) continue;
    set.el.innerHTML = Array.from({ length: need }, (_, i) => `<i class="${i < have ? 'on' : ''}${gained && i === have - 1 ? ' pop' : ''}"></i>`).join('');
    set.el.setAttribute('aria-label', `${have} of ${need} wins`);
  }
}

/* The card */
const card = {
  el: document.getElementById('victory'), title: document.getElementById('victoryTitle'),
  score: document.getElementById('victoryScore'), again: document.getElementById('victoryAgain'), shown: -1,
};
export const victoryOpen = () => !card.el.hidden;

export function playAgain() {
  if (!victoryOpen()) return;
  if (net.online) askRematch(); else restartMatch();
}
card.again.addEventListener('click', playAgain);

function showCard(winner) {
  card.shown = winner;
  if (winner < 0) { card.el.hidden = true; stopStars(); return; }
  const w = ships[winner], l = ships[1 - winner];
  const me = myShip(), lost = me !== null && winner !== me;
  const tally = `${w.score} – ${l.score}`;
  card.title.textContent = lost ? 'Defeat' : 'Victory!';
  card.score.textContent = me === null ? `Player ${winner + 1} wins ${tally}`
    : lost ? `You lose ${l.score} – ${w.score}` : `You win ${tally}`;
  card.el.classList.toggle('lost', lost);
  card.el.style.setProperty('--win', `var(--p${winner + 1})`);
  card.el.hidden = false;
  card.again.focus({ preventScroll: true });
  if (!lost) startStars(winner);
}

export function updateVictory() {
  updatePips();
  const winner = winTarget() ? game.winner : -1;
  if (winner !== card.shown) showCard(winner);
}

/* Stars: they burst out from behind the card, then keep coming while it is open. */
const cv = document.getElementById('victoryStars');
const ctx = cv.getContext('2d');
const stars = [];
let raf = 0, lastT = 0, colors = [], emitAcc = 0;

function addStar(cx, cy, fast) {
  const a = Math.random() * Math.PI * 2, sp = (fast ? 240 : 110) + Math.random() * (fast ? 360 : 170);
  stars.push({
    x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
    r: 4 + Math.random() * 9, rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 6,
    life: 0, max: 1.4 + Math.random() * 1.4, color: colors[(Math.random() * colors.length) | 0],
  });
}
function drawStar(x, y, r, rot) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 ? r * 0.45 : r, a = rot + (k * Math.PI) / 5;
    ctx.lineTo(x + Math.sin(a) * rr, y - Math.cos(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}
function startStars(winner) {
  const css = getComputedStyle(document.documentElement);
  colors = [css.getPropertyValue(`--p${winner + 1}`).trim() || '#ffe066', '#ffe066', '#ffffff'];
  stars.length = 0;
  cancelAnimationFrame(raf);
  const { w, h } = sizeCanvas();
  ctx.clearRect(0, 0, w, h);
  if (reducedMotion) {   // a still scatter of stars instead of a burst
    for (let k = 0; k < 28; k++) {
      ctx.fillStyle = colors[k % colors.length];
      ctx.globalAlpha = 0.5 + Math.random() * 0.5;
      drawStar(Math.random() * w, Math.random() * h, 3 + Math.random() * 6, Math.random() * Math.PI);
    }
    ctx.globalAlpha = 1;
    return;
  }
  for (let k = 0; k < 90; k++) addStar(w / 2, h / 2, true);
  emitAcc = 0;
  lastT = performance.now();
  raf = requestAnimationFrame(tick);
}
function stopStars() { cancelAnimationFrame(raf); raf = 0; stars.length = 0; }
function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const { w, h } = sizeCanvas();
  emitAcc += dt * 26;
  for (; emitAcc >= 1; emitAcc--) addStar(w / 2, h / 2, false);
  ctx.clearRect(0, 0, w, h);
  for (let k = stars.length - 1; k >= 0; k--) {
    const p = stars[k];
    p.life += dt;
    if (p.life >= p.max) { stars[k] = stars[stars.length - 1]; stars.pop(); continue; }
    p.vx *= 1 - 0.6 * dt; p.vy = p.vy * (1 - 0.6 * dt) + 140 * dt;   // drag, then a gentle fall
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
    const t = p.life / p.max;
    ctx.globalAlpha = t < 0.1 ? t / 0.1 : t > 0.6 ? (1 - t) / 0.4 : 1;
    ctx.fillStyle = p.color;
    drawStar(p.x, p.y, p.r * (t < 0.1 ? 0.4 + 6 * t : 1), p.rot);
  }
  ctx.globalAlpha = 1;
}
