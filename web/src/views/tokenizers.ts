// SPDX-License-Identifier: MIT
/**
 * Section 2 — it is not the writing system.
 *
 * The specimen above establishes that other languages cost more. The obvious
 * explanation is that their scripts are harder, and this section is the one
 * that rules it out: same language, same script, same 997 sentences, four
 * tokenizers, and a spread from 325 tokens to 34.
 *
 * One variable moves down this chart and it is not the language. That is the
 * whole reason the rest of the study is worth reading, so it goes second and it
 * gets a section rather than a paragraph.
 *
 * Every number comes from headline.json. Nothing here is typed by hand, so the
 * section cannot drift away from the pipeline the way a written-out headline
 * would.
 */

import type { Dataset } from "../lib/data";
import { fertilityColour } from "../lib/ramp";
import { subscribe } from "../lib/state";
import { figureSpan } from "../lib/figures";
import * as fmt from "../lib/format";

/** Display names for the four tokenizers in the chart. */
const NAMES: Record<string, string> = {
  gpt2: "GPT-2",
  cl100k: "cl100k",
  o200k: "o200k",
  bloom: "BLOOM",
};

/** What each one is, in four words, so the chart explains itself. */
const ROLES: Record<string, string> = {
  gpt2: "2019, English-first",
  cl100k: "2022, GPT-3.5 / 4",
  o200k: "2024, GPT-4o",
  bloom: "2022, multilingual-first",
};

export function mountTokenizers(root: HTMLElement, data: Dataset): void {
  const figures = data.headline.figures;
  const fig = (key: string): string => figureSpan(figures, key);
  const telugu = figures.telugu_median_tokens?.values;
  const english = figures.english_median_tokens?.values;

  root.innerHTML = `
    <div class="section-head">
      <p class="step-mark">Two</p>
      <h2>It is not the writing system</h2>
      <p class="standfirst">
        The same Telugu sentences, priced by four tokenizers. Telugu's script
        does not change down this chart. Only how much vocabulary was spent on
        it does.
      </p>
    </div>

    ${demonstration(telugu, english)}

    <div class="editorial">
      <p>
        Nothing distinguishes the top row from the bottom one except which
        vocabulary is doing the charging. Same sentences, same alphabet, same
        conjunct clusters, same 997 rows of FLORES-200. A script that genuinely
        needed 325 tokens per sentence could not be made to need 34 by a
        different vendor shipping a different word list.
      </p>
      <p>
        The improvement between GPT-2 and o200k is real, and it is not evenly
        distributed. Counting how many languages sit above twice and above four
        times what English costs: GPT-2 puts
        ${fig("gpt2_over_thresholds")}, and o200k puts
        ${fig("o200k_over_thresholds")}. That is a large gain, and it went
        somewhere in particular — which is what the two sections after this one
        are about.
      </p>
      ${figuresTable(figures)}
    </div>
  `;

  // The bars are the one thing here that depends on the ramp, and the ramp is
  // rebuilt on a theme change. Repaint rather than re-render, so nothing flashes.
  subscribe((_s, changed) => {
    if (!changed.has("themeTick")) return;
    for (const bar of root.querySelectorAll<HTMLElement>(".demo-bar")) {
      bar.style.background = fertilityColour(Number(bar.dataset.ratio));
    }
  });
}

/**
 * The argument as a chart.
 *
 * Bars are median tokens per sentence over the whole FLORES dev split, so this
 * is not an anecdote about one sentence. The English reference is drawn as a
 * vertical rule rather than a fifth bar because it is the baseline the other
 * four are measured against, not another case.
 *
 * Widths are linear in token count and share one scale, so 325 really is drawn
 * nine and a half times the length of 34. A log scale would have been kinder to
 * the layout and would have flattened the entire point.
 */
function demonstration(
  telugu: Record<string, number> | undefined,
  english: Record<string, number> | undefined
): string {
  if (!telugu || !english) {
    // A stale deploy missing headline.json loses the chart, not the section.
    return `<p class="caption">The chart needs <code>data/headline.json</code>,
      which this deployment did not serve.</p>`;
  }

  const keys = Object.keys(telugu);
  const max = Math.max(...keys.map((k) => telugu[k]));

  // Each row's multiplier is against *its own* tokenizer's English count, which
  // is the only honest comparison. The single reference rule cannot be, because
  // the four English counts are not identical — they differ by a token. It is
  // drawn at the largest, which is the conservative choice: it makes every bar's
  // overshoot look smaller rather than larger. The note states the real range.
  const engLow = Math.min(...keys.map((k) => english[k]));
  const engHigh = Math.max(...keys.map((k) => english[k]));
  const engText =
    engLow === engHigh
      ? `${fmt.tokens(engHigh)} tokens`
      : `${fmt.tokens(engLow)}–${fmt.tokens(engHigh)} tokens depending on the tokenizer`;

  const rows = keys
    .map((key) => {
      const t = telugu[key];
      const ratio = t / english[key];
      return `
      <li>
        <span class="demo-name">${NAMES[key] ?? key}<em>${ROLES[key] ?? ""}</em></span>
        <span class="demo-track">
          <span class="demo-bar" data-ratio="${ratio}"
                style="width:${(t / max) * 100}%; background:${fertilityColour(ratio)}"></span>
        </span>
        <span class="demo-value tabular">${fmt.tokens(t)}<em>${fmt.multiplier(ratio)}</em></span>
      </li>`;
    })
    .join("");

  return `
    <figure class="demo">
      <figcaption>
        Median tokens per sentence, Telugu, across 997 FLORES-200 sentences.
      </figcaption>
      <ol class="demo-rows" style="--eng: ${(engHigh / max) * 100}%">
        ${rows}
      </ol>
      <p class="demo-note">
        <span class="demo-ref-key"></span>
        English costs ${engText} for the same meaning — the dashed line.
      </p>
    </figure>`;
}

/**
 * The same four rows as exact figures, with the English column restored.
 *
 * "325 on gpt2, 208 on cl100k, 48 on o200k, 34 on bloom" is a table pretending
 * to be prose: four rows of three values, read serially. Rendered as a table it
 * can be scanned, and the ratio column is shown rather than computed in the
 * reader's head.
 */
function figuresTable(figures: Dataset["headline"]["figures"]): string {
  const telugu = figures.telugu_median_tokens?.values;
  const english = figures.english_median_tokens?.values;
  if (!telugu || !english) return "";

  const rows = Object.keys(telugu)
    .map((key) => {
      const t = telugu[key];
      const e = english[key];
      return `<tr>
        <th scope="row">${NAMES[key] ?? key}</th>
        <td class="tabular">${t}</td>
        <td class="tabular">${e}</td>
        <td class="tabular">${(t / e).toFixed(1)}×</td>
      </tr>`;
    })
    .join("");

  return `
    <table class="figures">
      <caption>
        Median tokens per sentence, FLORES-200 dev split (997 sentences).
      </caption>
      <thead>
        <tr><th scope="col">Tokenizer</th><th scope="col">Telugu</th>
            <th scope="col">English</th><th scope="col">Ratio</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}
