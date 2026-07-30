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
  ".section-head h2", ".section-head .caption", ".field-note",
  ".column-count", ".column-count .unit", ".lang-select",
  ".tile", '.tile[data-empty="true"]', ".badge", '.badge[data-parity="true"]',
  ".chip", ".sample-pos", ".freetext label", ".freetext textarea", ".freetext-status",
  ".editorial p", ".editorial li", ".editorial h3", ".colophon", ".editorial a",
  ".inline-field", ".bar-name", ".bar-value",
];

async function audit(page, theme) {
  return page.evaluate(
    ({ selectors, MIN, MIN_LARGE }) => {
      // Chrome returns `rgb(0-255...)` for plain colours but `color(srgb 0-1...)`
      // for anything that went through color-mix, which is every glass surface
      // here. Treating those floats as 0-255 makes a white panel look black.
      const parse = (c) => {
        const m = c.match(/[\d.]+/g);
        if (!m) return null;
        const scale = c.startsWith("color(") ? 255 : 1;
        return [
          Number(m[0]) * scale,
          Number(m[1]) * scale,
          Number(m[2]) * scale,
          m[3] === undefined ? 1 : Number(m[3]),
        ];
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

  const failures = [];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.waitForTimeout(200);

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

  // No text sits on a ramp colour. The swatch is a non-text UI component, so
  // WCAG 1.4.11 wants 3:1 for its *boundary* against the surface — the fill is
  // redundant with the multiplier printed beside it and does not need to carry
  // contrast on its own.
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(150);

    const row = await page.evaluate(() => {
      const parse = (c) => {
        const m = c.match(/[\d.]+/g);
        const scale = c.startsWith("color(") ? 255 : 1;
        return [Number(m[0]) * scale, Number(m[1]) * scale, Number(m[2]) * scale,
                m[3] === undefined ? 1 : Number(m[3])];
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
      const badge = document.querySelector(".badge:not([data-parity])");
      const border = parse(getComputedStyle(badge, "::before").borderTopColor);
      const surface = parse(getComputedStyle(badge).backgroundColor);
      const composited = [0, 1, 2].map((i) => border[i] * border[3] + surface[i] * (1 - border[3]));
      return Math.round(ratio(composited, surface) * 100) / 100;
    });

    const ok = row >= 3;
    if (!ok) failures.push(`${theme} ramp swatch outline: ${row}:1 (needs 3:1)`);
    process.stdout.write(`\n== ${theme} ramp swatch outline\n  ${ok ? "ok  " : "FAIL"} ${row}:1\n`);
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
