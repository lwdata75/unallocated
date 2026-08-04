// SPDX-License-Identifier: MIT
/**
 * The opening. An abstract, not a hero.
 *
 * The site used to begin mid-argument, on a grid of tiles, with the thesis
 * filed 2,200px down inside a section headed "Methodology and limits" — which
 * is the one heading that tells a reader they can skip it. A study should say
 * what it found before it shows the working.
 *
 * So: the claim in one sentence, the word "token" defined (it was never defined
 * anywhere in the interface, and the entire study is denominated in it), and
 * then one chart that is the whole argument — the same Telugu sentences priced
 * by four tokenizers, against an English reference line. Telugu's writing system
 * does not change down that chart. Only the vocabulary spent on it does.
 *
 * Every number is read from headline.json. Nothing here is typed by hand, so
 * the opening cannot drift away from the pipeline the way a hand-written
 * headline would.
 */

import type { Dataset } from "../lib/data";
import { fertilityColour } from "../lib/ramp";
import { getState, subscribe } from "../lib/state";
import * as fmt from "../lib/format";

/** Display names for the four tokenizers in the demonstration chart. */
const NAMES: Record<string, string> = {
  gpt2: "GPT-2",
  cl100k: "cl100k",
  o200k: "o200k",
  bloom: "BLOOM",
};

/** What each of those four is, in four words, so the chart is self-explaining. */
const ROLES: Record<string, string> = {
  gpt2: "2019, English-first",
  cl100k: "2022, GPT-3.5 / 4",
  o200k: "2024, GPT-4o",
  bloom: "2022, multilingual-first",
};

export function mountOpening(root: HTMLElement, data: Dataset): void {
  const figures = data.headline.figures;
  const telugu = figures.telugu_median_tokens?.values;
  const english = figures.english_median_tokens?.values;

  root.innerHTML = `
    <div class="opening">
      <p class="eyebrow">A measurement study · ${data.languages.languages.length} languages ·
        ${data.languages.tokenizers.length} tokenizers</p>

      <h2 class="lede">
        Every language except English pays a surcharge to talk to a language
        model. <em>Most of that surcharge is not the language.</em>
      </h2>

      <p class="standfirst">
        Models do not read characters, they read <strong>tokens</strong> — the
        chunks a tokenizer cuts text into, and the unit you are billed in, and
        the unit a context window is measured in. In English a token is usually a
        whole word. In most other languages it is a fragment of one, sometimes a
        fragment of a single character. This study measures how much more every
        language costs, and separates the part its writing system genuinely
        requires from the part that is simply vocabulary nobody allocated.
      </p>

      ${demonstration(telugu, english)}

      <nav class="arc" aria-label="How this study is laid out">
        <ol>
          <li><a href="#comparator"><span class="arc-n">1</span>
            <span class="arc-t">See it</span>
            <span class="arc-d">One sentence, five languages, every token as a tile</span></a></li>
          <li><a href="#claim"><span class="arc-n">2</span>
            <span class="arc-t">The claim</span>
            <span class="arc-d">Why this is an allocation choice and not a property of scripts</span></a></li>
          <li><a href="#scatter"><span class="arc-n">3</span>
            <span class="arc-t">All ${data.languages.languages.length}</span>
            <span class="arc-d">Cost against speakers, for every language measured</span></a></li>
          <li><a href="#methodology"><span class="arc-n">4</span>
            <span class="arc-t">Method &amp; limits</span>
            <span class="arc-d">How it was measured, what it does not claim, where it could be wrong</span></a></li>
        </ol>
      </nav>
    </div>
  `;

  // The chart bars are the one place in the opening that depends on the ramp,
  // and the ramp is rebuilt on a theme change. Repaint rather than re-render, so
  // the section does not flash.
  subscribe((_s, changed) => {
    if (!changed.has("themeTick")) return;
    for (const bar of root.querySelectorAll<HTMLElement>(".demo-bar")) {
      bar.style.background = fertilityColour(Number(bar.dataset.ratio));
    }
  });

  // Focus follows the anchor: the arc links jump the reader down the page, and
  // the target section has to become the keyboard's position too, or the next
  // Tab lands back at the top of the rail.
  for (const link of root.querySelectorAll<HTMLAnchorElement>(".arc a")) {
    link.addEventListener("click", () => {
      const target = document.querySelector<HTMLElement>(link.getAttribute("href")!);
      if (!target) return;
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
  }

  void getState;
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
    return `<p class="caption">The demonstration chart needs <code>data/headline.json</code>,
      which this deployment did not serve.</p>`;
  }

  const keys = Object.keys(telugu);
  const max = Math.max(...keys.map((k) => telugu[k]));

  // Each row's multiplier is against *its own* tokenizer's English count, which
  // is the only honest comparison. The single reference rule cannot be, because
  // the four English counts are not identical — they differ by a token. It is
  // drawn at the largest, which is the conservative choice: it makes every bar's
  // overshoot look smaller rather than larger. The note says the real range.
  const engLow = Math.min(...keys.map((k) => english[k]));
  const engHigh = Math.max(...keys.map((k) => english[k]));
  const eng = engHigh;
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
        <strong>The same sentences in Telugu, priced by four tokenizers.</strong>
        Median tokens per sentence across 997 FLORES-200 sentences.
      </figcaption>
      <ol class="demo-rows" style="--eng: ${(eng / max) * 100}%">
        ${rows}
      </ol>
      <p class="demo-note">
        <span class="demo-ref-key"></span>
        English costs ${engText} for the same meaning — the dashed line.
        Telugu's writing system does not change down this chart. Only how much
        vocabulary was spent on it does.
      </p>
    </figure>`;
}
