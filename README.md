<!-- SPDX-License-Identifier: MIT -->

# Unallocated

What tokenizer vocabularies were spent on, and what they weren't.

**[unallocated.netlify.app](https://unallocated.netlify.app/)**

A data study measuring how many tokens the same meaning costs in 204 languages
across eight tokenizer families. Static site, pre-aggregated JSON, no backend.

> Every number below is generated from `web/public/data/headline.json` and
> substituted in mechanically. Nothing here is typed by hand, and a gate fails
> the build if a document drifts from the data.

## The finding

**Vocabulary allocation is a scoped choice, not a general virtue.** BLOOM, built
multilingual-first with a 250k vocabulary, has a median fertility across all 204
languages of <!--fig:median_fertility_bloom_vs_o200k-->1.80× against 1.74×<!--/fig--> for OpenAI's `o200k` — slightly
*worse* overall. Yet on Bengali it costs <!--fig:bengali_bloom_vs_o200k-->1.18× against 1.69×<!--/fig-->. It beats `o200k` on
<!--fig:bloom_beats_o200k_count-->93 of 204<!--/fig--> languages and loses on the rest. ROOTS, BLOOM's training corpus,
covered roughly 46 languages, and that coverage boundary is legible in the
measurements. Nobody bought "multilingual"; they bought a specific list.

**What that costs, in one language.** Telugu's median FLORES-200 sentence takes
<!--fig:telugu_median_tokens-->325 on gpt2, 208 on cl100k, 48 on o200k, 34 on bloom<!--/fig--> tokens. The same sentences in
English take <!--fig:english_median_tokens-->25 on gpt2, 25 on cl100k, 24 on o200k, 25 on bloom<!--/fig-->. Telugu's writing system did
not change across those four columns. Decomposed: <!--fig:telugu_floor_and_neglect-->floor 34 tokens, 291 above it on GPT-2<!--/fig-->.
The floor is what the script inherently needs; the rest is vocabulary nobody
spent. On GPT-2, <!--fig:telugu_glyphless_share-->63%<!--/fig--> of Telugu tokens contain no character at all — they are
byte fragments of characters the vocabulary cannot represent whole.

**It is the normal case, not an edge case.** On GPT-2, <!--fig:gpt2_over_thresholds-->176 of 204 above 2× and 74 above 4×<!--/fig-->.
Current vocabularies are far better but have not closed it: on `o200k`,
<!--fig:o200k_over_thresholds-->40 of 204 above 2× and 10 above 4×<!--/fig-->.

**The negative space is measurable.** Llama-3 extends `cl100k_base` by roughly
28,000 tokens. For <!--fig:llama3_identical_to_cl100k-->17 of 204<!--/fig--> languages it reports fertility identical to
`cl100k` to the last decimal, Telugu among them, because none of those additions
went to them. That is falsifiable: add coverage for any of those languages and
the count drops.

The finding survives a change of register. Spearman ρ between FLORES-200 prose
and MASSIVE's short spoken commands is <!--fig:cross_corpus_rank_correlation-->0.96 to 0.99<!--/fig--> across the eight tokenizers.

## What this does not claim

- **Nothing about model quality.** Fertility is a property of a tokenizer, not
  of a model. A model with a bad tokenizer may still be the best available.
- **No ranking of model versions.** Comparisons are between tokenizer
  *families*, one representative each, and every axis label says so. This is not
  a leaderboard, and sibling releases are not compared.
- **No currency figure that is anything but illustrative.** Per-token pricing
  varies by provider, by model, and between input and output, and changes often.
  A multiplier is a measurement; a price is a worked example.
- **No causal claim about model behaviour.** High fertility plausibly degrades
  quality and effective context, and that is arguably the more serious harm —
  but this study measures token counts, not downstream capability.
- **No claim that the floor is the true floor.** It is the best of the eight
  tokenizers measured here, so it is an upper bound. A better tokenizer would
  lower it and make the neglect figures larger.

## Layout

```
pipeline/    Python 3.12 (uv). Corpora, tokenizers, metrics, provenance, export.
  sources.toml   every input, hashed, licensed, with substitutions flagged
web/         Vite + TypeScript frontend, reads web/public/data/*.json
data/        raw cache, gitignored, fully regenerable
docs/BRIEF.md           the original build brief this was written from
docs/REDESIGN_BRIEF.md  the visual and narrative redesign brief, which
                        supersedes the original's palette, type and sections
METHODOLOGY.md
```

## Running the pipeline

```
cd pipeline
powershell -File pipeline.ps1        # Windows
make pipeline                        # everywhere else
```

Cold, from an empty cache: ~65 MB of downloads and about five minutes end to
end. Everything runs locally and free — tokenizer files only, no model weights,
no API calls. Per-sentence token counts cache to `data/cache/*.npz`, so re-runs
take seconds.

The pipeline **fails rather than exports**. Validation gates run as pytest
before the export step:

```
cd pipeline && uv run pytest
```

Five measurement gates (English fertility exactly 1.0; full coverage across both
corpora; decode round-trip; no unexplained sub-English result; cross-corpus rank
correlation) plus a provenance gate that fails if any recorded source stops
matching what was loaded. See `METHODOLOGY.md`.

## Running the site

```
cd web
npm install
npm run fonts     # self-hosts every face into public/fonts/ (~13 MB, once)
npm run dev
```

Vite + TypeScript, vanilla DOM, D3 for scales and the scatter. Eight sections,
in the order the argument runs:

1. **The specimen** — one sentence, four languages, every token a physical tile,
   with a parity line at the English column's height. It opens the page before
   any prose does, because the tiles make the finding without being read. The
   column count drops to three and then two as the viewport narrows, rather than
   the columns shrinking: a token too narrow for its cell would be clipped, and
   a clipped token is indistinguishable from a real BPE split.
2. **It is not the writing system** — the same Telugu sentences priced by four
   tokenizers. One variable moves and it is not the language.
3. **Floor and surcharge** — the decomposition, and the site's signature
   element: the tokens a writing system needs are drawn as solid cells and the
   tokens nobody allocated vocabulary for as hollow ones, so the unallocated
   half is a visible absence rather than a percentage in a caption.
4. **Who the vocabulary went to** — every language against every tokenizer, as a
   searchable, sortable matrix. The stripes are the finding.
5. **All 204, against speakers** — the scatter, cost against speaker population.
6. **The negative space is falsifiable** — each language drawn twice, at its
   cheapest and most expensive measured vocabulary, and the test that would
   prove the claim wrong.
7. **What this does not claim** — a section, not a footnote.
8. **Method and provenance** — the pipeline stages, the assumptions as choices,
   and every gate beside the specific mistake it exists to catch.

### Verifying

```
npm run build && npm run preview -- --port 4321 &
npm run verify        # glyph coverage, re-tiling, share card, 380px,
                      # contrast, and the behaviour gate below
npm run lighthouse
```

`npm run shots` drives the installed Chrome through playwright-core, so there is
no browser download. It fails if any of the 25 showcase languages falls back to
a system font, if switching tokenizers stops re-tiling, if the share card is not
exactly 1200×630, or if the page overflows horizontally at 380px.

`npm run contrast` measures rendered elements rather than token values, because
most surfaces here are semi-transparent; it composites backgrounds up the
ancestor chain, resolves every colour through the browser's own parser so the
OKLCH palette is read correctly, and checks all 192 rendered heatmap cells
rather than sampling them.

`npm run behaviour` covers what a screenshot cannot: that the rail is locked
with all sixteen of its rows in view at every window height from 1080 down to
520, that the specimen fits without a sideways scroll at every width from 1920
down to 380 *and* without clipping a token, that the load sequence runs and then
removes its own staging attributes, that the scroll-linked decomposition
actually separates, that `prefers-reduced-motion` lands on the end state and not
the start state, and that switching tokenizer grows the hollow half of the
decomposition while leaving the floor exactly where it is.

Last measured: **Lighthouse performance 95, accessibility 100, best practices
100** (total blocking time 70 ms, first contentful paint 1.6 s, cumulative
layout shift 0.039); all 25 showcase scripts rendering from self-hosted faces;
every contrast pair meeting its threshold in both themes, worst case 4.58:1 on
a heatmap cell; no horizontal scroll anywhere from 380px to 1920px.

## Provenance and licensing

Every corpus, tokenizer and font family is a row in `pipeline/sources.toml` with
its canonical source, the source actually resolved, a revision, a hash, an SPDX
identifier and a `substituted` flag. Two of the eight tokenizers are
substituted, both because the canonical repository is access-gated; both are
verified to tokenize identically. See `METHODOLOGY.md` for the evidence and
`NOTICE.md` for third-party terms.

Code is MIT (`LICENSE`). The data and fonts are not — FLORES-200 is CC-BY-SA-4.0
and its share-alike terms reach the derived measurements. `NOTICE.md` states how.
