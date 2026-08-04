// SPDX-License-Identifier: MIT
/**
 * What the surcharge actually costs — the context window.
 *
 * The tiles show that other languages spend more tokens. That is abstract until
 * you say what a token buys. A context window is a fixed budget of them, so the
 * same window holds a different amount of *meaning* depending on the language it
 * is holding: the surcharge is not only money, it is how much of a document a
 * model can consider at once.
 *
 * Both figures on screen are derived, not assumed:
 *
 *   sentences that fit  = window / median tokens per sentence
 *   characters that fit = window × characters per token
 *
 * The second one falls out cleanly because characters-per-token is measured over
 * the same corpus: window × (chars/token) is chars, with the token count
 * cancelling. Neither involves a price, a provider, or a model — deliberately,
 * because those change monthly and a measurement should not.
 *
 * The window sizes are round numbers spanning what current models offer. They
 * are not attributed to any particular model: this study does not rank model
 * versions, and pinning "128k" to a named product would be doing exactly that.
 */

import type { Dataset } from "../lib/data";
import { fertilityColour } from "../lib/ramp";
import { getState, subscribe } from "../lib/state";
import * as fmt from "../lib/format";

/** Round numbers spanning the range current models offer. */
const WINDOWS = [
  { tokens: 8_000, label: "8k" },
  { tokens: 32_000, label: "32k" },
  { tokens: 128_000, label: "128k" },
  { tokens: 1_000_000, label: "1M" },
];

const DEFAULT_WINDOW = 128_000;

export function mountCapacity(root: HTMLElement, data: Dataset): void {
  let windowSize = DEFAULT_WINDOW;

  root.innerHTML = `
    <div class="section-head">
      <p class="step-mark">Step 2 of 7 · what it costs</p>
      <h2>The same window holds less of your language</h2>
      <p class="caption">
        A context window is how much text a model can hold in mind at once, and
        it is measured in tokens — not in words, not in characters. So a language
        that spends more tokens per sentence gets less of its document
        considered, on the same window, for the same money.
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

  const rowsEl = root.querySelector<HTMLElement>(".capacity-rows")!;
  const noteEl = root.querySelector<HTMLElement>(".capacity-note")!;

  for (const btn of root.querySelectorAll<HTMLButtonElement>(".seg")) {
    btn.addEventListener("click", () => {
      windowSize = Number(btn.dataset.tokens);
      for (const other of root.querySelectorAll<HTMLButtonElement>(".seg")) {
        other.setAttribute("aria-pressed", String(other === btn));
      }
      render();
    });
  }

  // Shares heroLanguages with the comparator on purpose: swapping a column up
  // there changes the cast down here too, so the two sections are visibly the
  // same five languages rather than two unrelated exhibits.
  subscribe((_s, changed) => {
    if (changed.has("tokenizer") || changed.has("heroLanguages") || changed.has("themeTick")) {
      render();
    }
  });

  render();

  function render(): void {
    const state = getState();
    const rows = state.heroLanguages
      .map((code) => {
        const language = data.byCode.get(code);
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

    // The comparison a reader actually wants, stated in words rather than left
    // to be computed from two bars.
    const english = rows.find((r) => r.name === "English") ?? rows[0];
    const worst = rows.reduce((a, b) => (b.sentences < a.sentences ? b : a));
    const family =
      data.languages.tokenizers.find((t) => t.key === getState().tokenizer)?.family ?? "";

    noteEl.innerHTML =
      worst.name === english.name
        ? `On ${family}, this window holds ${fmt.tokens(english.sentences)} sentences.`
        : `On <strong>${family}</strong>, a ${fmt.tokens(windowSize)}-token window holds
           <strong>${fmt.tokens(english.sentences)}</strong> sentences of ${english.name}
           and <strong>${fmt.tokens(worst.sentences)}</strong> of ${worst.name} —
           ${Math.round((worst.sentences / english.sentences) * 100)}% as much of the
           same document, for the same window and the same price. Measured as raw
           text that is ${fmt.tokens(Math.round(english.chars / 1000))}k characters
           against ${fmt.tokens(Math.round(worst.chars / 1000))}k.`;
  }
}
