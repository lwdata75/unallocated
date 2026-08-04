// SPDX-License-Identifier: MIT
/**
 * The conclusion.
 *
 * A study that stops at the scatter has shown a pattern and drawn no inference
 * from it. This section draws the inference, and shows the one quantity that
 * makes it actionable: for each language, the distance between the cheapest and
 * the most expensive vocabulary measured.
 *
 * That distance is the argument in a single number. Neither end of it is a
 * property of the language — the same sentences, the same script, the same
 * corpus sit behind both dots. Everything between them was decided by whoever
 * assembled a vocabulary. A language whose dots nearly touch is being served
 * about as well as this set of tokenizers knows how; a language whose dots are
 * far apart is paying for someone's scope decision, and the gap is roughly what
 * a better allocation would return.
 *
 * The chart is a dumbbell rather than a bar because a bar would imply a quantity
 * measured from zero. This is a distance between two measured points, and
 * drawing it as one keeps that honest.
 */

import type { Dataset, Language } from "../lib/data";
import { fertilityColour } from "../lib/ramp";
import { subscribe } from "../lib/state";
import { figureSpan } from "../lib/figures";
import * as fmt from "../lib/format";

const SHOWN = 18;

interface Gap {
  language: Language;
  bestKey: string;
  worstKey: string;
  best: number;
  worst: number;
}

export function mountConclusion(root: HTMLElement, data: Dataset): void {
  const tokenizers = data.languages.tokenizers;
  const fig = (key: string): string => figureSpan(data.headline.figures, key);

  const gaps: Gap[] = data.languages.languages
    .map((language): Gap | null => {
      const metrics = language.metrics.flores;
      if (!metrics) return null;
      const present = tokenizers
        .map((t) => ({ key: t.key, f: metrics[t.key]?.fertility }))
        .filter((r): r is { key: string; f: number } => typeof r.f === "number" && r.f > 0);
      if (present.length < 2) return null;
      const best = present.reduce((a, b) => (b.f < a.f ? b : a));
      const worst = present.reduce((a, b) => (b.f > a.f ? b : a));
      return {
        language,
        bestKey: best.key,
        worstKey: worst.key,
        best: best.f,
        worst: worst.f,
      };
    })
    .filter((g): g is Gap => g !== null)
    .filter((g) => g.language.code !== "eng_Latn")
    .sort((a, b) => b.language.speakers - a.language.speakers)
    .slice(0, SHOWN);

  const familyOf = (key: string): string =>
    tokenizers.find((t) => t.key === key)?.family ?? key;

  root.innerHTML = `
    <div class="editorial">
      <div class="section-head">
        <p class="step-mark">Step 6 of 7 · what follows</p>
        <h2>The gap between the two dots is the choice</h2>
        <p class="caption">
          Each language below is drawn twice: once at the cheapest vocabulary
          measured here, once at the most expensive. The sentences behind both
          dots are identical. Everything between them was decided by somebody.
        </p>
      </div>
    </div>

    <figure class="gaps">
      <ol class="gap-rows"></ol>
      <div class="gap-axis" aria-hidden="true">
        <span></span>
        <span class="gap-axis-track"></span>
        <span></span>
      </div>
      <figcaption>
        The ${SHOWN} most-spoken languages other than English, on FLORES-200.
        Position is tokens per sentence against English, on a log scale —
        so equal distances are equal multiples, not equal token counts.
        A dot left of 1× is a language that costs <em>less</em> than English on
        that vocabulary, which happens and is not an error.
      </figcaption>
    </figure>

    <div class="editorial">
      <h3>What this study concludes</h3>
      <p>
        <strong>The surcharge is real, it is large, and most of it is not linguistic.</strong>
        Every language measured costs more than English on every tokenizer here,
        which is unsurprising: English is the pivot and the corpus was written in
        it first. What is not a matter of definition is the size of the gap
        between vocabularies for the <em>same</em> language. Telugu is the clean
        case — ${fig("telugu_floor_and_neglect")} — but the pattern is general,
        and the chart above is what it looks like across the languages most people
        actually speak.
      </p>
      <p>
        <strong>"Multilingual" is not a property a tokenizer has. It is a list.</strong>
        BLOOM, built multilingual-first, is not broadly better —
        ${fig("median_fertility_bloom_vs_o200k")} across all 204 languages, and it
        ${fig("bloom_beats_o200k_count")} of them. It is dramatically better on the
        languages inside its training scope and ordinary outside it. The same is
        true in the other direction: o200k's improvement over cl100k is real and
        went to particular places.
      </p>
      <p>
        <strong>The clearest evidence is the languages that did not move.</strong>
        Llama-3 added roughly 28,000 tokens to cl100k_base and left
        ${fig("llama3_identical_to_cl100k")} languages at fertility identical to
        the last decimal. Nothing about those languages resisted improvement.
        They were not in scope.
      </p>

      <h3>What would change this conclusion</h3>
      <p>
        This is stated as a prediction so it can fail. If a tokenizer appeared
        that lowered the floor for a script — through better byte-level handling
        of conjuncts, say — every neglect figure here would grow, because the
        floor is the best of eight and therefore an upper bound. If a future
        vocabulary raised the currently-unmoved languages, the count above would
        drop and the gap chart would compress. Both are measurable with this same
        pipeline, and the code to re-run it is in the repository.
      </p>
      <p>
        What would <em>not</em> change it is a better model. Fertility is a
        property of the tokenizer, and a model with an expensive tokenizer can
        still be the best available for a given task. This study measures the
        price of the ticket, not the quality of the journey.
      </p>

      <h3>Why it is worth measuring at all</h3>
      <p>
        Because the cost is invisible at the point of use. A per-token price looks
        neutral — everyone pays the same rate — and the inequality lives entirely
        in how many tokens the same meaning takes. The reader who pays twice as
        much and gets half the context window has no way to see that from the
        price list. Putting a number on it is the whole contribution here; the
        numbers are all reproducible, all reported with their referents, and all
        wrong in ways stated in the next section.
      </p>
    </div>
  `;

  const rowsEl = root.querySelector<HTMLElement>(".gap-rows")!;
  const axisEl = root.querySelector<HTMLElement>(".gap-axis-track")!;

  /** Same ticks the scatter uses, so the two charts read on one mental scale.
      Declared before the first draw(): a `const` read from inside a hoisted
      function still throws if the call happens above the declaration. */
  const TICKS = [1, 1.5, 2, 3, 5, 8, 14];

  draw();
  subscribe((_s, changed) => {
    if (changed.has("themeTick")) draw();
  });

  function draw(): void {
    const max = Math.max(...gaps.map((g) => g.worst));
    const min = Math.min(...gaps.map((g) => g.best));
    // Log, so the row for a 1.2x–1.4x language and the row for a 1.3x–9.6x one
    // are comparable as *multiples* rather than as token counts. The domain
    // starts at the cheapest measured rather than at 1.0, because some languages
    // genuinely come in under English and clamping them to the left edge would
    // hide that.
    const lo = Math.log(Math.min(min, 1));
    const span = Math.log(max) - lo;
    const pos = (f: number): number => ((Math.log(f) - lo) / span) * 100;

    const ticks = TICKS.filter((t) => t >= Math.min(min, 1) && t <= max);

    axisEl.innerHTML = ticks
      .map(
        (t) =>
          `<span class="gap-tick" style="left:${pos(t)}%"><em>${fmt.multiplier(t)}</em></span>`
      )
      .join("");

    // Gridlines painted into each track rather than overlaid on the block: the
    // track is the only element whose box matches the scale, so drawing them
    // anywhere else would need the column width duplicated in two places.
    const grid =
      "linear-gradient(to right," +
      ticks
        .map(
          (t) =>
            `transparent calc(${pos(t)}% - 0.5px), var(--gap-grid) calc(${pos(t)}% - 0.5px),` +
            ` var(--gap-grid) calc(${pos(t)}% + 0.5px), transparent calc(${pos(t)}% + 0.5px)`
        )
        .join(",") +
      ")";
    rowsEl.style.setProperty("--gap-grid-image", grid);

    rowsEl.innerHTML = gaps
      .map((g) => {
        const left = pos(g.best);
        const right = pos(g.worst);
        return `
        <li>
          <span class="gap-name">${g.language.name}<em>${fmt.speakers(g.language.speakers)}</em></span>
          <span class="gap-track">
            <span class="gap-bar" style="left:${left}%; width:${Math.max(right - left, 0.4)}%"></span>
            <span class="gap-dot" style="left:${left}%; background:${fertilityColour(g.best)}"
                  title="${fmt.multiplier(g.best)} English on ${familyOf(g.bestKey)} — the cheapest measured"></span>
            <span class="gap-dot" style="left:${right}%; background:${fertilityColour(g.worst)}"
                  title="${fmt.multiplier(g.worst)} English on ${familyOf(g.worstKey)} — the most expensive measured"></span>
          </span>
          <span class="gap-value tabular">${fmt.multiplier(g.best)}<em>→ ${fmt.multiplier(g.worst)}</em></span>
        </li>`;
      })
      .join("");
  }
}
