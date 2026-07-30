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

  // --- dark mode and narrow layout -----------------------------------------
  await page.click('[data-role="theme"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "07-dark.png") });

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
