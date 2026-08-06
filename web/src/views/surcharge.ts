// SPDX-License-Identifier: MIT
/**
 * Section 3 — floor and surcharge. The centre of the study, and the one place
 * the page spends its boldness.
 *
 * The site is called Unallocated, so the motif is negative space, drawn
 * literally: every token a language spends is one cell, the cells the writing
 * system genuinely needs are solid, and the rest are hollow. The vocabulary
 * nobody spent becomes a visible absence in the grid instead of a percentage in
 * a caption.
 *
 * Three figures, in the order the reader needs them:
 *
 *   A. The decomposition. Solid floor, hollow surcharge, separating as the
 *      section enters. Cell *counts* are measured; which cells are drawn where
 *      is a convention, and the caption says so.
 *   B. The glyphless specimen. A real sentence, real token boundaries, and the
 *      tokens that contain no character at all drawn hollow. Here the hollow
 *      cells are true one by one, not just in aggregate — those tokens really
 *      are empty, and you really are paying for them.
 *   C. What the surcharge buys you less of. The same context window, measured
 *      in sentences of each language.
 *
 * Deliberately no price anywhere. Per-token rates change monthly and a
 * measurement should not.
 */

import type { Dataset, Language } from "../lib/data";
import { slicePieces, scriptCode } from "../lib/data";
import { fertilityColour } from "../lib/ramp";
import { getState, subscribe } from "../lib/state";
import { ensureScriptFont } from "../lib/fonts";
import { figureSpan } from "../lib/figures";
import * as fmt from "../lib/format";

/** Round numbers spanning the range current models offer. Not attributed to any
    named model: this study does not rank model versions. */
const WINDOWS = [
  { tokens: 8_000, label: "8k" },
  { tokens: 32_000, label: "32k" },
  { tokens: 128_000, label: "128k" },
  { tokens: 1_000_000, label: "1M" },
];
const DEFAULT_WINDOW = 128_000;

/** Drawing more than this many cells stops being a picture and starts being a
    wall — and past it the grid is taller than a phone screen. Beyond the cap the
    figure switches to one cell per N tokens and says so. */
const MAX_CELLS = 420;

export function mountSurcharge(root: HTMLElement, data: Dataset): void {
  const fig = (key: string): string => figureSpan(data.headline.figures, key);

  // Languages that have a sample sentence, so figure B can always be drawn for
  // whatever figure A is showing.
  const sampled = new Set(data.samples.languages.map((l) => l.code));
  const options = data.languages.languages
    .filter((l) => sampled.has(l.code) && l.code !== "eng_Latn")
    .sort((a, b) => b.speakers - a.speakers);

  let code = options.some((l) => l.code === "tel_Telu") ? "tel_Telu" : options[0]?.code;
  let windowSize = DEFAULT_WINDOW;

  root.innerHTML = `
    <div class="section-head">
      <p class="step-mark">Three</p>
      <h2>Floor and surcharge</h2>
      <p class="standfirst">
        Some of what a language costs is its writing system. The rest is
        vocabulary that was never allocated to it. These are different things,
        they can be separated, and almost nothing on the internet separates them.
      </p>
    </div>

    <div class="decomp-controls">
      <label class="control-label" for="decomp-lang">Language</label>
      <select id="decomp-lang" class="lang-select">
        ${options
          .map(
            (l) =>
              `<option value="${l.code}"${l.code === code ? " selected" : ""}>${l.name}</option>`
          )
          .join("")}
      </select>
      <p class="control-hint">
        Tokenizer is the one in the rail — change it and watch the hollow half
        of the figure grow or collapse while the sentence stays exactly the same.
      </p>
    </div>

    <figure class="decomp" data-role="decomp">
      <div class="decomp-body">
        <div class="decomp-row">
          <span class="decomp-legend">
            <span class="decomp-key" data-kind="floor"></span>
            <span class="decomp-legend-text">Floor<em data-role="floor-n"></em></span>
          </span>
          <div class="decomp-grid" data-role="floor-grid"></div>
        </div>
        <div class="decomp-row decomp-surcharge" data-role="surcharge-row">
          <span class="decomp-legend">
            <span class="decomp-key" data-kind="surcharge"></span>
            <span class="decomp-legend-text">Surcharge<em data-role="surcharge-n"></em></span>
          </span>
          <div class="decomp-grid" data-role="surcharge-grid"></div>
        </div>
      </div>
      <figcaption data-role="decomp-caption"></figcaption>
    </figure>

    <div class="editorial">
      <p>
        <strong>The floor</strong> is the fewest median tokens any of the
        ${data.languages.tokenizers.length} tokenizers here spends on a language.
        It stands in for what the writing system genuinely requires, because
        there is no independent measure of that — which also means it is an
        <em>upper</em> bound. A better tokenizer than any of these would push it
        down and make every surcharge on this page larger, never smaller.
      </p>
      <p>
        <strong>The surcharge</strong> is everything above that floor. It is not
        a property of the language. It is the distance between the vocabulary a
        language got and the best vocabulary anyone has actually built for it.
        For Telugu on GPT-2: ${fig("telugu_floor_and_neglect")}.
      </p>
      <p>
        There is a case where this stops being an accounting identity and becomes
        visible in the text itself. On GPT-2,
        ${fig("telugu_glyphless_share")} of Telugu tokens contain no character at
        all — the vocabulary has no entry for the character, so it is spelled out
        in raw bytes and the trailing pieces carry nothing you could print. Below
        is one real sentence, with its real token boundaries. The hollow cells
        are empty tokens, one by one, and you are billed for every one of them.
      </p>
    </div>

    <figure class="glyphless">
      <div class="glyphless-tiles tiles" data-role="glyphless"></div>
      <figcaption data-role="glyphless-caption"></figcaption>
    </figure>

    <div class="editorial">
      <h3>What the surcharge buys you less of</h3>
      <p>
        A context window is a fixed budget of tokens, not of words or characters.
        So a language that spends more tokens per sentence gets less of its
        document considered at once — on the same window, for the same money.
      </p>
    </div>

    <div class="capacity">
      <div class="capacity-controls" role="group" aria-label="Context window size">
        <span class="control-label">Window</span>
        <div class="segmented">
          ${WINDOWS.map(
            (w) => `<button type="button" class="seg" data-tokens="${w.tokens}"
              aria-pressed="${w.tokens === DEFAULT_WINDOW}">${w.label}</button>`
          ).join("")}
          <span class="seg-unit">tokens</span>
        </div>
      </div>
      <ol class="capacity-rows"></ol>
      <p class="capacity-note"></p>
    </div>
  `;

  const select = root.querySelector<HTMLSelectElement>("#decomp-lang")!;
  select.addEventListener("change", () => {
    code = select.value;
    renderDecomposition();
    renderGlyphless();
  });

  for (const btn of root.querySelectorAll<HTMLButtonElement>(".seg")) {
    btn.addEventListener("click", () => {
      windowSize = Number(btn.dataset.tokens);
      for (const other of root.querySelectorAll<HTMLButtonElement>(".seg")) {
        other.setAttribute("aria-pressed", String(other === btn));
      }
      renderCapacity();
    });
  }

  subscribe((_s, changed) => {
    if (changed.has("tokenizer") || changed.has("themeTick")) {
      renderDecomposition();
      renderGlyphless();
    }
    if (changed.has("tokenizer") || changed.has("heroLanguages") || changed.has("themeTick")) {
      renderCapacity();
    }
  });

  renderDecomposition();
  renderGlyphless();
  renderCapacity();

  // ------------------------------------------------------- A. decomposition

  function renderDecomposition(): void {
    const figure = root.querySelector<HTMLElement>('[data-role="decomp"]')!;
    const floorGrid = root.querySelector<HTMLElement>('[data-role="floor-grid"]')!;
    const overGrid = root.querySelector<HTMLElement>('[data-role="surcharge-grid"]')!;
    const caption = root.querySelector<HTMLElement>('[data-role="decomp-caption"]')!;
    const floorN = root.querySelector<HTMLElement>('[data-role="floor-n"]')!;
    const overN = root.querySelector<HTMLElement>('[data-role="surcharge-n"]')!;

    const tokenizer = getState().tokenizer;
    const language = data.byCode.get(code);
    const metrics = language?.metrics.flores?.[tokenizer];
    if (!language || !metrics) return;

    const floor = language.floors?.flores ?? language.floor;
    const total = metrics.tokens;
    const excess = Math.max(total - floor, 0);

    // One cell per token while that is legible; past the cap, one cell per N,
    // with the divisor stated in the caption rather than left to be inferred.
    const per = Math.ceil(total / MAX_CELLS);
    const cells = (n: number): number => Math.round(n / per);

    figure.style.setProperty("--decomp-ink", fertilityColour(metrics.fertility));
    floorGrid.innerHTML = cellRun(cells(floor), "floor");
    overGrid.innerHTML = cellRun(cells(excess), "surcharge");
    floorN.textContent = `${fmt.tokens(floor)} tokens`;
    overN.textContent = excess === 0 ? "none" : `${fmt.tokens(excess)} tokens`;

    const family = data.languages.tokenizers.find((t) => t.key === tokenizer)?.family ?? tokenizer;
    const scale =
      per === 1
        ? "One cell is one token."
        : `One cell is ${per} tokens — ${fmt.tokens(total)} of them would not fit on a screen.`;

    caption.innerHTML =
      `<strong>${language.name} on ${family}:</strong> ${fmt.tokens(total)} median tokens ` +
      `per sentence, of which ${fmt.tokens(floor)} is the floor and ` +
      `${fmt.tokens(excess)} is surcharge` +
      (excess === 0
        ? ` — this vocabulary is the best of the ${data.languages.tokenizers.length} for this language, so there is nothing above the floor to draw.`
        : ` — ${Math.round((excess / total) * 100)}% of what you pay.`) +
      ` ${scale} The two counts are measured; which cell goes where is a drawing ` +
      `convention, because the floor is a quantity and not a particular set of tokens.`;

    // The empty case would otherwise be an unlabelled void.
    figure.dataset.empty = String(excess === 0);
  }

  function cellRun(n: number, kind: string): string {
    if (n <= 0) return "";
    return `<span class="decomp-cell" data-kind="${kind}"></span>`.repeat(n);
  }

  // ---------------------------------------------------- B. glyphless specimen

  function renderGlyphless(): void {
    const host = root.querySelector<HTMLElement>('[data-role="glyphless"]')!;
    const caption = root.querySelector<HTMLElement>('[data-role="glyphless-caption"]')!;
    const tokenizer = getState().tokenizer;

    // The first sample sentence, so the specimen is the same text a reader has
    // already seen tiled at the top of the page.
    const sentence = data.samples.sentences[0];
    const text = sentence?.texts[code];
    const ends = sentence?.tokens[code]?.[tokenizer];
    if (!text || !ends) {
      host.replaceChildren();
      caption.textContent = "";
      return;
    }

    const pieces = slicePieces(text, ends);
    const empty = pieces.filter((p) => p === "").length;
    const script = scriptCode(code);
    ensureScriptFont(script);
    host.style.fontFamily = `"Script ${script}", var(--data)`;

    host.innerHTML = pieces
      .map((piece) =>
        piece === ""
          ? `<span class="tile" data-empty="true" aria-label="token with no character"
               title="A token with no character of its own — part of a character split across tokens"></span>`
          : `<span class="tile">${escapeHtml(piece).replace(/\s/g, "<span class='ws'>␣</span>")}</span>`
      )
      .join("");

    const language = data.byCode.get(code);
    const family = data.languages.tokenizers.find((t) => t.key === tokenizer)?.family ?? tokenizer;
    caption.innerHTML =
      `One FLORES-200 sentence in ${language?.name ?? code}, tokenized by ` +
      `<strong>${family}</strong>: ${fmt.tokens(pieces.length)} tokens, of which ` +
      `<strong>${fmt.tokens(empty)}</strong> carry no character` +
      (pieces.length > 0 ? ` (${Math.round((empty / pieces.length) * 100)}%)` : "") +
      `. Counted from this sentence's own token boundaries, so it will not match ` +
      `the corpus-wide share above exactly.`;
  }

  // -------------------------------------------------------------- C. capacity

  function renderCapacity(): void {
    const rowsEl = root.querySelector<HTMLElement>(".capacity-rows")!;
    const noteEl = root.querySelector<HTMLElement>(".capacity-note")!;
    const state = getState();

    const rows = state.heroLanguages
      .map((languageCode) => {
        const language = data.byCode.get(languageCode);
        const m = language?.metrics.flores?.[state.tokenizer];
        if (!language || !m) return null;
        return {
          name: language.name,
          sentences: Math.floor(windowSize / m.tokens),
          chars: Math.round(windowSize * m.cpt),
          fertility: m.fertility,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length === 0) {
      rowsEl.replaceChildren();
      noteEl.textContent = "";
      return;
    }

    const max = Math.max(...rows.map((r) => r.sentences));
    rowsEl.innerHTML = rows
      .map(
        (r) => `
        <li>
          <span class="capacity-name">${r.name}</span>
          <span class="capacity-track">
            <span class="capacity-bar" style="width:${(r.sentences / max) * 100}%;
                  background:${fertilityColour(r.fertility)}"></span>
          </span>
          <span class="capacity-value tabular">${fmt.tokens(r.sentences)}<em>sentences</em></span>
        </li>`
      )
      .join("");

    // The comparison a reader actually wants, in words rather than left to be
    // computed from two bars.
    const english = rows.find((r) => r.name === "English") ?? rows[0];
    const worst = rows.reduce((a, b) => (b.sentences < a.sentences ? b : a));
    const family =
      data.languages.tokenizers.find((t) => t.key === state.tokenizer)?.family ?? "";

    noteEl.innerHTML =
      worst.name === english.name
        ? `On ${family}, this window holds ${fmt.tokens(english.sentences)} sentences.`
        : `On <strong>${family}</strong>, ${fmt.article(windowSize)}
           ${fmt.tokens(windowSize)}-token window holds
           <strong>${fmt.tokens(english.sentences)}</strong> sentences of ${english.name}
           and <strong>${fmt.tokens(worst.sentences)}</strong> of ${worst.name} —
           ${Math.round((worst.sentences / english.sentences) * 100)}% as much of the
           same document, for the same window and the same price. As raw text that
           is ${fmt.tokens(Math.round(english.chars / 1000))}k characters against
           ${fmt.tokens(Math.round(worst.chars / 1000))}k.`;
  }

  void (options as Language[]);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
