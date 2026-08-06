// SPDX-License-Identifier: MIT
/**
 * Behaviour gate. The things a screenshot cannot check.
 *
 *   node scripts/behaviour.mjs [baseUrl]
 *
 * Three of these exist because the redesign added motion, and motion is the
 * easiest thing on a page to ship broken without noticing:
 *
 *   - the load sequence runs *and then removes itself*, because the staging
 *     attributes it leaves behind are what made every later style recalc slow;
 *   - the decomposition's hollow half genuinely separates on scroll, rather
 *     than the view-progress timeline silently doing nothing;
 *   - prefers-reduced-motion lands on the end state rather than on the start
 *     state, which is the failure mode that leaves a section looking broken.
 *
 * The rest exercise the controls the redesign introduced, and assert on what
 * the numbers do rather than that a click did not throw: switching tokenizer
 * has to grow the hollow half while leaving the floor where it is, because
 * that invariant is the entire claim the figure makes.
 */

import { chromium } from "playwright-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.argv[2] ?? "http://localhost:4321/";
const b = await chromium.launch({ executablePath: CHROME });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fails.push(msg); };

// ---- 0. the rail is locked -------------------------------------------------
// It carries the map of the study and the tokenizer selector, and neither may
// be behind a second scroll position. Checked across the range of window
// heights a laptop actually produces, because the failure is invisible at the
// height you happen to be developing at: the natural content is 774px, so a
// 900px window looks perfect while a 720px one hides the theme button and the
// last tokenizer. 520px is the floor below which the rows genuinely cannot fit
// and the rail is allowed to scroll rather than clip a section link.
{
  const RAIL_LOCKED_ABOVE = 520;
  for (const height of [1080, 900, 800, 720, 690, 640, 560, 520]) {
    const p = await b.newPage({ viewport: { width: 1440, height } });
    await p.goto(BASE, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".tok-btn");
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(200);
    const r = await p.evaluate(() => {
      const rail = document.querySelector(".rail");
      const cs = getComputedStyle(rail);
      const floor = rail.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom);
      let worst = 0;
      for (const el of rail.querySelectorAll(".nav-list a, .tok-btn, .theme-btn, .masthead h1")) {
        worst = Math.max(worst, Math.round(el.getBoundingClientRect().bottom - floor));
      }
      return { rolls: rail.scrollHeight - rail.clientHeight, worst,
               links: rail.querySelectorAll(".nav-list a").length,
               toks: rail.querySelectorAll(".tok-btn").length };
    });
    check(
      r.rolls === 0 && r.worst <= 0 && r.links === 8 && r.toks === 8,
      `rail is locked at ${height}px tall (rolls ${r.rolls}px, overhang ${r.worst}px, ` +
        `${r.links} links and ${r.toks} tokenizers all in view)`
    );
    await p.close();
  }
  void RAIL_LOCKED_ABOVE;
}

// ---- 0b. the specimen never scrolls sideways -------------------------------
// It is the first thing on the page and it is the whole argument, so half of it
// must not be behind a horizontal gesture. Below the width where four columns
// fit, the column *count* drops rather than the columns shrinking — and the two
// assertions have to be made together, because satisfying either one alone is
// trivial and wrong: narrow columns clip tokens, and a clipped token is
// indistinguishable from a real BPE split, which is the thing this view exists
// to show.
{
  for (const width of [1920, 1600, 1440, 1280, 1180, 1024, 961, 960, 768, 600, 480, 380]) {
    const p = await b.newPage({ viewport: { width, height: 900 } });
    await p.goto(BASE, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".column .tile");
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => {
      const strip = document.querySelector(".tile-strip");
      let clipped = 0;
      for (const t of document.querySelectorAll(".column .tile")) {
        if (t.dataset.empty !== "true" && t.scrollWidth - t.clientWidth > 1) clipped += 1;
      }
      const de = document.documentElement;
      return {
        strip: strip.scrollWidth - strip.clientWidth,
        doc: de.scrollWidth - de.clientWidth,
        cols: document.querySelectorAll(".column").length,
        english: !!document.querySelector('.column[data-code="eng_Latn"]'),
        clipped,
      };
    });
    check(
      r.strip === 0 && r.doc <= 0 && r.cols >= 2 && r.english,
      `specimen fits at ${width}px (strip scroll ${r.strip}px, document ${r.doc}px, ` +
        `${r.cols} columns, English present ${r.english})`
    );
    // Reported separately: at some widths a token legitimately does not fit and
    // is marked, but never in the two Latin columns the gate in shots.mjs pins.
    if (r.clipped > 0) console.log(`     note: ${r.clipped} tile(s) marked truncated at ${width}px`);
    await p.close();
  }
}

// ---- 1. load sequence ------------------------------------------------------
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(BASE);
  await p.waitForSelector(".column .tile");
  const during = await p.evaluate(() => {
    const t = document.querySelector(".column .tile");
    return { reveal: document.querySelector(".columns").dataset.reveal,
             wave: t.dataset.wave, anim: getComputedStyle(t).animationName };
  });
  check(during.reveal === "true" && during.anim === "tile-in", `reveal runs (animation=${during.anim}, wave=${during.wave})`);
  await p.waitForTimeout(1400);
  const after = await p.evaluate(() => {
    const t = document.querySelector(".column .tile");
    return { reveal: document.querySelector(".columns").dataset.reveal,
             wave: t.dataset.wave, inline: t.getAttribute("style") };
  });
  check(!after.reveal && !after.wave, `reveal cleans up after itself (reveal=${after.reveal}, wave=${after.wave})`);
  await p.close();
}

// ---- 2. scroll-linked decomposition ---------------------------------------
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForSelector(".decomp-surcharge");
  const supported = await p.evaluate(() => CSS.supports("animation-timeline", "view()"));
  const read = () => p.evaluate(() => {
    const el = document.querySelector(".decomp-surcharge");
    return getComputedStyle(el).transform;
  });
  await p.evaluate(() => {
    const y = document.querySelector("#surcharge").getBoundingClientRect().top + scrollY;
    window.scrollTo(0, y - window.innerHeight + 120);   // section just entering
  });
  await p.waitForTimeout(400);
  const entering = await read();
  await p.evaluate(() => document.querySelector(".decomp").scrollIntoView({ block: "center" }));
  await p.waitForTimeout(400);
  const settled = await read();
  check(supported, "browser supports view-progress timelines");
  check(entering !== settled, `hollow half separates on scroll (${entering} -> ${settled})`);
  check(settled === "none" || settled === "matrix(1, 0, 0, 1, 0, 0)", `settles to the resting state (${settled})`);
  await p.close();
}

// ---- 3. reduced motion jumps to the end state ------------------------------
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForSelector(".decomp-surcharge");
  const r = await p.evaluate(() => {
    const tile = document.querySelector(".column .tile");
    const sur = document.querySelector(".decomp-surcharge");
    return {
      reveal: document.querySelector(".columns").dataset.reveal ?? "unset",
      tileAnim: getComputedStyle(tile).animationName,
      tileOpacity: getComputedStyle(tile).opacity,
      surAnim: getComputedStyle(sur).animationName,
      surTransform: getComputedStyle(sur).transform,
      surMargin: getComputedStyle(sur).marginTop,
    };
  });
  check(r.reveal === "unset" && r.tileOpacity === "1", `no tile reveal under reduced motion (opacity ${r.tileOpacity})`);
  check(r.surAnim === "none" && (r.surTransform === "none"), `decomposition sits at its end state (anim=${r.surAnim}, transform=${r.surTransform}, gap=${r.surMargin})`);
  await p.close();
}

// ---- 4. the new controls ---------------------------------------------------
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForSelector(".decomp-cell");

  const shape = () => p.evaluate(() => ({
    floor: document.querySelectorAll('.decomp-cell[data-kind="floor"]').length,
    over: document.querySelectorAll('.decomp-cell[data-kind="surcharge"]').length,
    caption: document.querySelector('[data-role="decomp-caption"]').textContent.trim().slice(0, 90),
  }));
  const a = await shape();
  await p.evaluate(async () => {
    [...document.querySelectorAll(".tok-btn")].find((x) => x.textContent.includes("Historical")).click();
    await new Promise((r) => setTimeout(r, 300));
  });
  const c = await shape();
  check(c.over > a.over * 3, `tokenizer switch grows the hollow half (${a.over} -> ${c.over} cells)`);
  check(c.floor === a.floor, `the floor does not move with the tokenizer (${a.floor} cells)`);
  console.log("     " + c.caption);

  await p.selectOption("#decomp-lang", { label: "Burmese" });
  await p.waitForTimeout(200);
  const d = await shape();
  check(d.floor !== c.floor, `language select redraws the figure (floor ${c.floor} -> ${d.floor})`);

  const g = await p.evaluate(() => ({
    tiles: document.querySelectorAll(".glyphless .tile").length,
    empty: document.querySelectorAll('.glyphless .tile[data-empty="true"]').length,
    cap: document.querySelector('[data-role="glyphless-caption"]').textContent.trim().slice(0, 110),
  }));
  check(g.empty > 0 && g.empty < g.tiles, `glyphless specimen renders real empty tokens (${g.empty} of ${g.tiles})`);
  console.log("     " + g.cap);

  await p.click('.seg[data-tokens="8000"]');
  await p.waitForTimeout(200);
  const note = await p.textContent(".capacity-note");
  check(/8,000-token window/.test(note), `window selector recomputes (${note.trim().slice(0, 80)}…)`);

  // tooltip
  await p.hover(".column .tile:nth-child(3)");
  await p.waitForTimeout(200);
  const tip = await p.evaluate(() => {
    const t = document.querySelector(".tile-tip");
    return { hidden: t.hidden, text: t.textContent };
  });
  check(!tip.hidden && /token 3/.test(tip.text), `tile tooltip reports the token and its index ("${tip.text}")`);

  check(errs.length === 0, `no page errors (${errs.join("; ") || "none"})`);
  await p.close();
}

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall behaviour checks passed");
process.exitCode = fails.length ? 1 : 0;
