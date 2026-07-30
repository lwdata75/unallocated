// SPDX-License-Identifier: MIT
/**
 * View 1 — the comparator. The hero.
 *
 * Same sentence, five languages, tokens as physical tiles. Columns run
 * vertically so a column's height *is* its cost, and a parity line drawn at the
 * English column's height makes every other column visibly overshoot it. The
 * contrast should land before anyone reads a word.
 */

import type { Dataset, Language } from "../lib/data";
import { scriptCode, slicePieces } from "../lib/data";
import { getState, setState, subscribe } from "../lib/state";
import { fertilityColour } from "../lib/ramp";
import * as fmt from "../lib/format";
import { getTokenizer, supportsFreeText } from "../lib/tokenize";
import { ensureScriptFont } from "../lib/fonts";

const MAX_STAGGER_MS = 360;

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

  root.innerHTML = `
    <div class="section-head">
      <h2>The same sentence, five languages</h2>
      <p class="caption">
        Each tile is one token. The dashed line marks what English costs, so
        every column above it is the surcharge. Change the tokenizer in the rail
        and watch the tiles merge.
      </p>
      <div class="sample-nav">
        <button type="button" class="chip" data-step="-1">Previous sentence</button>
        <span class="sample-pos tabular" aria-live="polite"></span>
        <button type="button" class="chip" data-step="1">Next sentence</button>
      </div>
    </div>
    <div class="tile-strip">
      <div class="columns" role="group" aria-label="Token counts by language"></div>
    </div>
    <p class="field-note caption"></p>
    <form class="freetext" novalidate>
      <label for="freetext-input">Tile your own sentence</label>
      <textarea id="freetext-input" rows="2"
        placeholder="Try a sentence in a language you read — for example, తెలుగు భాషలో ఒక వాక్యం రాయండి."></textarea>
      <div class="freetext-status" role="status"></div>
      <div class="tiles" data-role="freetext-tiles" hidden></div>
    </form>
  `;

  const columnsEl = root.querySelector<HTMLElement>(".columns")!;
  const noteEl = root.querySelector<HTMLElement>(".field-note")!;
  const posEl = root.querySelector<HTMLElement>(".sample-pos")!;
  const textarea = root.querySelector<HTMLTextAreaElement>("#freetext-input")!;
  const statusEl = root.querySelector<HTMLElement>(".freetext-status")!;
  const freeTilesEl = root.querySelector<HTMLElement>('[data-role="freetext-tiles"]')!;

  const parityLine = document.createElement("div");
  parityLine.className = "parity-line";
  columnsEl.append(parityLine);

  root.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = Number(btn.dataset.step);
      const n = data.samples.sentences.length;
      setState({ sampleIndex: (getState().sampleIndex + step + n) % n });
    });
  });

  render();

  // The tile field reflows twice on a cold load: once with fallback metrics and
  // again when the per-script Noto faces arrive. Without these the parity line
  // would be measured against the first layout and then sit at the wrong height
  // until something else triggered a render.
  void document.fonts.ready.then(() => positionParityLine());
  new ResizeObserver(() => positionParityLine()).observe(columnsEl);

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

  function render(): void {
    const state = getState();
    const sentence = data.samples.sentences[state.sampleIndex];
    const before = captureGeometry();

    columnsEl.querySelectorAll(".column").forEach((el) => el.remove());

    const englishCount = sentence.tokens["eng_Latn"]?.[state.tokenizer]?.length ?? 0;

    for (const [slot, code] of state.heroLanguages.entries()) {
      columnsEl.append(buildColumn(slot, code, sentence, englishCount, options, data));
    }

    posEl.textContent = `Sentence ${state.sampleIndex + 1} of ${data.samples.sentences.length}`;
    noteEl.textContent = describeSpread(sentence, state.tokenizer, state.heroLanguages, data);

    requestAnimationFrame(() => {
      positionParityLine();
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
   * FLIP, matched by character offset rather than by index.
   *
   * Token counts change when the tokenizer changes, so index-to-index matching
   * would be meaningless. Matching on the character a token starts at means
   * several old tiles animate into the one new tile that replaced them, which
   * reads exactly as tokens merging — the one place the animation budget goes.
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

  function positionParityLine(): void {
    const english = columnsEl.querySelector<HTMLElement>('.column[data-code="eng_Latn"] .tiles');
    if (!english) {
      parityLine.hidden = true;
      return;
    }
    parityLine.hidden = false;
    const base = columnsEl.getBoundingClientRect();
    const rect = english.getBoundingClientRect();
    parityLine.style.transform = `translateY(${rect.bottom - base.top}px)`;
    const count = english.querySelectorAll(".tile").length;
    parityLine.dataset.label = `English: ${fmt.tokens(count)} tokens`;
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

      // Same representation as samples.json, so free text and the pre-tokenized
      // columns go through one render path and cannot drift apart.
      const ends = tokenize(text);
      const pieces = slicePieces(text, ends);
      freeTilesEl.replaceChildren(...pieces.map((piece, i) => makeTile(piece, i)));
      delete freeTilesEl.dataset.loading;
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

  const badge = document.createElement("span");
  badge.className = "badge";
  if (code === "eng_Latn") {
    badge.dataset.parity = "true";
    badge.textContent = "the baseline";
  } else {
    badge.style.setProperty("--badge-swatch", fertilityColour(ratio));
    badge.textContent = fmt.multiplierVsEnglish(Number(ratio.toFixed(2)));
  }

  head.append(row, count, badge);

  const script = scriptCode(code);
  ensureScriptFont(script);

  const tiles = document.createElement("div");
  tiles.className = "tiles";
  tiles.style.fontFamily = `"Script ${script}", var(--data)`;
  tiles.setAttribute("aria-label", altTextFor(language, pieces.length, ratio, text));

  let offset = 0;
  for (const [index, piece] of pieces.entries()) {
    const tile = makeTile(piece, index, offset);
    tiles.append(tile);
    offset = ends[index];
  }

  column.append(head, tiles);
  return column;
}

function makeTile(piece: string, index: number, start = index): HTMLElement {
  const tile = document.createElement("span");
  tile.className = "tile";
  tile.dataset.start = String(start);
  if (piece === "") {
    // A token that carries no glyph: byte-level BPE split a character in two.
    tile.dataset.empty = "true";
    tile.title = "A token with no character of its own — part of a character split across tokens";
  } else {
    tile.textContent = piece;
    // The cell is uniform, so a long token clips. Keep the whole thing
    // reachable by pointer and by screen reader.
    if (piece.length > 4) {
      tile.dataset.long = "true";
      tile.title = piece;
    }
    if (/^\s/.test(piece)) tile.dataset.space = "true";
  }
  return tile;
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

function describeSpread(
  sentence: Dataset["samples"]["sentences"][number],
  tokenizer: string,
  codes: string[],
  data: Dataset
): string {
  const counts = codes
    .map((code) => ({
      name: data.byCode.get(code)?.name ?? code,
      n: sentence.tokens[code]?.[tokenizer]?.length ?? 0,
    }))
    .filter((c) => c.n > 0);
  if (counts.length < 2) return "";
  const low = counts.reduce((a, b) => (b.n < a.n ? b : a));
  const high = counts.reduce((a, b) => (b.n > a.n ? b : a));
  if (low.name === high.name) return "";
  return `Same meaning: ${fmt.tokens(low.n)} tokens in ${low.name}, ${fmt.tokens(high.n)} in ${high.name}.`;
}
