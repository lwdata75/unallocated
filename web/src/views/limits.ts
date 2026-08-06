// SPDX-License-Identifier: MIT
/**
 * Section 7 — what this does not claim.
 *
 * A section, not a footnote and not a disclosure widget. It used to be an
 * unstyled <ul> two thirds of the way down a section headed "Method and
 * limits", which is the one heading that tells a reader they may skip what
 * follows. A study is worth about as much as the objections it states against
 * itself, so these are set at reading size, in the reading column, with the
 * negation carried by the heading of each card rather than buried mid-sentence.
 *
 * Two registers, kept apart on purpose. The first list is what the study
 * refuses to say even if every number is right. The second is where the numbers
 * themselves could be wrong.
 */

import type { Dataset } from "../lib/data";
import { figureSpan } from "../lib/figures";

/** Each: the refusal, then why someone would want to make the claim anyway. */
const NOT_CLAIMED: Array<[string, string]> = [
  [
    "Nothing about model quality",
    `Fertility is a property of a tokenizer, not of a model. A model with an
     expensive tokenizer may still be the best available for a given task, and
     nothing here is evidence against it.`,
  ],
  [
    "No ranking of model versions",
    `Comparisons are between tokenizer <em>families</em>, one representative
     each, and every axis label says so. Vendors ship several checkpoints per
     family; this is not a leaderboard and cannot be read as one.`,
  ],
  [
    "No price",
    `Per-token pricing varies by provider, by model, and between input and
     output, and it changes often. A multiplier is a measurement. A currency
     figure would be a worked example dressed as one, so this site does not
     print a single one.`,
  ],
  [
    "No causal claim about behaviour",
    `High fertility plausibly degrades output quality and effective context —
     arguably the more serious harm of the two. This study measures token
     counts. It does not measure capability, and the link is left as a
     conjecture rather than smuggled in as a finding.`,
  ],
  [
    "No claim that the floor is the true floor",
    `The floor is the best of the eight tokenizers measured, so it is an upper
     bound on what a writing system requires. A better tokenizer would lower it
     and make every surcharge on this page larger. The estimates here are the
     conservative direction of wrong.`,
  ],
];

export function mountLimits(root: HTMLElement, data: Dataset): void {
  const fig = (key: string): string => figureSpan(data.headline.figures, key);

  root.innerHTML = `
    <div class="section-head">
      <p class="step-mark">Seven</p>
      <h2>What this does not claim</h2>
      <p class="standfirst">
        Everything above is a measurement of one quantity. These are the things
        it would be easy, and wrong, to read into it.
      </p>
    </div>

    <ul class="limits">
      ${NOT_CLAIMED.map(
        ([title, body]) => `
        <li>
          <h3>${title}</h3>
          <p>${body}</p>
        </li>`
      ).join("")}
    </ul>

    <div class="editorial">
      <h3>And where the numbers themselves could be wrong</h3>
      <p>
        The list above holds even if every figure is exact. These three are
        reasons a figure might not be.
      </p>
      <ul>
        <li>
          <strong>FLORES is translationese.</strong> Every non-English sentence
          in it is a translation of an English source. That is what makes it
          aligned and usable, and it also means the prose tracks English
          structure more closely than native writing would. If anything this
          understates the surcharge. MASSIVE, a spoken-register corpus, is a
          partial control and agrees closely: Spearman ρ between the two is
          ${fig("cross_corpus_rank_correlation")} across the eight tokenizers.
        </li>
        <li>
          <strong>Speaker counts are contested.</strong> They depend on whether
          second-language speakers are counted, on how a macrolanguage is
          subdivided, and on census politics. They are used here for dot size
          and ordering and for nothing quantitative.
        </li>
        <li>
          <strong>A median discards the tail.</strong> Medians throughout, so a
          handful of pathological sentences cannot drive a result — but tail cost
          is what actually decides whether a document fits a context window, so
          the 90th percentile is exported alongside every figure.
        </li>
      </ul>
    </div>
  `;
}
