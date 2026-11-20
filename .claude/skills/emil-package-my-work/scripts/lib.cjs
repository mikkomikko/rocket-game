// Shared pieces for reel.cjs and click.cjs: a Chrome page on a paused fake
// clock, the real macOS cursor, per-frame stepping, and the encoder.
//
// Why a fake clock: CSS transitions can be seeked through
// document.getAnimations(), but requestAnimationFrame-driven motion (Motion
// springs, JS height animations) runs on wall time and drifts between frames.
// With Playwright's clock paused, rAF only advances when we call tick().
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright-core");

const FPS = 60;
const STEP = 1000 / FPS;
const sec = (s) => Math.round(s * FPS);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const bez = (p0, p1, p2, t) =>
  [0, 1].map((k) => (1 - t) ** 2 * p0[k] + 2 * (1 - t) * t * p1[k] + t * t * p2[k]);

/** Points from `from` to `to`, bowed sideways by `bow` × distance, like a hand on a trackpad. */
function glide(from, to, frames, bow = 0.1) {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const ctrl = [(from[0] + to[0]) / 2 - dy * bow, (from[1] + to[1]) / 2 + dx * bow];
  return Array.from({ length: frames }, (_, f) => bez(from, ctrl, to, ease((f + 1) / frames)));
}

const b64 = (f) =>
  "data:image/png;base64," +
  fs.readFileSync(path.join(__dirname, "..", "cursors", f)).toString("base64");

async function launch({ dsf, scheme }) {
  const browser = await chromium.launch({
    channel: process.env.CHROME_PATH ? undefined : "chrome", // the installed Google Chrome
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--force-color-profile=srgb"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 1000 },
    deviceScaleFactor: dsf,
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  if (process.env.KEEP_WAAPI !== "1") {
    // Motion hands opacity/transform to WAAPI when it can. Removing it keeps
    // every Motion value on its rAF driver, which runs on the fake clock.
    // Set KEEP_WAAPI=1 if the page calls el.animate() without a fallback.
    await page.addInitScript(() => {
      delete Element.prototype.animate;
    });
  }
  await page.clock.install();
  return { browser, page };
}

/** Load the URL, pause the clock, hide the dev badge and real cursor, inject the macOS cursors. */
async function prepare(page, url, waitFor) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector(waitFor, { state: "attached", timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  // The page's clock, not Node's: after a reload the fake clock is ahead of real time.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  for (let i = 0; i < 90; i++) await page.clock.runFor(STEP); // let mount effects settle
  await page.addStyleTag({
    content: "nextjs-portal{display:none!important} *{cursor:none!important}",
  });
  await page.evaluate(
    ([arrow, hand]) => {
      // Hotspots from NSCursor: arrow (5,5) at 28×40, hand (12,8) at 32×32.
      const c = document.createElement("div");
      c.id = "__cursor";
      c.style.cssText =
        "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-999px,-999px)";
      c.innerHTML =
        `<img data-c="arrow" src="${arrow}" style="position:absolute;left:-5px;top:-5px;width:28px;height:40px;max-width:none">` +
        `<img data-c="hand" src="${hand}" style="position:absolute;left:-12px;top:-8px;width:32px;height:32px;max-width:none;display:none;filter:drop-shadow(0 1px 1px rgb(0 0 0/.45))">`;
      document.body.appendChild(c);
      window.__birth = new Map();
    },
    [b64("arrow.png"), b64("hand.png")],
  );
}

/**
 * One frame: move the real mouse (so :hover fires), optionally click, place the
 * drawn cursor (hand over anything clickable), and hold every CSS/WAAPI
 * animation at its age on the fake clock.
 */
async function step(page, [x, y], click = false) {
  await page.mouse.move(x, y);
  if (click) {
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.evaluate(
    ([x, y]) => {
      const c = document.getElementById("__cursor");
      c.style.transform = `translate(${x}px, ${y}px)`;
      const hand = !!document
        .elementFromPoint(x, y)
        ?.closest("a,button,[role=button],[role=radio],[role=tab],[role=switch],[data-clickable]");
      c.querySelector("[data-c=arrow]").style.display = hand ? "none" : "block";
      c.querySelector("[data-c=hand]").style.display = hand ? "block" : "none";
      const now = performance.now();
      for (const a of document.getAnimations()) {
        // fill: forwards keeps a finished animation in getAnimations(); leave
        // it alone, or it gets a new birth time and replays from 0.
        if (a.playState === "finished") continue;
        if (!window.__birth.has(a)) window.__birth.set(a, now);
        const age = now - window.__birth.get(a);
        const end = a.effect?.getComputedTiming().endTime ?? 0;
        if (Number.isFinite(end) && age >= end) {
          a.finish();
        } else {
          a.pause();
          a.currentTime = age;
        }
      }
    },
    [x, y],
  );
}

const tick = (page) => page.clock.runFor(STEP);

/** frames/f00000.png… → H.264 60fps, crf 14, yuv420p, faststart, no audio. */
function encode(framesDir, out) {
  const r = spawnSync(
    "ffmpeg",
    [
      "-v", "error", "-y", "-framerate", String(FPS), "-i", path.join(framesDir, "f%05d.png"),
      "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
      "-movflags", "+faststart", "-an", out,
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error("ffmpeg failed");
  console.log(out);
}

const frameName = (dir, n) => path.join(dir, `f${String(n).padStart(5, "0")}.png`);

module.exports = { FPS, STEP, sec, ease, bez, glide, launch, prepare, step, tick, encode, frameName };
