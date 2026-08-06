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
