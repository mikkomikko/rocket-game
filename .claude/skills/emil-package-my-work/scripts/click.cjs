// One live component, driven by a real macOS cursor that clicks through it
// (switchers, toggles, tabs), stepped one deterministic frame at a time.
//
//   node click.cjs stills 30,80,140        -> out/still-<frame>.png
//   node click.cjs video out/<name>-7s.mp4 -> out/frames/, then encodes
//
// Page contract: a temporary route that renders only the component inside
// #stage (STAGE= to change), on the page background, nothing else visible.
// #stage has a fixed height equal to its tallest state; the script exits
// with an error if it grows. The viewport is the stage + MARGIN on every side.
//
// Env: URL (required), STAGE=#stage, MARGIN=60, DSF=4, SCHEME=dark|light,
//      KEEP_WAAPI=1, CHROME_PATH.
//
// Edit only the ROUTE section below for each video.
const fs = require("fs");
const path = require("path");
const L = require("./lib.cjs");

const URL = process.env.URL;
const STAGE = process.env.STAGE || "#stage";
const MARGIN = Number(process.env.MARGIN || 60); // 40 looks cramped around a wide component
const DSF = Number(process.env.DSF || 4);
const SCHEME = process.env.SCHEME || "light";
const OUT = path.join(process.cwd(), "out");
const FRAMES = path.join(OUT, "frames");

(async () => {
  if (!URL) throw new Error("URL is required");
  const [mode = "stills", arg] = process.argv.slice(2);
  const wanted = mode === "stills" ? new Set((arg || "30,80,140").split(",").map(Number)) : null;
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const { browser, page } = await L.launch({ dsf: DSF, scheme: SCHEME });
  await L.prepare(page, URL, STAGE);

  const stage = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height, cssW: getComputedStyle(el).width };
  }, STAGE);
  // Put the stage MARGIN from the top-left, then size the viewport around it.
  await page.addStyleTag({
    content: `${STAGE}{position:fixed!important;left:${MARGIN}px!important;top:${MARGIN}px!important;margin:0!important;width:${stage.cssW}!important}`,
  });
  const W = Math.round(stage.w + MARGIN * 2);
  const H = Math.round(stage.h + MARGIN * 2);
  await page.setViewportSize({ width: W, height: H });

  /** A point low and right of a control's center, so the hand never covers its label. */
  const at = async (textOrSelector) => {
    const loc = textOrSelector.startsWith("css=")
      ? page.locator(textOrSelector.slice(4))
      : page.getByText(textOrSelector, { exact: true });
    const b = await loc.first().boundingBox();
    if (!b) throw new Error(`not found: ${textOrSelector}`);
    return [b.x + b.width * 0.72, b.y + b.height * 0.9];
  };

  const route = [];
  const rest = (pt, s) => { for (let i = 0; i < L.sec(s); i++) route.push({ pt }); };
  const go = (from, to, s, bow) => { for (const pt of L.glide(from, to, L.sec(s), bow)) route.push({ pt }); };
  const click = (pt) => route.push({ pt, click: true });

  // ─── ROUTE ────────────────────────────────────────────────────────────────
  // Default: enter from off-frame right, click B, then A ↔ B a few times, and
  // leave off-frame bottom with A showing so the post loops. The 0.6s hold
  // after each click is long enough to read the change and short enough to keep moving.
  const a = await at(process.env.A || "Before");
  const b = await at(process.env.B || "After");
  const offIn = [W + 40, H * 0.86];
  const offOut = [b[0] + 260, H + 50];

  rest(offIn, 0.35);
  go(offIn, b, 0.75, 0.1);
  rest(b, 0.2);
  click(b);
  rest(b, 0.6);
  for (const [from, to, bow] of [[b, a, 0.08], [a, b, -0.08], [b, a, 0.08]]) {
    go(from, to, 0.55, bow);
    rest(to, 0.15);
    click(to);
    rest(to, 0.6);
  }
  go(a, offOut, 0.6, -0.12);
  rest(offOut, 0.4);
  // ──────────────────────────────────────────────────────────────────────────

  let grew = 0;
  for (let f = 0; f < route.length; f++) {
    await L.step(page, route[f].pt, route[f].click);
    if (f % 10 === 0) {
      const h = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().height, STAGE);
      if (h > stage.h + 0.5) grew = Math.max(grew, h);
    }
    const file = wanted
      ? wanted.has(f) && path.join(OUT, `still-${f}.png`)
      : L.frameName(FRAMES, f);
    if (file) await page.screenshot({ path: file });
    if (wanted && f >= Math.max(...wanted)) break;
    await L.tick(page);
  }
  await browser.close();
  console.log(`${W * DSF}×${H * DSF}, ${route.length} frames, ${(route.length / L.FPS).toFixed(2)}s`);
  if (grew) {
    console.error(`STAGE GREW from ${stage.h}px to ${grew}px and got cropped. Give ${STAGE} a fixed height equal to its tallest state and re-run.`);
    process.exit(1);
  }
  if (!wanted) L.encode(FRAMES, path.resolve(arg || path.join(OUT, "video.mp4")));
})();
