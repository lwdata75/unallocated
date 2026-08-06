// SPDX-License-Identifier: MIT
/**
 * Contrast audit. Every colour pair has to meet 4.5:1.
 *
 * Measures real rendered elements rather than the token values, because half
 * the surfaces here are semi-transparent glass and the token value alone says
 * nothing about what a visitor actually sees. Backgrounds are composited up the
 * ancestor chain until an opaque one is found.
 *
 *   node scripts/contrast.mjs [baseUrl]
 */

import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://localhost:4321/";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const MIN = 4.5;
/** WCAG lets large text (>=24px, or >=18.66px bold) pass at 3:1. */
const MIN_LARGE = 3;

const SELECTORS = [
  ".masthead h1", ".masthead p", ".rail-label", ".rail-hint",
  ".nav-list a", ".tok-btn", '.tok-btn[aria-pressed="true"]', ".theme-btn",
  // The cold open.
  ".specimen-mark", ".cold-open h2", ".standfirst", ".standfirst strong",
  ".demo figcaption",
  ".demo-name", ".demo-name em", ".demo-value", ".demo-value em", ".demo-note",
  ".section-head h2", ".section-head .caption", ".caption-fine", ".step-mark",
  ".try-this", ".try-this strong",
  // The decomposition — the signature element — and the two figures with it.
  ".decomp-legend-text", ".decomp-legend-text em",
  ".decomp figcaption", ".decomp figcaption strong",
  ".control-hint", ".glyphless figcaption", ".glyphless figcaption strong",
  ".limits h3", ".limits p", ".limits em",
  // The tile tooltip. Rendered off-screen by the audit's own hover below.
  ".tile-tip-index", ".tile-tip-body",
  ".readout-spread", ".readout-key", ".readout-key strong",
  ".readout-case", ".readout-case strong",
  // The context window panel.
  ".control-label", ".seg", '.seg[aria-pressed="true"]', ".seg-unit",
  ".capacity-name", ".capacity-value", ".capacity-value em",
  ".capacity-note", ".capacity-note strong",
  // The allocation matrix and its language card. The coloured cells are not
  // here: they carry per-cell ink and get their own exhaustive pass below.
  ".lang-search", ".matrix-count", ".link-btn",
  ".matrix-tok", ".matrix-vocab", ".matrix-lang", ".matrix-meta", ".matrix-spread",
  ".lang-detail h3", ".detail-meta", ".detail-name", ".detail-value",
  ".detail-value em", ".detail-summary", ".detail-summary strong",
  // The gap chart.
  ".gap-name", ".gap-name em", ".gap-value", ".gap-value em",
  ".gaps figcaption", ".gap-tick em",
  // The expanded methodology.
  ".process li", ".process strong",
  ".gates thead th", ".gates tbody th", ".gates tbody td", ".gates caption",
  ".column-count", ".column-count .unit", ".lang-select",
  ".tile", ".badge", '.badge[data-parity="true"]',
  ".chip", ".sample-pos", ".freetext label", ".freetext textarea", ".freetext-status",
  ".editorial p", ".editorial li", ".editorial h3", ".colophon", ".editorial a",
  ".inline-field", ".bar-name", ".bar-value",
];

async function audit(page, theme) {
  return page.evaluate(
    ({ selectors, MIN, MIN_LARGE }) => {
      // Paint the colour and read the pixel back, rather than pattern-matching
      // the string. getComputedStyle hands back whatever space the value was
      // authored in — `rgb()` for a plain hex, `color(srgb …)` in 0–1 for
      // anything through color-mix, `oklch(…)` now that the palette is authored
      // in OKLCH, and `oklab(…)` for a color-mix of two OKLCH values. Regexing
      // all four was how this gate came to report 1.04:1 for every pair on the
      // site: it read `oklch(0.24 0.022 258)` as an RGB triple, which is a
      // near-black, and then compared it against a background it had misread
      // the same way.
      //
      // Setting fillStyle is not enough on its own — Chrome round-trips the
      // string in the space it was given. A 1x1 fill and a getImageData read is
      // what forces the conversion, because a canvas surface is sRGB. It costs
      // one readback per colour and it cannot be wrong about a colour space
      // that has not been invented yet.
      const ctx = document.createElement("canvas").getContext("2d", {
        willReadFrequently: true,
      });
      const parse = (c) => {
        if (!c) return null;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "#000000";
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      const over = (fg, bg) =>
        [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
      const lum = (rgb) => {
        const [r, g, b] = rgb.map((c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };

      const effectiveBg = (el) => {
        let node = el;
        let stack = [];
        while (node && node !== document.documentElement.parentElement) {
          const c = parse(getComputedStyle(node).backgroundColor);
          if (c && c[3] > 0) {
            stack.push(c);
            if (c[3] === 1) break;
          }
          node = node.parentElement;
        }
        let result = [255, 255, 255];
        for (const layer of stack.reverse()) result = over(layer, result);
        return result;
      };

      const out = [];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) { out.push({ sel, missing: true }); continue; }
        const cs = getComputedStyle(el);
        const fg = parse(cs.color);
        if (!fg) continue;
        const bg = effectiveBg(el);
        const composited = over(fg, bg);
        const size = parseFloat(cs.fontSize);
        const weight = Number(cs.fontWeight) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        out.push({
          sel,
          ratio: Math.round(ratio(composited, bg) * 100) / 100,
          threshold: large ? MIN_LARGE : MIN,
          size,
        });
      }
      return out;
    },
    { selectors: SELECTORS, MIN, MIN_LARGE }
  );
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".tile");
  // The language card only exists once a matrix row has been opened, and a
  // selector that is never rendered is a selector that is never checked.
  await page.waitForSelector(".matrix tbody tr");
  await page.click(".matrix tbody tr");
  await page.waitForSelector(".lang-detail:not([hidden])");
  // Same reasoning for the tooltip: it does not exist in the DOM until a tile
  // has been hovered, and a selector that never renders is never checked.
  await page.hover(".column .tile");
  await page.waitForSelector(".tile-tip:not([hidden])");

  /**
   * Switch theme through the page's own control rather than by stamping
   * data-theme on the root.
   *
   * They are not equivalent. The ramp is resolved in JS — the stops are
   * authored as CSS custom properties and read back once — so the app rebuilds
   * it inside the toggle handler. Setting the attribute directly repainted the
   * CSS into dark mode while every JS-supplied colour on the page stayed on the
   * light stops, and the audit then measured a combination no visitor can ever
   * see. It reported the hollow surcharge cell at 1.37:1 that way, which was
   * neither a real failure nor a real pass.
   */
  const setTheme = async (theme) => {
    for (let i = 0; i < 3; i += 1) {
      const now = await page.evaluate(
        () => document.documentElement.dataset.theme ??
          (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      );
      if (now === theme) return;
      await page.click('[data-role="theme"]');
      await page.waitForTimeout(250);
    }
    throw new Error(`could not switch to ${theme}`);
  };

  const failures = [];
  for (const theme of ["light", "dark"]) {
    await setTheme(theme);

    const rows = await audit(page, theme);
    process.stdout.write(`\n== ${theme}\n`);
    for (const r of rows) {
      if (r.missing) { process.stdout.write(`  ??   ${r.sel} (not found)\n`); continue; }
      const ok = r.ratio >= r.threshold;
      if (!ok) failures.push(`${theme} ${r.sel}: ${r.ratio}:1 (needs ${r.threshold}:1)`);
      process.stdout.write(
        `  ${ok ? "ok  " : "FAIL"} ${String(r.ratio).padStart(6)}:1  ${r.sel}\n`
      );
    }
  }

  // Non-text UI components, which WCAG 1.4.11 puts at 3:1 for their *boundary*
  // against the surface behind them.
  //
  // Three of them, and the last two are new. The hollow decomposition cell is
  // the site's signature element and it is drawn entirely as an outline: if that
  // outline drops below 3:1 the surcharge half of the figure disappears and the
  // page silently stops making its argument. Same for the empty tile, whose
  // whole point is that there is nothing inside it — the dashed edge is all
  // there is to see, and it is measured on the pale end of the ramp in light
  // mode and the dark end in dark mode, which is where an outline is weakest.
  // GPT-2 first: it is the only tokenizer that reliably produces glyphless
  // Telugu tokens, and an outline the audit never renders is an outline the
  // audit never checked.
  await page.evaluate(async () => {
    [...document.querySelectorAll(".tok-btn")]
      .find((b) => b.textContent.includes("Historical")).click();
    await new Promise((r) => setTimeout(r, 400));
  });
  await page.waitForSelector('.glyphless .tile[data-empty="true"]');

  for (const theme of ["light", "dark"]) {
    await setTheme(theme);

    const row = await page.evaluate(() => {
      // Same pixel readback as above; see the note there for why.
      const ctx = document.createElement("canvas").getContext("2d", {
        willReadFrequently: true,
      });
      const parse = (c) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "#000000";
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      const lum = (rgb) => {
        const [r, g, b] = rgb.slice(0, 3).map((c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
      const effectiveBg = (el) => {
        const stack = [];
        for (let n = el; n; n = n.parentElement) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (c && c[3] > 0) {
            stack.push(c);
            if (c[3] === 1) break;
          }
        }
        let out = [255, 255, 255];
        for (const layer of stack.reverse()) out = over(layer, out);
        return out;
      };

      // The three outlines, resolved here rather than passed in, because a
      // getComputedStyle call cannot cross the evaluate boundary.
      // The legend swatch is the one target where the fill may legitimately be
      // what carries the 3:1 rather than the outline. Its fill is a ramp stop,
      // and at the parity end the ramp is deliberately almost the colour of the
      // page — so the outline has to hold it up there, while at the far end the
      // fill holds it up on its own and the outline against that fill cannot.
      // Requiring both would forbid a density ramp outright.
      const targets = [
        [".ramp-legend .swatch", "ramp swatch",
          (el) => getComputedStyle(el).borderTopColor,
          (el) => getComputedStyle(el).backgroundColor],
        ['.decomp-cell[data-kind="surcharge"]', "hollow surcharge cell",
          (el) => getComputedStyle(el).borderTopColor],
        ['.glyphless .tile[data-empty="true"]', "glyphless tile",
          (el) => getComputedStyle(el).borderTopColor],
      ];

      return targets.map(([sel, name, read, readFill]) => {
        const el = document.querySelector(sel);
        if (!el) return { name, missing: true };
        // The surface the component sits *on*, not its own fill.
        const bg = effectiveBg(el.parentElement);
        let best = ratio(over(parse(read(el)), bg), bg);
        if (readFill) best = Math.max(best, ratio(over(parse(readFill(el)), bg), bg));
        return { name, ratio: Math.round(best * 100) / 100 };
      });
    });

    process.stdout.write(`\n== ${theme} non-text outlines\n`);
    for (const r of row) {
      if (r.missing) {
        // Not "probably fine": an outline that never rendered is an outline
        // that was never checked, and this gate exists to say so out loud.
        failures.push(`${theme} ${r.name}: never rendered, so never measured`);
        process.stdout.write(`  FAIL   ${r.name} did not render\n`);
        continue;
      }
      const ok = r.ratio >= 3;
      if (!ok) failures.push(`${theme} ${r.name} outline: ${r.ratio}:1 (needs 3:1)`);
      process.stdout.write(`  ${ok ? "ok  " : "FAIL"} ${String(r.ratio).padStart(6)}:1  ${r.name}\n`);
    }
  }

  // The heatmap is the only place on the site that sets text on a ramp colour.
  // It is allowed to because ramp.ts picks near-black or near-white per cell —
  // but "picks" is a claim, so every rendered cell is measured, not sampled.
  for (const theme of ["light", "dark"]) {
    await setTheme(theme);

    const worst = await page.evaluate(() => {
      // Same pixel readback as above; see the note there for why.
      const ctx = document.createElement("canvas").getContext("2d", {
        willReadFrequently: true,
      });
      const parse = (c) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "#000000";
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b];
      };
      const lum = (rgb) => {
        const [r, g, b] = rgb.map((c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      let low = { r: Infinity, cell: "" };
      let n = 0;
      for (const td of document.querySelectorAll(".matrix-cell:not(.is-empty)")) {
        const cs = getComputedStyle(td);
        const r = ratio(parse(cs.color), parse(cs.backgroundColor));
        n += 1;
        if (r < low.r) {
          low = { r: Math.round(r * 100) / 100, cell: `${td.closest("tr").querySelector(".matrix-lang").textContent} / ${td.textContent.trim()}` };
        }
      }
      return { ...low, n };
    });

    const ok = worst.r >= MIN;
    if (!ok) failures.push(`${theme} matrix cell ink: ${worst.r}:1 at ${worst.cell}`);
    process.stdout.write(
      `\n== ${theme} matrix cells (${worst.n} measured, worst shown)\n` +
      `  ${ok ? "ok  " : "FAIL"} ${String(worst.r).padStart(6)}:1  ${worst.cell}\n`
    );
  }

  // The bar list only exists below 720px, so it needs its own pass.
  const narrow = await browser.newPage({ viewport: { width: 380, height: 900 } });
  await narrow.goto(BASE, { waitUntil: "networkidle" });
  await narrow.waitForSelector(".bar-list li");
  for (const theme of ["light", "dark"]) {
    await narrow.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await narrow.waitForTimeout(150);
    const rows = await audit(narrow, theme);
    process.stdout.write(`\n== ${theme}, 380px (bar list)\n`);
    for (const r of rows.filter((x) => x.sel.startsWith(".bar-") && !x.missing)) {
      const ok = r.ratio >= r.threshold;
      if (!ok) failures.push(`${theme} 380px ${r.sel}: ${r.ratio}:1`);
      process.stdout.write(`  ${ok ? "ok  " : "FAIL"} ${String(r.ratio).padStart(6)}:1  ${r.sel}\n`);
    }
  }
  await narrow.close();

  await browser.close();

  process.stdout.write("\n");
  if (failures.length) {
    process.stdout.write(`${failures.length} contrast failure(s):\n`);
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("all pairs meet their threshold\n");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
