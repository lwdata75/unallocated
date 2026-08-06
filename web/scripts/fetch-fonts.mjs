// SPDX-License-Identifier: MIT
/**
 * Self-host every font the site uses. Run once: `npm run fonts`.
 *
 * Script rendering is a functional requirement here, not a polish item — if
 * Telugu or Burmese falls back to a system font the hero is simply wrong, and
 * on a machine with no Ethiopic font installed it renders as boxes. So nothing
 * is loaded from a font CDN at runtime and nothing relies on system fallback.
 *
 * Google's CSS endpoint splits each family into `unicode-range` chunks. We keep
 * that structure rather than flattening it: a visitor reading the Latin hero
 * downloads a few KB of Archivo, and the 3 MB of Japanese glyph data is only
 * fetched if a Japanese column is actually on screen.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const OUT_DIR = path.resolve(import.meta.dirname, "../public/fonts");
const INDEX_HTML = path.resolve(import.meta.dirname, "../index.html");

// One small blocking stylesheet for the three UI faces, then one stylesheet per
// writing system, fetched only when a language using it is actually on screen.
// Shipping all thirty in one file meant ~390 KB of @font-face rules of which a
// given visitor uses three or four.
const UI_CSS_OUT = path.join(OUT_DIR, "fonts-ui.css");
const scriptCssPath = (code) => path.join(OUT_DIR, `script-${code}.css`);

// A modern UA is required or Google serves ttf instead of woff2.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Chrome-tier faces. Two families, not three.
 *
 * The display tier is the same monospace that renders the tokens. That is the
 * one type decision on this site that could not be lifted onto a different
 * subject: a heading set in the face the specimen is set in looks like it has
 * been through the tokenizer too, and the wordmark reads as a measurement
 * rather than as a brand. It is a wide face, so it carries only short strings —
 * wordmark, step marks, section titles, every number.
 *
 * Prose is Newsreader, variable on optical size, so the same file sets a 44px
 * lede and 17px body without either looking like the other scaled. Low contrast
 * on purpose: the high-contrast display serif is the current house style of
 * generated pages and this is a paper, not a poster.
 *
 * Archivo and Instrument Sans are gone. Two families is fewer bytes than three
 * and the site no longer has a sans register to be inconsistent about.
 */
/*
 * One weight per entry, deliberately. Asking for `wght@400;700` in a single
 * request makes Google serve the *variable* file, which is 47 KB of Latin for
 * the mono against 21 KB for the two static instances, and 140 KB against 71 KB
 * for the serif. Splitting the request is worth roughly 90 KB on a page whose
 * performance floor is 93.
 *
 * The optical-size axis goes with it. Newsreader ships one, and it would have
 * been the reason to choose a variable file, but it costs 57 KB of Latin
 * against 22 KB pinned — for a page with four heading sizes that is not a
 * trade worth making.
 */
const UI_FAMILIES = [
  "Martian+Mono:wght@400",
  "Martian+Mono:wght@700",
  "Newsreader:wght@400",
  "Newsreader:wght@600",
  "Newsreader:ital,wght@1,400",
];

/**
 * Of those, the ones the first screen actually paints with: the wordmark and
 * the cold-open title (mono 700), every token tile and every number (mono 400),
 * and the prose under the specimen (serif 400). Bold and italic prose appear
 * further down and can arrive on their own.
 *
 * Preloading all five put 92 KB in front of first paint. These three are 43 KB,
 * which is less than the three families this replaced.
 */
const PRELOAD_FAMILIES = new Set([
  "Martian+Mono:wght@400",
  "Martian+Mono:wght@700",
  "Newsreader:wght@400",
]);

/**
 * Per-script faces. Keyed by the ISO 15924 code the pipeline puts in each
 * language's `script` property, so the frontend can pick a stack by data rather
 * than by hardcoded language checks.
 */
const SCRIPT_FAMILIES = {
  Grek: "Noto+Sans:wght@400",
  Cyrl: "Noto+Sans:wght@400",
  Hebr: "Noto+Sans+Hebrew:wght@400",
  Arab: "Noto+Sans+Arabic:wght@400",
  Deva: "Noto+Sans+Devanagari:wght@400",
  Beng: "Noto+Sans+Bengali:wght@400",
  Telu: "Noto+Sans+Telugu:wght@400",
  Taml: "Noto+Sans+Tamil:wght@400",
  Knda: "Noto+Sans+Kannada:wght@400",
  Mlym: "Noto+Sans+Malayalam:wght@400",
  Guru: "Noto+Sans+Gurmukhi:wght@400",
  Gujr: "Noto+Sans+Gujarati:wght@400",
  Orya: "Noto+Sans+Oriya:wght@400",
  Sinh: "Noto+Sans+Sinhala:wght@400",
  Thai: "Noto+Sans+Thai:wght@400",
  Laoo: "Noto+Sans+Lao:wght@400",
  Khmr: "Noto+Sans+Khmer:wght@400",
  Mymr: "Noto+Sans+Myanmar:wght@400",
  Ethi: "Noto+Sans+Ethiopic:wght@400",
  Armn: "Noto+Sans+Armenian:wght@400",
  Geor: "Noto+Sans+Georgian:wght@400",
  Tibt: "Noto+Serif+Tibetan:wght@400",
  Olck: "Noto+Sans+Ol+Chiki:wght@400",
  Tfng: "Noto+Sans+Tifinagh:wght@400",
  Adlm: "Noto+Sans+Adlam:wght@400",
  Cans: "Noto+Sans+Canadian+Aboriginal:wght@400",
  Jpan: "Noto+Sans+JP:wght@400",
  Hang: "Noto+Sans+KR:wght@400",
  Hans: "Noto+Sans+SC:wght@400",
  Hant: "Noto+Sans+TC:wght@400",
};

async function fetchCss(spec, display) {
  const url = `https://fonts.googleapis.com/css2?family=${spec}&display=${display}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${spec}: ${res.status} ${res.statusText}`);
  return res.text();
}

const downloaded = new Map(); // remote url -> local filename

async function localise(css) {
  const urls = [...css.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map((m) => m[1]);
  for (const url of new Set(urls)) {
    if (downloaded.has(url)) continue;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    // Content-hashed name: stable across runs, safe to cache immutably.
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const name = `${url.split("/").slice(-2, -1)[0]}-${hash}.woff2`.replace(/[^\w.-]/g, "_");
    await writeFile(path.join(OUT_DIR, name), bytes);
    downloaded.set(url, name);
  }
  return css.replace(
    /url\((https:\/\/[^)]+\.woff2)\)/g,
    (_m, url) => `url(/fonts/${downloaded.get(url)})`
  );
}

/** Strip comments and collapse whitespace. These files are served as-is. */
function minify(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s*([{}:;,])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/;}/g, "}")
    .trim();
}

/** The woff2 subsets covering basic Latin, which every page needs immediately. */
function latinSubsets(css) {
  const out = [];
  for (const block of css.split("@font-face")) {
    if (!/unicode-range:[^;]*U\+0000|unicode-range:[^;]*U\+00[0-9a-f]{2}-/i.test(block)) continue;
    const url = block.match(/url\((\/fonts\/[^)]+\.woff2)\)/);
    if (url) out.push(url[1]);
  }
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const banner = "/* Generated by scripts/fetch-fonts.mjs. Self-hosted, no font CDN. */";

  // UI faces: display=swap is fine, they are preloaded below so the swap
  // happens before first paint in practice.
  const ui = [];
  const preloads = new Set();
  for (const spec of UI_FAMILIES) {
    process.stdout.write(`ui   ${spec}\n`);
    const css = await localise(await fetchCss(spec, "swap"));
    ui.push(minify(css));
    if (PRELOAD_FAMILIES.has(spec)) {
      for (const url of latinSubsets(css)) preloads.add(url);
    }
  }
  await writeFile(UI_CSS_OUT, `${banner}\n${ui.join("")}`, "utf8");

  // Script faces: display=block. These render inside fixed-size tiles, so a
  // brief blank tile costs nothing, whereas swapping in a fallback and then
  // replacing it reflows the whole tile field and wrecks cumulative layout
  // shift. Each family is renamed to a predictable `Script <Code>` face so the
  // stylesheet can be chosen from a language's script property alone.
  let scriptBytes = 0;
  for (const [code, spec] of Object.entries(SCRIPT_FAMILIES)) {
    process.stdout.write(`s.   ${code.padEnd(5)} ${spec}\n`);
    const css = await localise(await fetchCss(spec, "block"));
    const renamed = minify(css.replace(/font-family:\s*'[^']+'/g, `font-family:'Script ${code}'`));
    await writeFile(scriptCssPath(code), `${banner}\n${renamed}`, "utf8");
    scriptBytes += renamed.length;
  }

  // Inject preload tags for the Latin UI subsets into index.html.
  const tags = [...preloads]
    .map((u) => `    <link rel="preload" as="font" type="font/woff2" href="${u}" crossorigin />`)
    .join("\n");
  const html = await readFile(INDEX_HTML, "utf8");
  const updated = html.replace(
    /(<!-- fonts:preload -->)[\s\S]*?(<!-- \/fonts:preload -->)/,
    `$1\n${tags}\n    $2`
  );
  if (updated === html && !html.includes("<!-- fonts:preload -->")) {
    process.stdout.write("\nwarning: no <!-- fonts:preload --> markers in index.html\n");
  }
  await writeFile(INDEX_HTML, updated, "utf8");

  // Provenance manifest. pipeline/src/refresh_sources.py reads this so font
  // rows in sources.toml are generated rather than hand-typed. Hashing the CSS
  // transitively covers the woff2 bytes, because their filenames are
  // content-hashed by localise() above.
  const { createHash: hashOf } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const cssSha = (p) => hashOf("sha256").update(readFileSync(p)).digest("hex");
  const manifest = {
    generated: new Date().toISOString().slice(0, 10),
    source: "https://fonts.googleapis.com/css2",
    licence: "SIL Open Font License 1.1",
    spdx: "OFL-1.1",
    families: [
      { key: "ui", spec: UI_FAMILIES.join(" + "), css: "fonts-ui.css", sha256: cssSha(UI_CSS_OUT) },
      ...Object.entries(SCRIPT_FAMILIES).map(([code, spec]) => ({
        key: code,
        spec: spec.replace(/\+/g, " ").replace(/:wght@.*/, ""),
        css: `script-${code}.css`,
        sha256: cssSha(scriptCssPath(code)),
      })),
    ],
  };
  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  const { statSync } = await import("node:fs");
  process.stdout.write(
    `\n${downloaded.size} woff2 files -> public/fonts/\n` +
      `fonts-ui.css   ${statSync(UI_CSS_OUT).size} bytes (blocking)\n` +
      `script-*.css   ${Object.keys(SCRIPT_FAMILIES).length} files, ${scriptBytes} bytes total (on demand)\n` +
      `preloaded      ${preloads.size} Latin woff2 subsets\n`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
