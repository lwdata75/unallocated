// SPDX-License-Identifier: MIT
/**
 * Visual verification. Drives the installed Chrome through playwright-core, so
 * there is no browser download and no extra CI dependency.
 *
 *   node scripts/shots.mjs [baseUrl]
 *
 * Writes to scripts/shots/ (gitignored). Checks the things that are functional
 * requirements rather than polish: that every showcase script renders real
 * glyphs rather than tofu, that the scatter is legible at 1200x630, that dark
 * mode and the 380px layout hold up, and that nothing throws.
 */

import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4321/";
const OUT = path.resolve(import.meta.dirname, "shots");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const SHOWCASE = [
  "eng_Latn", "fra_Latn", "spa_Latn", "deu_Latn", "por_Latn", "ita_Latn",
  "pol_Latn", "tur_Latn", "vie_Latn", "swh_Latn", "ell_Grek", "rus_Cyrl",
  "heb_Hebr", "arb_Arab", "hin_Deva", "ben_Beng", "tel_Telu", "tam_Taml",
  "tha_Thai", "mya_Mymr", "amh_Ethi", "kat_Geor", "jpn_Jpan", "kor_Hang",
  "zho_Hans",
];

const problems = [];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".column .tile", { timeout: 15000 });
  // Per-script faces land after first paint and reflow the tile field, so
  // capturing before this measures a layout no visitor ever sees.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  await page.screenshot({ path: path.join(OUT, "01-hero.png") });

  // --- glyph coverage -----------------------------------------------------
  // The requirement is that *our* self-hosted faces render these scripts, not
  // that the visitor's OS happens to have a font. So for each script we force
  // the face to load with its own sample text, confirm the browser reports it
  // as covering that text, and confirm it measures differently from a stack
  // with no such family — which would mean we fell through to system fallback.
  //
  // Latin is deliberately exempt: it is carried by Martian Mono in the tiles,
  // and there is no `Script Latn` face by design.
  const glyphReport = await page.evaluate(async (codes) => {
    const res = await fetch("data/samples.json");
    const samples = await res.json();
    const text0 = samples.sentences[0].texts;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const out = [];

    for (const code of codes) {
      const script = code.split("_")[1];
      const text = (text0[code] ?? "").slice(0, 40);
      if (!text) { out.push({ code, script, reason: "no sample text" }); continue; }

      const family = script === "Latn" ? "Martian Mono" : `Script ${script}`;

      // Script stylesheets are fetched on demand, so pull this one in the same
      // way the app does before asking whether the face covers the text.
      if (script !== "Latn" && !document.querySelector(`link[href$="script-${script}.css"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `fonts/script-${script}.css`;
        const loaded = new Promise((res) => {
          link.onload = res;
          link.onerror = () => res();
        });
        document.head.append(link);
        await loaded;
      }

      try {
        await document.fonts.load(`16px "${family}"`, text);
      } catch (err) {
        out.push({ code, script, reason: `load threw: ${err}` });
        continue;
      }
      const covers = document.fonts.check(`16px "${family}"`, text);

      ctx.font = `16px "${family}", "NoSuchFontAnywhere"`;
      const withFont = ctx.measureText(text).width;
      ctx.font = `16px "NoSuchFontAnywhere"`;
      const withoutFont = ctx.measureText(text).width;

      out.push({ code, script, covers, differs: Math.abs(withFont - withoutFont) > 0.5 });
    }
    return out;
  }, SHOWCASE);

  for (const row of glyphReport) {
    const ok = row.covers && row.differs;
    if (!ok) {
      problems.push(
        `glyphs: ${row.code} (${row.script}) covers=${row.covers} differs=${row.differs}` +
          (row.reason ? ` ${row.reason}` : "")
      );
    }
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${row.code.padEnd(10)} ${row.script ?? ""}\n`);
  }

  // --- no English token may be clipped on sentence 1 / o200k ---------------
  // The thesis is that in English one token is one word while elsewhere it is a
  // fragment of a character. A tile that clips its own text counterfeits that,
  // so a truncated English token is a broken argument, not a cosmetic issue.
  const clipping = await page.evaluate(async () => {
    const pick = (label) =>
      [...document.querySelectorAll(".tok-btn")].find((b) => b.textContent.includes(label));
    pick("OpenAI current").click();
    await new Promise((r) => setTimeout(r, 500));
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 200));

    const out = [];
    for (const code of ["eng_Latn", "fra_Latn"]) {
      const tiles = document.querySelectorAll(`.column[data-code="${code}"] .tile`);
      const bad = [];
      for (const t of tiles) {
        if (t.dataset.empty === "true") continue;
        if (t.scrollWidth - t.clientWidth > 1) bad.push(t.textContent);
      }
      out.push({ code, total: tiles.length, truncated: bad });
    }
    return out;
  });

  for (const row of clipping) {
    process.stdout.write(
      `${row.truncated.length === 0 ? "ok  " : "FAIL"} ${row.code}: ` +
        `${row.total} tiles, ${row.truncated.length} truncated ` +
        `${row.truncated.length ? JSON.stringify(row.truncated) : ""}\n`
    );
    if (row.truncated.length) {
      problems.push(
        `${row.code} on sentence 1 / o200k has truncated tokens: ` +
          `${JSON.stringify(row.truncated)} — a clipped token is indistinguishable ` +
          `from a real BPE split, which breaks the argument the view exists to make`
      );
    }
  }

  // Whitespace tokens must be visible, not blank: a blank tile reads as a
  // missing glyph when it is a space the tokenizer charged for.
  const spaceTiles = await page.evaluate(
    () => document.querySelectorAll('.column[data-code="eng_Latn"] .tile .ws').length
  );
  process.stdout.write(`${spaceTiles > 0 ? "ok  " : "FAIL"} whitespace tokens marked: ${spaceTiles}\n`);
  if (spaceTiles === 0) problems.push("no whitespace tokens rendered visibly in the English column");

  // --- every showcase language actually tiled ------------------------------
  for (const code of SHOWCASE) {
    const count = await page.evaluate(async (c) => {
      const selects = [...document.querySelectorAll(".lang-select")];
      const target = selects[3];
      target.value = c;
      target.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 60));
      const col = document.querySelector(`.column[data-code="${c}"] .tiles`);
      return col ? col.querySelectorAll(".tile").length : 0;
    }, code);
    if (count === 0) problems.push(`no tiles rendered for ${code}`);
  }
  await page.screenshot({ path: path.join(OUT, "02-hero-after-swaps.png") });

  // --- tokenizer switch: GPT-2 should blow the Telugu column up ------------
  await page.evaluate(() => {
    const selects = [...document.querySelectorAll(".lang-select")];
    selects[3].value = "tel_Telu";
    selects[3].dispatchEvent(new Event("change"));
  });
  const counts = {};
  for (const family of ["Historical baseline", "Multilingual-first", "OpenAI current"]) {
    counts[family] = await page.evaluate(async (f) => {
      const btn = [...document.querySelectorAll(".tok-btn")].find((b) => b.textContent.includes(f));
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      return document.querySelectorAll('.column[data-code="tel_Telu"] .tile').length;
    }, family);
  }
  process.stdout.write(`\ntelugu tiles: ${JSON.stringify(counts)}\n`);
  if (!(counts["Historical baseline"] > counts["Multilingual-first"] * 5)) {
    problems.push(`tokenizer switch did not re-tile as expected: ${JSON.stringify(counts)}`);
  }

  await page.evaluate(async () => {
    const btn = [...document.querySelectorAll(".tok-btn")].find((b) => b.textContent.includes("Historical baseline"));
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
  });
  await page.screenshot({ path: path.join(OUT, "03-gpt2-telugu.png") });

  // --- scatter at exactly the screenshot size ------------------------------
  const scatter = await page.$(".scatter-figure svg");
  await scatter.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await scatter.screenshot({ path: path.join(OUT, "04-scatter.png") });

  // The share card. The SVG's viewBox is 1200x630, so pinning the element to
  // 1200px wide makes the capture exactly that and guarantees the axis labels
  // are rendered at their design size rather than scaled down to fit a column.
  const social = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
  await social.goto(BASE, { waitUntil: "networkidle" });
  await social.waitForSelector(".dots circle");
  await social.evaluate(() => {
    const fig = document.querySelector(".scatter-figure");
    fig.style.width = "1200px";
    fig.style.paddingLeft = "0";
    fig.style.marginLeft = "0";
    fig.scrollIntoView();
  });
  await social.waitForTimeout(600);
  const card = await social.$(".scatter-figure svg");
  await card.screenshot({ path: path.join(OUT, "05-scatter-1200x630.png") });
  const box = await card.boundingBox();
  process.stdout.write(`share card: ${Math.round(box.width)}x${Math.round(box.height)}\n`);
  if (Math.abs(box.width - 1200) > 2 || Math.abs(box.height - 630) > 2) {
    problems.push(`share card is ${box.width}x${box.height}, expected 1200x630`);
  }
  await social.close();

  // --- free text -----------------------------------------------------------
  await page.evaluate(async () => {
    const btn = [...document.querySelectorAll(".tok-btn")].find((b) => b.textContent.includes("OpenAI current"));
    btn.click();
  });
  await page.fill("#freetext-input", "తెలుగు భాషలో ఒక వాక్యం రాయండి.");
  await page.waitForFunction(
    () => /characters per token/.test(document.querySelector(".freetext-status")?.textContent ?? ""),
    { timeout: 30000 }
  ).catch(() => problems.push("free text never produced a token count"));
  const status = await page.textContent(".freetext-status");
  process.stdout.write(`free text: ${status}\n`);
  await page.locator(".freetext").screenshot({ path: path.join(OUT, "06-freetext.png") });

  // --- scatter card: hover, pin, keyboard, escape ---------------------------
  await page.evaluate(() => document.querySelector("#scatter").scrollIntoView());
  await page.waitForTimeout(400);

  const dot = await page.$(".dots circle");
  await dot.hover();
  await page.waitForTimeout(250);
  const hoverShows = await page.evaluate(() => !document.querySelector(".lang-card").hidden);
  if (!hoverShows) problems.push("scatter card does not open on hover");

  await dot.click();
  await page.waitForTimeout(200);
  await page.mouse.move(700, 760);
  await page.waitForTimeout(200);
  const pinned = await page.evaluate(
    () => document.querySelector(".lang-card").dataset.pinned === "true" &&
          !document.querySelector(".lang-card").hidden
  );
  if (!pinned) problems.push("clicking a dot does not pin the card (needed for touch)");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const escaped = await page.evaluate(() => document.querySelector(".lang-card").hidden);
  if (!escaped) problems.push("Escape does not dismiss the pinned card");

  // Keyboard: the cloud must be reachable and focusing a point must open the
  // card, or the chart is hover-only and unusable without a mouse.
  let tabs = 0;
  for (let i = 0; i < 90; i += 1) {
    await page.keyboard.press("Tab");
    tabs += 1;
    if (await page.evaluate(() => document.activeElement.tagName === "circle")) break;
  }
  await page.waitForTimeout(250);
  const focusShows = await page.evaluate(
    () => document.activeElement.tagName === "circle" &&
          !document.querySelector(".lang-card").hidden
  );
  process.stdout.write(
    `${focusShows ? "ok  " : "FAIL"} keyboard reaches a point in ${tabs} tabs and opens the card\n`
  );
  if (!focusShows) problems.push("focusing a scatter point by keyboard does not open the card");

  const labels = await page.evaluate(
    () => [...document.querySelectorAll(".point-label")].map((t) => t.textContent)
  );
  process.stdout.write(`labelled extremes: ${labels.join(", ")}\n`);
  if (labels.length < 6) problems.push(`only ${labels.length} points labelled, expected 6-8`);

  // Labels must not overlap each other. Three of them used to stack on top of
  // one another in the top-left corner and were unreadable.
  const clashes = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".point-label")].map((t) => ({
      name: t.textContent,
      b: t.getBoundingClientRect(),
    }));
    const out = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i].b;
        const c = boxes[j].b;
        if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) {
          out.push(`${boxes[i].name} / ${boxes[j].name}`);
        }
      }
    }
    return out;
  });
  process.stdout.write(`${clashes.length === 0 ? "ok  " : "FAIL"} label collisions: ${clashes.length}\n`);
  if (clashes.length) problems.push(`scatter labels overlap: ${clashes.join("; ")}`);

  const trend = await page.evaluate(() => ({
    line: !!document.querySelector(".trend-line"),
    band: !!document.querySelector(".trend-band"),
  }));
  if (!trend.line || !trend.band) {
    problems.push("trend curve must never be drawn without its confidence band");
  }

  await page.keyboard.press("Escape");

  // --- dark mode and narrow layout -----------------------------------------
  await page.click('[data-role="theme"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "07-dark.png") });

  // --- the document must never scroll sideways ------------------------------
  // The rail is fixed; if the document scrolls horizontally it drags everything
  // that is not fixed out from under it and the sidebar is clipped mid-word.
  // Only the tile strip may scroll, and only within itself.
  for (const width of [1280, 1440, 1920]) {
    const sized = await browser.newPage({ viewport: { width, height: 900 } });
    await sized.goto(BASE, { waitUntil: "networkidle" });
    await sized.waitForSelector(".column .tile");
    await sized.evaluate(() => document.fonts.ready);
    // Worst case: the tallest tokenizer, strip scrolled to the far end.
    await sized.evaluate(async () => {
      [...document.querySelectorAll(".tok-btn")]
        .find((b) => b.textContent.includes("Historical")).click();
      await new Promise((r) => setTimeout(r, 500));
      const s = document.querySelector(".tile-strip");
      s.scrollLeft = s.scrollWidth;
    });
    await sized.waitForTimeout(300);
    const geom = await sized.evaluate(() => {
      const de = document.documentElement;
      const rail = document.querySelector(".rail").getBoundingClientRect();
      const strip = document.querySelector(".tile-strip");
      return {
        docOverflow: de.scrollWidth - de.clientWidth,
        railLeft: Math.round(rail.left),
        stripScroll: strip.scrollWidth - strip.clientWidth,
      };
    });
    const ok = geom.docOverflow <= 0 && geom.railLeft >= 0;
    process.stdout.write(
      `${ok ? "ok  " : "FAIL"} ${width}px: document overflow ${geom.docOverflow}px, ` +
        `rail left ${geom.railLeft}px, strip scrolls ${geom.stripScroll}px\n`
    );
    if (geom.docOverflow > 0) {
      problems.push(`document scrolls horizontally at ${width}px (${geom.docOverflow}px)`);
    }
    if (geom.railLeft < 0) {
      problems.push(`rail is clipped at ${width}px (left = ${geom.railLeft}px)`);
    }
    await sized.screenshot({ path: path.join(OUT, `10-width-${width}.png`) });
    await sized.close();
  }

  const narrow = await browser.newPage({ viewport: { width: 380, height: 900 } });
  await narrow.goto(BASE, { waitUntil: "networkidle" });
  await narrow.waitForSelector(".column .tile");
  await narrow.screenshot({ path: path.join(OUT, "08-380px.png"), fullPage: false });
  await narrow.evaluate(() => document.querySelector("#scatter").scrollIntoView());
  await narrow.waitForTimeout(400);
  const barsVisible = await narrow.evaluate(() => {
    const list = document.querySelector(".bar-list");
    return list && !list.hidden && list.querySelectorAll("li").length;
  });
  if (!barsVisible) problems.push("scatter did not fall back to a bar list at 380px");
  await narrow.screenshot({ path: path.join(OUT, "09-380px-bars.png") });
  const overflow = await narrow.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 1) problems.push(`horizontal overflow at 380px: ${overflow}px`);
  await narrow.close();

  if (errors.length) problems.push(...errors.map((e) => `console: ${e}`));

  await browser.close();

  process.stdout.write("\n");
  if (problems.length) {
    process.stdout.write(`${problems.length} problem(s):\n`);
    for (const p of problems) process.stdout.write(`  - ${p}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("all visual checks passed\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
