/**
 * The methodology section. Not a footnote — a real section, linked from the
 * rail. Stating the limits plainly is what makes this read as research rather
 * than advocacy, so nothing here is softened.
 */

import type { Dataset } from "../lib/data";
import { rampStops } from "../lib/ramp";
import * as fmt from "../lib/format";

export function mountMethodology(root: HTMLElement, data: Dataset): void {
  const meta = data.languages.meta;
  const stops = rampStops();

  root.innerHTML = `
    <div class="editorial">
      <div class="section-head">
        <h2>Methodology and limits</h2>
      </div>

      <h3>What is being measured</h3>
      <p>
        For each language and each tokenizer, fertility is the median ratio of
        token counts between that language and English, computed
        <em>per aligned sentence pair</em> and then medianed. FLORES-200 and
        MASSIVE are both sentence-aligned, so sentence <em>n</em> in Telugu
        carries the same meaning as sentence <em>n</em> in English and the ratio
        measures cost per unit of meaning rather than cost per unit of text.
        Dividing one median by the other would look similar and would quietly
        throw the pairing away.
      </p>
      <p>
        The floor is the lowest median token count any tokenizer here achieves
        for a language — a stand-in for the cost inherent to its writing system.
        Neglect is everything above that floor. The floor is empirical, so it is
        an upper bound: a better tokenizer outside this set would lower it and
        make the neglect figures larger, not smaller.
      </p>

      <h3>Sources</h3>
      <ul>
        <li>
          <strong>FLORES-200</strong>, ${fmt.tokens(meta.n_sentences.flores)} sentences
          of Wikipedia-register prose in 204 language-script pairs, professionally
          translated. Licence CC-BY-SA-4.0.
        </li>
        <li>
          <strong>MASSIVE 1.1</strong>, a seeded ${fmt.tokens(meta.n_sentences.massive)}-utterance
          sample of short conversational commands across 52 locales, used to check
          that the finding survives a change of register. Licence CC-BY-4.0.
        </li>
        <li>
          Language family and macro-region from <strong>Glottolog</strong> (CC-BY-4.0);
          speaker counts from <strong>Wikidata</strong> property P1098 (CC0). Ethnologue's
          figures are more complete but licence-restricted, so they are not used.
        </li>
      </ul>
      <p>
        Eight tokenizer families, one representative each, all run locally on CPU.
        Every axis label names a <em>family</em>, never a model version. Nothing
        here is a claim about model quality, and it is not a leaderboard.
      </p>

      <h3>What these numbers do not support</h3>
      <ul>
        <li>
          <strong>Any currency figure is illustrative.</strong> Per-token pricing
          varies by provider, by model, and between input and output, and it
          changes often. A multiplier is a fact about the tokenizer; a price is
          an example of what that multiplier might cost you today.
        </li>
        <li>
          <strong>FLORES is translationese.</strong> Every non-English sentence
          is a translation of an English source. That is what makes it aligned
          and therefore usable, but translated prose tracks English structure
          more closely than native writing does. If anything this understates the
          surcharge. MASSIVE is included as a partial control and agrees closely:
          the rank correlation between the two corpora is above 0.95 for every
          tokenizer.
        </li>
        <li>
          <strong>Fertility is a proxy, and the money is the least of it.</strong>
          More tokens means a smaller share of the context window for the same
          document, and there is good reason to think a language chopped into
          byte fragments is modelled worse than one with whole-word tokens. The
          capability ceiling is arguably the more serious harm, and this study
          does not measure it.
        </li>
        <li>
          <strong>Speaker counts are contested.</strong> They depend on whether
          second-language speakers are counted, on how a macrolanguage is
          subdivided, and on census politics. They are used here for dot size and
          ordering, not for any quantitative claim.
        </li>
      </ul>

      <h3>Reading the colour</h3>
      <p>
        The ramp is diverging and anchored at parity, so a language that costs
        the same as English reads as neutral rather than as the good end of a
        scale.
      </p>
      <ul class="ramp-legend">
        ${stops
          .map(
            (s) =>
              `<li><span class="swatch" style="background:${s.colour}"></span><span class="tabular">${fmt.multiplier(s.value)}</span></li>`
          )
          .join("")}
      </ul>

      <h3>Validation</h3>
      <p>
        The pipeline fails rather than exports. Five gates run as tests before
        any JSON is written: English fertility must be exactly 1.0 for every
        tokenizer; every language present in both corpora must carry a full set
        of rows in both; a 200-sentence sample must survive a decode round-trip
        for each tokenizer; no language may score below 0.85× without a written
        explanation; and the rank correlation between the two corpora must
        exceed 0.7. Two languages currently hold written exemptions, both
        Chinese on BLOOM in the conversational corpus, and both are real rather
        than measurement errors.
      </p>
      <p class="colophon">
        Data generated ${meta.generated}. Full method, source substitutions and
        licences in <a href="https://github.com/lwdata75/Flores/blob/main/METHODOLOGY.md">METHODOLOGY.md</a>;
        pipeline and site in <a href="https://github.com/lwdata75/Flores">the repository</a>.
      </p>
    </div>
  `;
}
