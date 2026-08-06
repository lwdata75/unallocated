// SPDX-License-Identifier: MIT
/**
 * View 1 — the comparator. The hero.
 *
 * Same sentence, five languages, tokens as physical tiles. Columns run
 * vertically so a column's height *is* its cost, and a parity line drawn at the
 * English column's height makes every other column visibly overshoot it.
 *
 * Tiles are a uniform grid on purpose: with variable-width tiles a column of
 * wide English word-tokens fills rows as fast as a column of narrow Telugu
 * fragments, so height stops tracking token count and the parity line starts
 * lying. Three columns, sized so the longest common English and French tokens
 * fit whole — the whole argument is that in English one token is one word and
 * elsewhere it is a fragment of a character, which a display truncation would
 * counterfeit.
 */

import type { Dataset, Language } from "../lib/data";
import { scriptCode, slicePieces } from "../lib/data";
import { getState, setState, subscribe } from "../lib/state";
import * as fmt from "../lib/format";
import { getTokenizer, supportsFreeText } from "../lib/tokenize";
import { ensureScriptFont } from "../lib/fonts";

const MAX_STAGGER_MS = 360;
/** U+2423 OPEN BOX. A space is a character the tokenizer charged you for. */
const VISIBLE_SPACE = "␣";

interface TileGeometry {
  start: number;
  rect: DOMRect;
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function mountComparator(root: HTMLElement, data: Dataset): void {
  const sampleLanguages = new Set(data.samples.languages.map((l) => l.code));
  const options = data.languages.languages
    .filter((l) => sampleLanguages.has(l.code))
    .sort((a, b) => a.name.localeCompare(b.name));

  // The specimen comes first, before a word of prose. The page used to open on
  // navigation, an abstract list of section names, and a paragraph — so a
  // reader met the argument about 900px after meeting the site. The tiles *are*
  // the argument, and they make it in about two seconds without being read.
  // Title, standfirst and the definition of "token" sit under them.
  //
  // Unlike every other view, this one does not write its own markup: the copy is
  // in index.html so the heading can paint before the bundle has run. What is
  // left for here is the four counts, which are read from the data like every
  // other figure on the page rather than typed into the prose around them.
  const counts: Array<[string, number]> = [
    ["n-languages", data.languages.languages.length],
    ["n-tokenizers", data.languages.tokenizers.length],
    ["n-hero", getState().heroLanguages.length],
    ["n-sentences", data.samples.sentences.length],
  ];
  for (const [role, value] of counts) {
    const slot = root.querySelector<HTMLElement>(`[data-role="${role}"]`);
    if (slot) slot.textContent = spellOut(value);
  }

  const columnsEl = root.querySelector<HTMLElement>(".columns")!;
  const noteEl = root.querySelector<HTMLElement>(".readout")!;
  const posEl = root.querySelector<HTMLElement>(".sample-pos")!;
  const textarea = root.querySelector<HTMLTextAreaElement>("#freetext-input")!;
  const statusEl = root.querySelector<HTMLElement>(".freetext-status")!;
  const freeTilesEl = root.querySelector<HTMLElement>('[data-role="freetext-tiles"]')!;

  let firstPaint = true;

  const parityLine = document.createElement("div");
  parityLine.className = "parity-line";
  parityLine.innerHTML = `<span class="parity-label tabular"></span>`;
  columnsEl.append(parityLine);

  root.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = Number(btn.dataset.step);
      const n = data.samples.sentences.length;
      setState({ sampleIndex: (getState().sampleIndex + step + n) % n });
    });
  });

  // Declared above the first render(), not below it: render() reads `strip`
  // through columnsThatFit(), and a `const` read inside a hoisted function
  // still throws if the call site precedes the declaration.
  const strip = root.querySelector<HTMLElement>(".tile-strip")!;
  /** How many columns the last render actually drew. */
  let shownCount = 0;

  render();

  // The tile field reflows twice on a cold load: once with fallback metrics and
  // again when the per-script Noto faces arrive.
  void document.fonts.ready.then(() => {
    markTruncatedTiles(columnsEl);
    positionParityLine();
  });
  // Watches the strip, not the column grid: the grid's width is a *result* of
  // how many columns were drawn, so observing it and then changing that count
  // is a feedback loop. The strip is sized by the layout and does not move when
  // the count changes. Re-rendering only on an actual change in the count keeps
  // a resize drag from re-tiling on every frame.
  new ResizeObserver(() => {
    if (columnsThatFit() !== shownCount) render();
    positionParityLine();
    updateScrollAffordance();
  }).observe(strip);

  strip.addEventListener("scroll", updateScrollAffordance, { passive: true });
  updateScrollAffordance();

  /** Fade the right edge only while there is more to scroll to. */
  function updateScrollAffordance(): void {
    const max = strip.scrollWidth - strip.clientWidth;
    strip.dataset.scrollable = max > 4 ? "true" : "false";
    strip.dataset.scrolledEnd = max > 4 && strip.scrollLeft >= max - 4 ? "true" : "false";
  }

  subscribe((_s, changed) => {
    if (
      changed.has("tokenizer") ||
      changed.has("sampleIndex") ||
      changed.has("heroLanguages") ||
      changed.has("themeTick")
    ) {
      render();
    }
    if (changed.has("tokenizer")) void renderFreeText();
  });

  let freeTextTimer: number | undefined;
  textarea.addEventListener("input", () => {
    window.clearTimeout(freeTextTimer);
    freeTextTimer = window.setTimeout(() => void renderFreeText(), 180);
  });

  // ------------------------------------------------------------------ render

  /**
   * How many language columns the strip can show whole.
   *
   * Four fit a desktop and two fit a phone, and the honest response to that is
   * to show fewer rather than to shrink them: at 380px, four columns come out
   * 78px wide, which is one tile cell too narrow for a whole English token and
   * therefore counterfeits a BPE split — the one thing this view exists not to
   * do. Scrolling the strip sideways instead would keep the columns legible and
   * hide half of them behind a gesture on the first screen of the page.
   *
   * Never fewer than two, because one column compares nothing. English is
   * always among them: it is index 0 and it is the pivot every ratio uses.
   */
  function columnsThatFit(): number {
    const cs = getComputedStyle(strip);
    const inner =
      strip.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const grid = getComputedStyle(columnsEl);
    const min = parseFloat(grid.getPropertyValue("--col-min")) || 164;
    const gap = parseFloat(grid.columnGap) || 12;
    const fit = Math.floor((inner + gap) / (min + gap));
    return Math.max(2, Math.min(getState().heroLanguages.length, fit));
  }

  function render(): void {
    const state = getState();
    const sentence = data.samples.sentences[state.sampleIndex];
    const before = captureGeometry();

    columnsEl.querySelectorAll(".column").forEach((el) => el.remove());

    const codes = state.heroLanguages.slice(0, columnsThatFit());
    shownCount = codes.length;

    const englishCount = sentence.tokens["eng_Latn"]?.[state.tokenizer]?.length ?? 0;
    // The floor is in CSS, not here, because it is a typographic constraint —
    // the narrowest a column can be and still fit a whole English token in a
    // cell — and it changes with the tile grid, which is now adaptive.
    columnsEl.style.gridTemplateColumns =
      `repeat(${codes.length}, minmax(var(--col-min), 1fr))`;

    for (const [slot, code] of codes.entries()) {
      columnsEl.append(buildColumn(slot, code, sentence, englishCount, options, data));
    }

    posEl.textContent = `Sentence ${state.sampleIndex + 1} of ${data.samples.sentences.length}`;
    // The visible codes, not all of them: the readout says "on screen right
    // now", and on a phone that is two columns rather than four.
    noteEl.innerHTML = buildReadout(sentence, state.tokenizer, codes, data);

    // The one load sequence. Tiles arrive in reading order — down the first
    // column, then the second — rather than all at once, so the specimen builds
    // itself in front of the reader instead of appearing as a finished block.
    // Once, on first paint only: every later render is a tokenizer or language
    // change, and those already have the FLIP below, which is a different and
    // more informative motion.
    if (firstPaint) {
      firstPaint = false;
      revealTiles(columnsEl);
    }

    requestAnimationFrame(() => {
      markTruncatedTiles(columnsEl);
      positionParityLine();
      updateScrollAffordance();
      animateFrom(before);
    });
  }

  function captureGeometry(): Map<string, TileGeometry[]> {
    const map = new Map<string, TileGeometry[]>();
    if (reduceMotion.matches) return map;
    for (const column of columnsEl.querySelectorAll<HTMLElement>(".column")) {
      const code = column.dataset.code!;
      const tiles: TileGeometry[] = [];
      for (const tile of column.querySelectorAll<HTMLElement>(".tile")) {
        tiles.push({ start: Number(tile.dataset.start), rect: tile.getBoundingClientRect() });
      }
      map.set(code, tiles);
    }
    return map;
  }

  /**
   * FLIP, matched by character offset rather than by index. Token counts change
   * when the tokenizer changes, so index-to-index matching would be meaningless;
   * matching on the character a token starts at means several old tiles animate
   * into the one new tile that replaced them, which reads as tokens merging.
   */
  function animateFrom(before: Map<string, TileGeometry[]>): void {
    if (before.size === 0 || reduceMotion.matches) return;

    for (const column of columnsEl.querySelectorAll<HTMLElement>(".column")) {
      const old = before.get(column.dataset.code!);
      if (!old || old.length === 0) continue;

      const tiles = [...column.querySelectorAll<HTMLElement>(".tile")];
      const stagger = Math.min(12, MAX_STAGGER_MS / Math.max(tiles.length, 1));

      for (const [index, tile] of tiles.entries()) {
        const start = Number(tile.dataset.start);
        const source = old.find((o) => o.start >= start) ?? old[old.length - 1];
        const now = tile.getBoundingClientRect();
        const dx = source.rect.left - now.left;
        const dy = source.rect.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

        tile.style.transition = "none";
        tile.style.transform = `translate(${dx}px, ${dy}px)`;
        tile.style.opacity = "0.35";

        requestAnimationFrame(() => {
          tile.style.transition = "";
          tile.style.transitionDelay = `${index * stagger}ms`;
          tile.style.transform = "";
          tile.style.opacity = "";
        });
      }
    }
  }

  /**
   * Anchored to the English column, not floated off to the right, so the label
   * sits against the thing it measures.
   */
  function positionParityLine(): void {
    const english = columnsEl.querySelector<HTMLElement>('.column[data-code="eng_Latn"] .tiles');
    const label = parityLine.querySelector<HTMLElement>(".parity-label")!;
    if (!english) {
      parityLine.hidden = true;
      return;
    }
    parityLine.hidden = false;
    const base = columnsEl.getBoundingClientRect();
    const rect = english.getBoundingClientRect();
    parityLine.style.transform = `translateY(${rect.bottom - base.top}px)`;
    const count = english.querySelectorAll(".tile").length;
    label.textContent = `English: ${fmt.tokens(count)} tokens`;
    label.style.left = `${rect.left - base.left}px`;
  }

  // --------------------------------------------------------------- free text

  async function renderFreeText(): Promise<void> {
    const text = textarea.value.trim();
    const key = getState().tokenizer;

    if (!text) {
      freeTilesEl.hidden = true;
      freeTilesEl.replaceChildren();
      statusEl.textContent = "";
      return;
    }

    if (!supportsFreeText(key)) {
      freeTilesEl.hidden = true;
      statusEl.textContent =
        `Free text runs the real tokenizer in your browser, and only the OpenAI ` +
        `families and Llama are small enough to load on a keystroke. ` +
        `Switch to GPT-2, cl100k, o200k or Llama to tile your own sentence.`;
      return;
    }

    statusEl.textContent = "Loading the tokenizer…";
    freeTilesEl.dataset.loading = "true";
    freeTilesEl.hidden = false;

    try {
      const tokenize = await getTokenizer(key);
      if (textarea.value.trim() !== text || getState().tokenizer !== key) return;

      const ends = tokenize(text);
      const pieces = slicePieces(text, ends);
      freeTilesEl.replaceChildren(...pieces.map((piece, i) => makeTile(piece, i)));
      delete freeTilesEl.dataset.loading;
      requestAnimationFrame(() => markTruncatedTiles(freeTilesEl));
      const chars = Array.from(text).length;
      statusEl.textContent =
        `${fmt.tokens(pieces.length)} tokens for ${fmt.tokens(chars)} characters ` +
        `— ${(chars / pieces.length).toFixed(1)} characters per token.`;
    } catch {
      freeTilesEl.hidden = true;
      delete freeTilesEl.dataset.loading;
      statusEl.textContent = "The tokenizer failed to load. Check your connection and try again.";
    }
  }
}

// -------------------------------------------------------------------- column

function buildColumn(
  slot: number,
  code: string,
  sentence: Dataset["samples"]["sentences"][number],
  englishCount: number,
  options: Language[],
  data: Dataset
): HTMLElement {
  const state = getState();
  const language = data.byCode.get(code);
  const text = sentence.texts[code] ?? "";
  const ends = sentence.tokens[code]?.[state.tokenizer] ?? [];
  const pieces = slicePieces(text, ends);
  const ratio = englishCount > 0 ? pieces.length / englishCount : 1;

  const column = document.createElement("div");
  column.className = "column";
  column.dataset.code = code;

  const head = document.createElement("div");
  head.className = "column-head";

  const row = document.createElement("div");
  row.className = "column-lang";

  const select = document.createElement("select");
  select.className = "lang-select";
  select.setAttribute("aria-label", `Language for column ${slot + 1}`);
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.code;
    el.textContent = option.name;
    el.selected = option.code === code;
    select.append(el);
  }
  select.addEventListener("change", () => {
    const next = [...getState().heroLanguages];
    next[slot] = select.value;
    setState({ heroLanguages: next });
  });
  row.append(select);

  const count = document.createElement("div");
  count.className = "column-count tabular";
  count.innerHTML = `${fmt.tokens(pieces.length)}<span class="unit">tokens</span>`;

  // No colour on the badge. It duplicated a number written right beside it, and
  // on a sentence where every language sits between 1.3x and 1.7x the ramp
  // collapsed to one shade and encoded nothing. Normalising per sentence would
  // be worse: the same multiplier would take a different colour depending on
  // which sentence you were looking at. The ramp keeps one anchoring and lives
  // on the scatter, where it spans its full range.
  const badge = document.createElement("span");
  badge.className = "badge";
  if (code === "eng_Latn") {
    badge.dataset.parity = "true";
    badge.textContent = "the baseline";
  } else {
    badge.textContent = fmt.multiplierVsEnglish(Number(ratio.toFixed(2)));
  }

  // No per-sentence floor block here any more. It restated, in six lines per
  // column, exactly what section three now spends a whole figure on — and those
  // six lines were what pushed the title of the page 900px down, so the first
  // screen was tiles and nothing else. The corpus medians below the tiles stay,
  // because they are the statistic a reader is most likely to want to quote.
  head.append(row, count, badge);

  const script = scriptCode(code);
  ensureScriptFont(script);

  const tiles = document.createElement("div");
  tiles.className = "tiles";
  tiles.style.fontFamily = `"Script ${script}", var(--data)`;
  tiles.setAttribute("aria-label", altTextFor(language, pieces.length, ratio, text));

  let offset = 0;
  for (const [index, piece] of pieces.entries()) {
    tiles.append(makeTile(piece, index, offset));
    offset = ends[index];
  }

  column.append(head, tiles, buildStats(language, state.tokenizer));
  return column;
}

function buildStats(language: Language | undefined, tokenizer: string): HTMLElement {
  // A <dl> may only contain dt/dd pairs (optionally wrapped in a div), so the
  // caption lives outside it rather than as a stray child.
  const block = document.createElement("div");
  block.className = "column-stats-block";
  const stats = document.createElement("dl");
  stats.className = "column-stats tabular";
  const metrics = language?.metrics.flores?.[tokenizer];
  if (!language || !metrics) return block;

  const floor = language.floors?.flores ?? language.floor;
  const excess = Math.max(metrics.tokens - floor, 0);

  // "Surcharge", not "neglect". The exported field is still `neglect` because
  // that is what the pipeline calls it, but the page has one name for the idea
  // and it is the one in the heading of section three.
  const rows: Array<[string, string, string]> = [
    ["Floor", `${fmt.tokens(floor)}`, "Fewest median tokens any of the eight tokenizers achieves"],
    [
      "Surcharge",
      excess === 0 ? "0" : `+${fmt.tokens(excess)} (${Math.round(metrics.neglect * 100)}%)`,
      "Median tokens above that floor: vocabulary never allocated to this language",
    ],
    ["Chars/token", metrics.cpt.toFixed(2), "Characters per token, a check against script density"],
  ];

  const caption = document.createElement("p");
  caption.className = "column-stats-head";
  caption.textContent = "Median across FLORES-200";
  caption.title = "Medians over all 997 FLORES-200 sentences, not the sentence shown above";

  for (const [term, value, explain] of rows) {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = term;
    dt.title = explain;
    const dd = document.createElement("dd");
    dd.textContent = value;
    wrap.append(dt, dd);
    stats.append(wrap);
  }

  block.append(caption, stats);
  return block;
}

/**
 * One tile, one token.
 *
 * Whitespace is rendered as a visible open box at low opacity rather than left
 * blank: a blank tile reads as a missing glyph, when in fact it is a space the
 * tokenizer charged for. Substituting the glyph costs no width, so the tile
 * still fits exactly what the token contains.
 */
function makeTile(piece: string, index: number, start = index): HTMLElement {
  const tile = document.createElement("span");
  tile.className = "tile";
  tile.dataset.start = String(start);

  if (piece === "") {
    // No characters at all: byte-level BPE split a character across tokens and
    // this is the continuation half. You are paying for it.
    tile.dataset.empty = "true";
    tile.title = "A token with no character of its own — part of a character split across tokens";
    tile.setAttribute("aria-label", "token with no character");
    return tile;
  }

  for (const run of piece.match(/\s+|\S+/g) ?? []) {
    const span = document.createElement("span");
    if (/^\s/.test(run)) {
      span.className = "ws";
      span.textContent = VISIBLE_SPACE.repeat(run.length);
    } else {
      span.textContent = run;
    }
    tile.append(span);
  }
  tile.title = piece;
  tile.setAttribute("aria-label", `token ${JSON.stringify(piece)}`);
  return tile;
}

/**
 * Small counts read better spelled out in running prose, large ones do not.
 *
 * These are still generated: the point of the rule is that no figure in the DOM
 * is typed by hand, not that every figure has to be a numeral. "in five of them"
 * would be a hand-typed count; `spellOut(heroLanguages.length)` is not, and it
 * changes if the default ever does.
 */
function spellOut(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six",
                 "seven", "eight", "nine", "ten", "eleven", "twelve"];
  return n < words.length ? words[n] : fmt.tokens(n);
}

/** How many groups the load sequence is quantised into, and what each is worth.
    Twelve reads as continuous at this tile size; the total is
    `(WAVES - 1) * WAVE_MS` plus the animation, which stays inside 900ms. */
const WAVES = 12;

/**
 * Stage the load sequence, then take the staging back out of the DOM.
 *
 * The obvious implementation gives each tile an inline `--i` and computes its
 * delay from that. It is also the expensive one, and expensive *permanently*:
 * an inline style makes an element's computed style unshareable, so 190 tiles
 * with 190 distinct values means 190 full style computations on every recalc
 * for the rest of the session, not just during the animation. Measured at
 * 6.5ms per forced recalc against 2.3ms without — and a tokenizer switch forces
 * several.
 *
 * So: twelve buckets carried on an attribute, which shares styles normally, and
 * both the attribute and the flag are removed once the sequence has finished.
 * After the first second the DOM is in exactly the state it would have been in
 * with no animation at all.
 */
function revealTiles(columns: HTMLElement): void {
  if (reduceMotion.matches) return;
  const tiles = [...columns.querySelectorAll<HTMLElement>(".tile")];
  if (tiles.length === 0) return;

  const per = Math.ceil(tiles.length / WAVES);
  for (const [i, tile] of tiles.entries()) {
    tile.dataset.wave = String(Math.min(WAVES - 1, Math.floor(i / per)));
  }
  columns.dataset.reveal = "true";

  window.setTimeout(() => {
    delete columns.dataset.reveal;
    for (const tile of tiles) delete tile.dataset.wave;
  }, 1000);
}

/**
 * Flag tiles whose text does not fit, so a display truncation is never mistaken
 * for a BPE split. Measured after layout rather than guessed from string
 * length, because glyph widths vary wildly between scripts.
 */
function markTruncatedTiles(scope: HTMLElement): void {
  for (const tile of scope.querySelectorAll<HTMLElement>(".tile")) {
    if (tile.dataset.empty === "true") continue;
    const overflowing = tile.scrollWidth - tile.clientWidth > 1;
    if (overflowing) tile.dataset.truncated = "true";
    else delete tile.dataset.truncated;
  }
}

function altTextFor(
  language: Language | undefined,
  count: number,
  ratio: number,
  text: string
): string {
  const name = language?.name ?? "This language";
  if (ratio === 1) return `${name}: ${count} tokens. ${text}`;
  return `${name}: ${count} tokens, ${fmt.multiplier(ratio)} what English costs for the same sentence.`;
}

interface ColumnFacts {
  name: string;
  tokens: number;
  /** Fewest tokens any of the eight tokenizers spends on this exact sentence. */
  floor: number;
  excess: number;
  ratio: number;
}

function columnFacts(
  sentence: Dataset["samples"]["sentences"][number],
  tokenizer: string,
  codes: string[],
  data: Dataset
): ColumnFacts[] {
  const english = sentence.tokens["eng_Latn"]?.[tokenizer]?.length ?? 0;
  const out: ColumnFacts[] = [];
  for (const code of codes) {
    const perTokenizer = sentence.tokens[code];
    const n = perTokenizer?.[tokenizer]?.length ?? 0;
    if (!perTokenizer || n === 0) continue;
    const floor = Math.min(...Object.values(perTokenizer).map((ends) => ends.length));
    out.push({
      name: data.byCode.get(code)?.name ?? code,
      tokens: n,
      floor,
      excess: Math.max(n - floor, 0),
      ratio: english > 0 ? n / english : 1,
    });
  }
  return out;
}

/**
 * The readout under the tiles.
 *
 * Floor and neglect are the two ideas the whole study turns on, and they used to
 * appear on screen as a bare pair of numbers whose only explanation was a
 * `title` tooltip. They are explained here, once, in the place a reader first
 * meets them.
 *
 * The second paragraph is the part worth having: it looks at what is actually
 * displayed and names a column that is expensive *and at its floor* against one
 * that is expensive *because of neglect*. That contrast is the argument, and
 * with the default five languages it is usually sitting right there on screen —
 * Burmese runs well past the parity line with nothing above its floor, while
 * Telugu's surcharge is mostly vocabulary nobody spent. Naming them beats
 * asserting the distinction in the abstract.
 */
function buildReadout(
  sentence: Dataset["samples"]["sentences"][number],
  tokenizer: string,
  codes: string[],
  data: Dataset
): string {
  const facts = columnFacts(sentence, tokenizer, codes, data);
  if (facts.length < 2) return "";

  const low = facts.reduce((a, b) => (b.tokens < a.tokens ? b : a));
  const high = facts.reduce((a, b) => (b.tokens > a.tokens ? b : a));
  const spread =
    low.name === high.name
      ? ""
      : `Same meaning, priced twice: ${fmt.tokens(low.tokens)} tokens in
         ${low.name}, ${fmt.tokens(high.tokens)} in ${high.name}.`;

  // A column that costs well over English while sitting at its floor is the
  // clean counterexample to "expensive scripts are just expensive".
  const atFloor = facts
    .filter((f) => f.ratio > 1.2 && f.excess === 0)
    .sort((a, b) => b.ratio - a.ratio)[0];
  // And the largest excess is the other half of the same contrast.
  const neglected = facts
    .filter((f) => f.excess > 0)
    .sort((a, b) => b.excess - a.excess)[0];

  let contrast = "";
  if (atFloor && neglected && atFloor.name !== neglected.name) {
    contrast = `
      <p class="readout-case">
        On screen right now: <strong>${atFloor.name}</strong> costs
        ${fmt.multiplier(atFloor.ratio)} what English does and yet sits exactly at
        its floor — expensive because of its writing system, not because of
        neglect. <strong>${neglected.name}</strong> carries
        ${fmt.tokens(neglected.excess)} tokens above its own floor. That part is
        not the script. That part is the choice.
      </p>`;
  } else if (neglected) {
    contrast = `
      <p class="readout-case">
        On screen right now: <strong>${neglected.name}</strong> carries
        ${fmt.tokens(neglected.excess)} tokens above its own floor — tokens no
        writing system requires. Switch tokenizers and watch that number move
        while the sentence does not.
      </p>`;
  }

  return `
    <p class="readout-spread">${spread}</p>
    <p class="readout-key">
      <span><strong>Floor</strong> — the fewest tokens any of the
        ${data.languages.tokenizers.length} tokenizers here spends on this exact
        sentence. A stand-in for what the writing system genuinely needs.</span>
      <span><strong>Surcharge</strong> — everything on top of that. Vocabulary
        that could have been allocated to this language and was not.</span>
    </p>
    ${contrast}`;
}
