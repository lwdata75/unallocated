// SPDX-License-Identifier: MIT
/**
 * The claim.
 *
 * This used to live inside the methodology section, under the heading
 * "Methodology and limits" — which is the one heading that tells a reader they
 * may skip what follows. It is the actual argument of the study, so it is now a
 * section of its own, sitting between the demonstration a reader has just
 * played with and the 204-language scatter that generalises it.
 *
 * The order is deliberate and matches the README: allocation finding, then the
 * clearest case, then the aggregate, then the falsifiable prediction. A site and
 * a repository that tell different stories about the same data are worse than
 * either alone.
 *
 * Every number comes from headline.json with its referent attached.
 */

import type { Dataset } from "../lib/data";
import { figureSpan } from "../lib/figures";

/**
 * "325 on gpt2, 208 on cl100k, 48 on o200k, 34 on bloom" is a table pretending
 * to be prose: four rows of three values, read serially. Rendered as an actual
 * table it can be scanned, the ratio column can be shown rather than computed in
 * the reader's head, and the paragraph is left holding only the conclusion.
 */
function figuresTable(figures: Dataset["headline"]["figures"]): string {
  const telugu = figures.telugu_median_tokens?.values;
  const english = figures.english_median_tokens?.values;
  if (!telugu || !english) return "";

  const NAMES: Record<string, string> = {
    gpt2: "GPT-2",
    cl100k: "cl100k",
    o200k: "o200k",
    bloom: "BLOOM",
  };

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

export function mountClaim(root: HTMLElement, data: Dataset): void {
  const figures = data.headline.figures;
  const fig = (key: string): string => figureSpan(figures, key);
  const nLanguages = data.languages.languages.length;

  root.innerHTML = `
    <div class="editorial">
      <div class="section-head">
        <p class="step-mark">Step 3 of 7 · the argument</p>
        <h2>Most of the surcharge is a choice</h2>
        <p class="caption">
          The tiles show that other languages cost more. They do not, on their
          own, say why. This is the part that does. Hover any figure to see the
          statistic and sample it refers to.
        </p>
      </div>

      <h3>Allocation is scoped, not general</h3>
      <p>
        <strong>Vocabulary allocation is a scoped choice, not a general virtue.</strong>
        BLOOM was built multilingual-first with a 250k vocabulary. Its median
        fertility across all ${nLanguages} languages is
        ${fig("median_fertility_bloom_vs_o200k")} for OpenAI's o200k — slightly
        worse overall. On Bengali it costs ${fig("bengali_bloom_vs_o200k")}. It
        wins on ${fig("bloom_beats_o200k_count")} languages and loses on the rest.
        ROOTS, BLOOM's training corpus, covered roughly 46 languages, and the
        boundary of that list is visible in the measurements. Nobody bought
        "multilingual"; they bought a specific list.
      </p>

      <h3>The clearest case</h3>
      <p>
        <strong>The demonstration.</strong> The chart at the top of this page, as
        exact figures and with the English column restored — the same sentences
        in Telugu and in English, priced by four tokenizer families. Telugu's
        writing system does not change down this table; only how much vocabulary
        was spent on it.
      </p>
      ${figuresTable(figures)}
      <p>
        Decomposed: ${fig("telugu_floor_and_neglect")}. The floor is what the
        script inherently needs; the rest is vocabulary nobody spent. On GPT-2,
        ${fig("telugu_glyphless_share")} of Telugu tokens contain no character at
        all — they are byte fragments of characters the vocabulary cannot
        represent whole. This is the clearest single case, but it is evidence for
        the claim above, not the claim itself.
      </p>

      <h3>How far it goes</h3>
      <p>
        <strong>The aggregate.</strong> On GPT-2,
        ${fig("gpt2_over_thresholds")}. On o200k, ${fig("o200k_over_thresholds")}.
        The improvement between them is real and it is uneven — which is the
        point: it went where someone sent it.
      </p>

      <h3>The prediction that could be wrong</h3>
      <p>
        <strong>The negative space.</strong> Llama-3 extends cl100k_base by
        roughly 28,000 tokens. For ${fig("llama3_identical_to_cl100k")} languages
        it reports fertility identical to cl100k to the last decimal — Telugu
        sits at ${fig("telugu_llama3_and_cl100k")} — because none of those
        additions went to them. That is falsifiable: add coverage for any of
        those languages and the count drops.
      </p>
    </div>
  `;
}
