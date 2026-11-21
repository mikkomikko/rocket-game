import { P } from '@rocket-duel/shared/config.js';
import { game } from '@rocket-duel/shared/state.js';
import { clamp } from '@rocket-duel/shared/math.js';
import { ships } from '@rocket-duel/shared/ships/ship.js';
import { BIG } from '@rocket-duel/shared/ships/bigLaser.js';
import { startEl } from '../ui/startScreen.js';

/* ------------------------------------------------------------------ *
 * Sound: every effect is synthesized live with the Web Audio API (no audio files).
 * Browsers only allow audio after a click or key press, so the engine starts on the first one.
 * ------------------------------------------------------------------ */
export const sfx = (() => {
  let ctx = null, master = null, noiseBuf = null, verb = null;
  const lastAt = {}, engines = [];
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = P.sound ? P.volume : 0;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // A short synthetic cave echo, so blasts ring out a little.
    const len = Math.floor(ctx.sampleRate * 1.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    verb.connect(wet); wet.connect(master);
    for (let i = 0; i < 2; i++) engines.push(makeEngine(i));
  }
  // Engine: looping noise and a low buzz through a filter that opens up with thrust.
  function makeEngine(i) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 0.8;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 44 + i * 4;
    const og = ctx.createGain(); og.gain.value = 0.16;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(lp); osc.connect(og); og.connect(lp); lp.connect(g); g.connect(master);
    src.start(0, i * 0.7); osc.start();
    return { g, lp, osc };
  }
  const now = () => ctx.currentTime;
  // Gate: skip when muted or not started, and keep rapid repeats of one sound from piling up.
  function ready(name, gap) {
    if (!ctx || !P.sound || ctx.state !== 'running') return false;
    const t = now();
    if (lastAt[name] !== undefined && t - lastAt[name] < gap) return false;
    lastAt[name] = t;
    return true;
  }
  // Louder close to a ship, quieter across the map.
  function near(x, y) {
    let d = Infinity;
    for (const s of ships) if (s.active && s.alive) d = Math.min(d, Math.hypot(s.x - x, s.y - y));
    return d === Infinity ? 1 : clamp(1.15 - d / 900, 0.18, 1);
  }
  function voice(t, peak, a, dec, wet = 0) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
    g.connect(master);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(verb); }
    return g;
  }
  function tone(type, f0, f1, t, dur, dest) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    o.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, dest, type, f0, f1, q = 0.8) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    src.connect(f); f.connect(dest);
    src.start(t, Math.random() * 1.8); src.stop(t + dur + 0.05);
  }
  function filter(type, freq, q, dest) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; f.connect(dest); return f; }
  // Small bits of falling debris after an impact.
  function grit(t, v, n, spread) {
    for (let k = 0; k < n; k++) {
      const tk = t + 0.04 + Math.random() * spread;
      noise(tk, 0.04, voice(tk, 0.05 * v, 0.001, 0.04, 0.15), 'bandpass', 900 + Math.random() * 2600, 600, 2.5);
    }
  }
  function boom(x, y, big) {
    const t = now(), v = near(x, y);
    noise(t, 1.3 * big, voice(t, 0.75 * v * big, 0.004, 1.3 * big, 0.45), 'lowpass', 3200, 90, 0.6);
    tone('sine', 110, 28, t, 0.7 * big, voice(t, 0.7 * v * big, 0.003, 0.7 * big, 0.2));
    noise(t, 0.08, voice(t, 0.2 * v, 0.001, 0.08), 'highpass', 3000, 1500);
    grit(t + 0.1, v, 6, 0.6);
  }
  return {
    init,
    // Blaster: a quick downward zap. Player 2's is pitched a little higher, so you can tell them apart.
    shoot(s) {
      if (!ready('shoot' + s.id, 0.035)) return;
      const t = now(), v = near(s.x, s.y), p = (s.id ? 1.12 : 1) * (0.94 + Math.random() * 0.12);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.1);
      lp.connect(voice(t, 0.14 * v, 0.003, 0.11, 0.05));
      tone('square', 1500 * p, 220 * p, t, 0.1, lp);
      tone('sawtooth', 760 * p, 140 * p, t, 0.1, lp);
    },
    cannon(s) {
      if (!ready('cannon', 0.05)) return;
      const t = now(), v = near(s.x, s.y);
      tone('sine', 160, 38, t, 0.4, voice(t, 0.5 * v, 0.004, 0.45, 0.25));
      noise(t, 0.25, voice(t, 0.25 * v, 0.002, 0.25, 0.2), 'lowpass', 2400, 200);
    },
    freezer(s) {
      if (!ready('ice' + s.id, 0.05)) return;
      const t = now(), v = near(s.x, s.y), g = voice(t, 0.11 * v, 0.005, 0.22, 0.2);
      tone('triangle', 700, 2400, t, 0.2, g);
      tone('sine', 1400, 4200, t, 0.2, g);
      noise(t, 0.15, voice(t, 0.05 * v, 0.002, 0.15, 0.2), 'highpass', 5000, 8000);
    },
    // A round chipping the rock: a dull crack, a thud and a little falling grit.
    rock(x, y) {
      if (!ready('rock', 0.03)) return;
      const t = now(), v = near(x, y);
      noise(t, 0.16, voice(t, 0.22 * v, 0.002, 0.16, 0.12), 'lowpass', 2600 * (0.8 + Math.random() * 0.4), 260);
      tone('sine', 120, 50, t, 0.12, voice(t, 0.18 * v, 0.002, 0.12));
      grit(t, v, 3, 0.14);
    },
    tink(x, y) {
      if (!ready('tink', 0.04)) return;
      const t = now(), v = near(x, y);
      tone('sine', 3100 + Math.random() * 600, 2600, t, 0.12, voice(t, 0.06 * v, 0.001, 0.12, 0.25));
    },
    blast(x, y, big = 1) { if (ready('blast', 0.06)) boom(x, y, big); },
    // Missile launch: a pop, then a rising rocket hiss.
    missile(s) {
      if (!ready('missile' + s.id, 0.1)) return;
      const t = now(), v = near(s.x, s.y);
      tone('sine', 220, 70, t, 0.12, voice(t, 0.3 * v, 0.002, 0.12, 0.15));
      noise(t, 0.7, voice(t, 0.16 * v, 0.08, 0.6, 0.3), 'bandpass', 700, 2600, 1.2);
    },
    // A round striking a ship: a short metallic clank.
    hit(x, y) {
      if (!ready('hit', 0.04)) return;
      const t = now(), v = near(x, y), g = voice(t, 0.26 * v, 0.001, 0.2, 0.15);
      const bp = filter('bandpass', 1800, 1.2, g);
      tone('square', 523, 470, t, 0.2, bp);
      tone('square', 787, 700, t, 0.2, bp);
      tone('triangle', 1330, 1200, t, 0.2, g);
      noise(t, 0.05, voice(t, 0.2 * v, 0.001, 0.05), 'highpass', 2500, 2000);
    },
    frost(s) {
      if (!ready('frost', 0.1)) return;
      const t = now(), v = near(s.x, s.y);
      [2093, 2637, 3136, 3951].forEach((f, k) => { const tk = t + k * 0.03; tone('sine', f, f * 0.98, tk, 0.6, voice(tk, 0.07 * v, 0.002, 0.6, 0.35)); });
      noise(t, 0.4, voice(t, 0.12 * v, 0.003, 0.4, 0.3), 'highpass', 6000, 3000);
    },
    death(s) {
      if (!ready('death', 0.1)) return;
      boom(s.x, s.y, 1.25);
      const t = now(), v = near(s.x, s.y);
      tone('sawtooth', 620, 45, t, 0.9, filter('lowpass', 1800, 0.7, voice(t, 0.13 * v, 0.01, 0.9, 0.3)));
    },
    // Hitting a wall or landing: a thud that grows with the impact speed.
    boing(s, impact) {
      if (!ready('boing' + s.id, 0.06)) return;
      const t = now(), v = near(s.x, s.y), k = clamp(impact / 400, 0.2, 1);
      tone('sine', 160 + 100 * k, 480 + 260 * k, t, 0.22, voice(t, 0.22 * v * k, 0.002, 0.22, 0.2));
      tone('triangle', 90, 60, t, 0.12, voice(t, 0.14 * v * k, 0.002, 0.12));
    },
    bump(s, impact) {
      if (!ready('bump' + s.id, 0.08)) return;
      const t = now(), v = near(s.x, s.y), k = clamp(impact / 300, 0.15, 1);
      tone('sine', 90 + 60 * k, 40, t, 0.3, voice(t, 0.35 * v * k, 0.002, 0.18 + 0.2 * k, 0.15));
      noise(t, 0.1, voice(t, 0.15 * v * k, 0.001, 0.1, 0.1), 'lowpass', 1400, 200);
    },
    swap() {
      if (!ready('swap', 0.05)) return;
      const t = now();
      tone('square', 660, 660, t, 0.05, filter('lowpass', 2500, 0.7, voice(t, 0.06, 0.002, 0.05)));
      tone('square', 990, 990, t + 0.06, 0.06, filter('lowpass', 2500, 0.7, voice(t + 0.06, 0.06, 0.002, 0.06)));
    },
    respawn(s) {
      if (!ready('respawn' + s.id, 0.2)) return;
      const t = now();
      [392, 523, 784].forEach((f, k) => { const tk = t + k * 0.07; tone('triangle', f, f, tk, 0.25, voice(tk, 0.06, 0.005, 0.25, 0.3)); });
    },
    laserCharge(s) {
      if (!ready('laserC', 0.2)) return;
      const t = now(), v = near(s.x, s.y), d = BIG.charge;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(4000, t + d);
      lp.connect(voice(t, 0.16 * v, d * 0.9, 0.08, 0.2));
      tone('sawtooth', 110, 880, t, d, lp);
      tone('sawtooth', 112, 900, t, d, lp);
    },
    laserFire(s) {
      if (!ready('laserF', 0.2)) return;
      const t = now(), v = near(s.x, s.y), d = BIG.fire;
      const g = voice(t, 0.38 * v, 0.01, d + 0.2, 0.4), lp = filter('lowpass', 2600, 2, g);
      tone('sawtooth', 72, 60, t, d, lp);
      tone('square', 145, 120, t, d, lp);
      tone('sawtooth', 220, 180, t, d, lp);
      noise(t, d, voice(t, 0.2 * v, 0.01, d, 0.3), 'bandpass', 1800, 700, 1.5);
      tone('sine', 90, 30, t, 0.5, voice(t, 0.5 * v, 0.003, 0.5, 0.2));
    },
    // Called every frame: engine volume and tone follow each ship's thrust; mutes while paused or in menus.
    frame() {
      if (!ctx) return;
      const t = now();
      master.gain.setTargetAtTime(P.sound ? P.volume : 0, t, 0.05);
      const quiet = game.paused || !startEl.hidden;
      ships.forEach((s, i) => {
        const e = engines[i];
        if (!e) return;
        const th = quiet || !s.active || !s.alive || s.frozenT > 0 ? 0 : s.thrust;
        e.g.gain.setTargetAtTime(th * 0.2, t, 0.04);
        e.lp.frequency.setTargetAtTime(220 + th * 900, t, 0.05);
        e.osc.frequency.setTargetAtTime(44 + i * 4 + th * 30, t, 0.08);
      });
    },
  };
})();
window.addEventListener('pointerdown', () => sfx.init(), { capture: true });
window.addEventListener('keydown', () => sfx.init(), { capture: true });
