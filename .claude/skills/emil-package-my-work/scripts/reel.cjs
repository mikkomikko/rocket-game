// A hover reel: many live items (cards, icons, thumbnails) shown one at a time,
// each hovered by a real macOS cursor that glides in from off-frame, stops dead
// while the hover plays, and glides back out. Every frame is stepped.
//
//   URL=http://localhost:3000/dev-card-reel COUNT=11 node reel.cjs out/frames
//   node reel.cjs encode out/frames out/<name>-<len>s.mp4
//   COUNT=1 node reel.cjs out/one && node reel.cjs encode out/one out/one.mp4  -> direction check
//
// Page contract (a temporary route, deleted afterwards):
//   - every item is [data-reel="i"]; only the one with [data-on] is visible,
//     e.g. `[data-reel]:not([data-on]){display:none}`
//   - all items are the same size, so every frame of the reel matches
//   - the visible item sits MARGIN px from the top-left; the viewport is
//     sized to item + MARGIN on every side
//
// Env: URL, COUNT, ORDER=3,0,7 (slot k records item ORDER[k]), START/END
//      (slot range, for parallel batches), DSF=8, SCHEME=dark|light,
//      TX=0.68 TY=0.47 (rest point as a fraction of the item box), KEEP_WAAPI=1,
//      CHROME_PATH. Re-running skips slots whose frames already exist.
const fs = require("fs");
const path = require("path");
const L = require("./lib.cjs");

if (process.argv[2] === "encode") {
  L.encode(path.resolve(process.argv[3]), path.resolve(process.argv[4]));
  process.exit(0);
}

const OUT = path.resolve(process.argv[2] || "out/frames");
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.URL;
const COUNT = Number(process.env.COUNT || 1);
const ORDER = process.env.ORDER ? process.env.ORDER.split(",").map(Number) : null;
const START = Number(process.env.START || 0);
const END = Number(process.env.END || (ORDER ? ORDER.length : COUNT));
const DSF = Number(process.env.DSF || 8);
const TX = Number(process.env.TX || 0.68), TY = Number(process.env.TY || 0.47);
const itemOf = (slot) => (ORDER ? ORDER[slot] : slot);

// Resume only an unchanged render: frames on disk from another config would be
// skipped and silently end up in the video. Source edits can't be detected,
// so after any edit use a new, empty frames directory.
const manifest = path.join(OUT, "reel.json");
const config = JSON.stringify({ URL, COUNT, ORDER, DSF, TX, TY, SCHEME: process.env.SCHEME || "dark", KEEP_WAAPI: process.env.KEEP_WAAPI === "1" });
if (fs.existsSync(manifest) && fs.readFileSync(manifest, "utf8") !== config) {
  console.error(`${OUT} holds frames from a different config. Use a new, empty frames directory.`);
  process.exit(1);
}
fs.writeFileSync(manifest, config);

// Per item at 60fps: rest 0.2s, glide in 0.67s, hold 0.65s, glide out 0.6s,
// rest 0.5s. A longer hold drags by the third item.
const A = 12, B = 40, C = 39, D = 36, E = 30;
const PER = A + B + C + D + E;
const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

(async () => {
  if (!URL) throw new Error("URL is required");
  const { browser, page: p } = await L.launch({ dsf: DSF, scheme: JSON.parse(config).SCHEME });
  let navigated = false;
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) navigated = true; });
  let W = 800, H = 800, box = null;

  const load = async () => {
    for (;;) {
      try {
        await L.prepare(p, URL, "[data-reel='0']");
        navigated = false;
        return;
      } catch (e) {
        console.log("load retry", e.message.split("\n")[0]);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };

  const show = async (i) => {
    const r = await p.evaluate((i) => {
      document.querySelectorAll("[data-reel]").forEach((e) => e.removeAttribute("data-on"));
      const el = document.querySelector(`[data-reel='${i}']`);
      el.setAttribute("data-on", "");
      for (const a of document.getAnimations()) {
        if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); // infinite ones throw
      }
      window.__birth = new Map();
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    }, i);
    W = Math.round(r.x * 2 + r.w); H = Math.round(r.y * 2 + r.h); box = r;
    await p.setViewportSize({ width: W, height: H });
  };

  await load();
  const tries = new Map();
  for (let i = START; i < END; i++) {
    const base = i * PER;
    let done = true;
    for (let k = 0; k < PER; k++) if (!fs.existsSync(L.frameName(OUT, base + k))) done = false;
    if (done) { console.log("skip", i); continue; }
    try {
      await show(itemOf(i));
      // Same depth into the item every time; only the direction varies, seeded
      // by slot. Enters between the right edge and straight below, leaves
      // between bottom-right and bottom-left. Angles: 0° = right, 90° = down.
      const rnd = rng(i * 7919 + 17);
      const j = (v) => (rnd() * 2 - 1) * v;
      const lerp = (lo, hi) => lo + rnd() * (hi - lo);
      const target = [box.x + box.w * (TX + j(0.03)), box.y + box.h * (TY + j(0.025))];
      const aIn = lerp(-15, 80);
      const aOut = Math.max(aIn + 35, lerp(55, 125));
      const off = (deg) => { // first point fully outside the frame along this angle
        const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), ts = [];
        if (c > 1e-6) ts.push((W + 36 - target[0]) / c);
        if (c < -1e-6) ts.push((-36 - target[0]) / c);
        if (s > 1e-6) ts.push((H + 44 - target[1]) / s);
        if (s < -1e-6) ts.push((-48 - target[1]) / s);
        const t = Math.min(...ts);
        return [target[0] + c * t, target[1] + s * t];
      };
      const start = off(aIn), end = off(aOut);
      const bow = () => lerp(0.06, 0.16) * (rnd() < 0.5 ? -1 : 1);
      const route = [
        ...Array(A).fill(start),
        ...L.glide(start, target, B, bow()),
        ...Array(C).fill(target), // dead still while the hover plays
        ...L.glide(target, end, D, bow()),
        ...Array(E).fill(end),
      ];
      for (let f = 0; f < PER; f++) {
        await L.step(p, route[f]);
        await p.screenshot({ path: L.frameName(OUT, base + f) });
        if (navigated) throw new Error("page reloaded");
        await L.tick(p);
      }
      console.log("item", i, "->", itemOf(i), `${W * DSF}×${H * DSF}`);
    } catch (e) {
      console.log("retry", i, e.message.split("\n")[0]);
      tries.set(i, (tries.get(i) || 0) + 1);
      if (tries.get(i) > 3) {
        console.error(`slot ${i} (item ${itemOf(i)}) failed 3 times; check [data-reel='${itemOf(i)}'] exists and ORDER/COUNT are right`);
        process.exit(1);
      }
      for (let k = 0; k < PER; k++) fs.rmSync(L.frameName(OUT, base + k), { force: true });
      await load();
      i--;
    }
  }
  await browser.close();
})();
