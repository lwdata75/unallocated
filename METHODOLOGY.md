<!-- SPDX-License-Identifier: MIT -->

# Methodology

What was measured, how, from what sources, and where the numbers should not be
trusted.

Every figure in this document sits inside a generated span and comes from
`web/public/data/headline.json`. The provenance table is rendered from
`pipeline/sources.toml`. Neither is maintained by hand, because a provenance
table maintained by hand is a provenance table that goes stale.

## The claim, in order

**1. Vocabulary allocation is a scoped choice, not a general virtue.** BLOOM was
built multilingual-first with a 250k vocabulary. Its median fertility across all
204 languages is <!--fig:median_fertility_bloom_vs_o200k-->1.80× against 1.74×<!--/fig--> for OpenAI's `o200k` — slightly worse
overall. On Bengali it costs <!--fig:bengali_bloom_vs_o200k-->1.18× against 1.69×<!--/fig-->. It wins on <!--fig:bloom_beats_o200k_count-->93 of 204<!--/fig-->
languages and loses on the rest. ROOTS, BLOOM's training corpus, covered roughly
46 languages, and the boundary of that list is visible in the measurements.
"Multilingual" was never bought; a specific list of languages was.

**2. The demonstration.** Telugu's median FLORES-200 sentence costs
<!--fig:telugu_median_tokens-->325 on gpt2, 208 on cl100k, 48 on o200k, 34 on bloom<!--/fig--> tokens, against <!--fig:english_median_tokens-->25 on gpt2, 25 on cl100k, 24 on o200k, 25 on bloom<!--/fig-->
for the same sentences in English. Decomposed: <!--fig:telugu_floor_and_neglect-->floor 34 tokens, 291 above it on GPT-2<!--/fig-->. On GPT-2,
<!--fig:telugu_glyphless_share-->63%<!--/fig--> of Telugu tokens contain no character at all. This is the clearest
single case, but it is evidence for the claim above, not the claim itself.

**3. The aggregate.** On GPT-2, <!--fig:gpt2_over_thresholds-->176 of 204 above 2× and 74 above 4×<!--/fig-->. On `o200k`,
<!--fig:o200k_over_thresholds-->40 of 204 above 2× and 10 above 4×<!--/fig-->.

**4. The negative space.** Llama-3 extends `cl100k_base` by roughly 28,000
tokens. For <!--fig:llama3_identical_to_cl100k-->17 of 204<!--/fig--> languages it reports fertility identical to `cl100k`
to the last decimal — Telugu sits at <!--fig:telugu_llama3_and_cl100k-->8.33× on both Llama-3 and cl100k<!--/fig--> — because none of
those additions went to them. Falsifiable: add coverage for any of those
languages and the count drops.

## What this does not claim

- **Nothing about model quality.** Fertility is a property of a tokenizer, not a
  model.
- **No ranking of model versions.** Tokenizer *families*, one representative
  each, labelled as such on every axis. Not a leaderboard.
- **No currency figure that is anything but illustrative.** Per-token pricing
  varies by provider, model and direction, and changes often.
- **No causal claim about downstream behaviour.** High fertility plausibly
  degrades quality and effective context — arguably the more serious harm — but
  this study measures token counts, not capability.
- **No claim that the floor is the true floor.** See below.

## What fertility means here

For a language *L* and tokenizer *T*, fertility is the median, over aligned
sentence pairs, of the ratio between the token count in *L* and in English for
the same sentence and tokenizer:

```
fertility(L, T) = median_i ( tokens(L_i, T) / tokens(English_i, T) )
```

The pairing is the point. Sentence *i* in Telugu and sentence *i* in English are
professional translations of each other, so they carry the same meaning; the
ratio is therefore cost per unit of meaning rather than cost per unit of text.
Dividing the median Telugu count by the median English count would produce a
similar-looking number while discarding the pairing, and a test
(`test_fertility_is_paired_not_a_ratio_of_medians`) exists solely to fail if
that ever silently happens.

English fertility is 1.0 by construction, and a gate asserts it exactly.

## Floor and neglect

```
floor(L)      = min over tokenizers of ( median tokens per sentence in L )
neglect(L, T) = ( median tokens(L, T) - floor(L) ) / floor(L)
```

**Floor** is the best any tokenizer in this registry actually achieves for that
language, standing in for the cost inherent to the writing system. **Neglect**
is everything above it — not a property of the language, but the consequence of
vocabulary that was never allocated, demonstrated by another tokenizer doing
better on the same text.

The floor is *empirical*, not theoretical: it is the minimum over eight
tokenizers, so it is an upper bound on the true floor. A better tokenizer
outside this registry would lower it and make every neglect figure **larger**.

`languages.json` reports `floor` (FLORES) at the language level per the study
schema, with `floors` for both corpora alongside. Neglect is always computed
against the floor of the same corpus.

## Provenance

Every input is a row in `pipeline/sources.toml` carrying its canonical source,
the source actually resolved, a revision, a hash, an SPDX identifier, a
retrieval date, and a `substituted` flag with a reason. The pipeline verifies
this on every run and `tests/test_provenance.py` fails if anything drifts. The
same data is exported to `web/public/data/sources.json`.

<!--sources-table-->
| Key | Kind | Source used | Revision | Licence | Canonical? |
|---|---|---|---|---|---|
| `flores200` | corpus | `https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz` | `FLORES-200 (NLLB release, 2022)` | Creative Commons Attribution-ShareAlike 4.0 | yes |
| `massive` | corpus | `https://amazon-massive-nlu-dataset.s3.amazonaws.com/amazon-massive-dataset-1.1.tar.gz` | `1.1` | Creative Commons Attribution 4.0 | yes |
| `bloom` | tokenizer | `bigscience/bloom` | `7f10a99ce7c0` | BigScience RAIL License v1.0 | yes |
| `cl100k` | tokenizer | `tiktoken cl100k_base` | `tiktoken 0.13.0` | MIT | yes |
| `gemma` | tokenizer | `unsloth/gemma-2-2b` | `25319945f7fd` | Gemma Terms of Use | **substituted** |
| `gpt2` | tokenizer | `tiktoken r50k_base` | `tiktoken 0.13.0` | MIT | yes |
| `llama3` | tokenizer | `NousResearch/Meta-Llama-3-8B` | `315b20096dc7` | Meta Llama 3 Community License | **substituted** |
| `o200k` | tokenizer | `tiktoken o200k_base` | `tiktoken 0.13.0` | MIT | yes |
| `qwen2` | tokenizer | `Qwen/Qwen2-7B` | `453ed1575b73` | Apache License 2.0 | yes |
| `tekken` | tokenizer | `mistralai/Mistral-Nemo-Base-2407` | `a4477a2f9779` | Apache License 2.0 | yes |
| _31 font families_ | font | Google Fonts, self-hosted | `2026-07-30` | SIL Open Font License 1.1 | yes |
<!--/sources-table-->

### Two substitutions, both because of gating

`meta-llama/Meta-Llama-3-8B` and `google/gemma-2-2b` are `gated: manual` and
return HTTP 403 without an approved access request. This is **gating, not an
outage**, and it means the study currently rests on community re-uploads. That
is a real weakness, so each is checked rather than assumed:

**Llama-3 is anchored to a first-party source.** Llama-3's vocabulary is
`cl100k_base` extended with roughly 28,000 tokens. Every one of the 100,256
`cl100k` tokens is reproduced at the identical id in the mirror, with zero
mismatches, plus 27,979 added tokens. `tiktoken` is OpenAI's own ungated
package, so no re-uploader controls it; a fabricated tokenizer could not
reproduce this. Two further independent re-uploads
(`unsloth/llama-3-8b`, `princeton-nlp/Llama-3-Base-8B-SFT`) agree on vocabulary
size and on token ids for all 32 probes.

**Gemma has no such anchor.** It is a SentencePiece vocabulary with no shared
base against which to check it independently. Three independent re-uploads
(`unsloth/gemma-2-2b`, `unsloth/gemma-2-9b-it`,
`philschmid/gemma-tokenizer-chatml`) agree exactly on vocabulary size and probe
token ids. That is strong corroboration, not proof. **Closing this properly
requires accepting the Gemma terms on huggingface.co and re-running
`uv run python -m src.refresh_sources`**, which will compare against the
canonical repository and fail if they differ.

### What equivalence means for a tokenizer

Not the sha256 of `tokenizer.json`. Legitimate mirrors of the same tokenizer
differ in that file — chat templates, added-token metadata, padding config —
while tokenizing identically. A whole-file hash would flag honest mirrors and
still say nothing about output. Equivalence is asserted on behaviour:

- `behaviour_sha256` — a hash over the `model` (vocab and merges), `normalizer`,
  `pre_tokenizer` and `decoder` sections only.
- `probe_sha256` — a hash over token ids for a fixed 32-string probe set
  spanning Latin, CJK, Indic, Arabic, Hebrew, Thai, Myanmar, Ethiopic,
  Georgian, Greek, Cyrillic, emoji, ZWJ sequences, regional indicators,
  combining marks, pre-composed forms and whitespace edge cases.

Two sources agreeing on both tokenize identically, which is the only property
the measurements rest on.

### The corpora are not substituted

Worth stating plainly, because it is easy to get backwards. FLORES-200 is
fetched from `dl.fbaipublicfiles.com`, which is **Meta's own distribution**, and
MASSIVE from `amazon-massive-nlu-dataset.s3.amazonaws.com`, which is
**Amazon's**. These are the canonical sources; it is the HuggingFace paths that
are mirrors, and they were not used because `facebook/flores` and
`openlanguagedata/flores_plus` are gated and `AmazonScience/massive` is a legacy
loading script that no longer executes under `datasets` ≥ 3.

**FLORES-200 is not FLORES+.** They are different releases with different
language inventories. This study uses FLORES-200, the NLLB release; the
extracted archive's own README self-identifies as "FLORES 200 dataset", and a
gate asserts it. Cite it as:

> Team, N. L. L. B. et al. *No Language Left Behind: Scaling Human-Centered
> Machine Translation.* 2022. FLORES-200 evaluation benchmark.

## Corpora

### FLORES-200 — primary

997 sentences of Wikipedia-register prose, professionally translated into 204
language-script pairs, sentence-aligned. The `dev` split is used.

### MASSIVE 1.1 — secondary

Amazon's corpus of short conversational utterances, parallel across 52 locales
(51 languages; Chinese appears as both Simplified and Traditional). Included so
the finding can be shown to survive a change of register: FLORES is edited
prose, MASSIVE is what people actually type at an assistant.

**Subsampling.** Locales are joined on utterance `id`, keeping only ids present
in *every* locale, then a seeded sample of 5,000 utterances is drawn (seed
`20260730`). A runtime decision, not a statistical one: measuring all ~16.5k
against eight tokenizers adds nothing to a median over 5,000 pairs. It is
deterministic and re-runs reproduce it exactly.

### Alignment

Alignment is the entire basis of the comparison, so it is asserted rather than
assumed. `corpora.assert_aligned` raises if per-language row counts disagree, if
the English pivot is missing, or if any row is empty. It runs on every load and
has its own gate.

## Tokenizers

One representative per family, all running locally on CPU. Only tokenizer files
are downloaded — no model weights.

Vocabulary sizes are read off the loaded tokenizer, never from a model
`config.json`, whose `vocab_size` is padded for tensor-shape reasons and
overstates the real vocabulary. Qwen2 is the clearest case: 151,646 real against
152,064 padded.

**Tekken.** Mistral's tokenizer is read from the HF-format `tokenizer.json`
published alongside `tekken.json` in the same first-party repository, rather
than through `mistral-common`. A file-format choice within the canonical source,
not a substitution: it keeps one code path for all six non-tiktoken families and
lets the browser load the identical file.

**Qwen2 normalises.** Qwen2 declares an NFC normalizer, so `decode(encode(s))`
returns a canonically equivalent rather than byte-identical string —
pre-composed Bengali য় (U+09DF) comes back as য + nukta, and decomposed Latin
diacritics come back composed. A property of the tokenizer, not a defect. The
round-trip gate compares against `NFC(s)` for Qwen2 and against `s` for the
other seven. The effect on counts is negligible but non-zero for scripts with
pre-composed forms.

**Claude is deliberately absent.** Anthropic does not publish a tokenizer.
`POST /v1/messages/count_tokens` is free and does not consume tokens, but it is
a network dependency and a rate-limit problem at this volume, and a column
measured by a different mechanism does not belong in the same table without
being marked as such. Out of scope for v1.

## Language metadata

- **Script** — the ISO 15924 suffix of the FLORES code itself (`tel_Telu` →
  Telugu). No external lookup, no ambiguity.
- **Family and macro-region** — Glottolog CLDF `languages.csv`, joined on
  ISO 639-3. CC-BY-4.0.
- **Speaker counts** — Wikidata P1098, joined on ISO 639-3 (P220), taking the
  maximum where several figures exist. CC0-1.0.

Ethnologue's figures are more complete and more widely reproduced, but they are
licence-restricted, so they are deliberately not used.

**Known limitations.** Glottolog macroareas are coarse — South Asia, Central
Asia and Europe all appear as "Eurasia" — and that coarseness is carried through
rather than invented away. Where Glottolog indexes a FLORES code below language
level (dialects of a macrolanguage: Bosnian, Croatian, Serbian, Norwegian Bokmål
and Nynorsk, Levantine and Najdi Arabic) the ISO 639-3 join finds nothing and
the record is filled from a hand-written override table in
`pipeline/src/metadata.py`. There are 17, covering 204 languages, and every one
is visible in that file.

**Speaker counts are contested.** They depend on whether second-language
speakers are counted, on how a macrolanguage is subdivided, and on census
politics. Used for dot area and ordering, not for any quantitative claim.

## Validation gates

The pipeline fails rather than exports. These run as pytest, not print
statements, and the export step is not reached if any break.

1. **English fertility is exactly 1.0** for every tokenizer and both corpora.
2. **Coverage** — every language in both corpora carries a full set of tokenizer
   rows in both; the MASSIVE locale map is complete and injective.
3. **Round-trip** — `decode(encode(s)) == s` over a 200-sentence sample drawn
   across languages, modulo the documented Qwen2 NFC normalisation. A companion
   gate checks that the offsets shipped in `samples.json` tile the input exactly
   and reassemble to the original string.
4. **No unexplained sub-English fertility** — anything below 0.85× fails unless
   argued for in writing in `pipeline/src/known_exceptions.py`. A further gate
   fails any exception that no longer applies, so the list cannot rot. Two
   entries currently qualify: Chinese Simplified and Traditional on BLOOM, on
   MASSIVE only. Both are real — BLOOM's vocabulary has heavy Chinese coverage,
   and MASSIVE's short imperatives are where Chinese density pays off most; the
   same pair scores above 1.0 on FLORES prose, which is what a register effect
   rather than a bug looks like.
5. **Cross-corpus rank correlation** — Spearman ρ between FLORES and MASSIVE
   fertility rankings must exceed 0.7 for every tokenizer. Measured:
   <!--fig:cross_corpus_rank_correlation-->0.96 to 0.99<!--/fig-->. The ranking survives the register change.
6. **Provenance** — every tokenizer still matches its recorded vocabulary size
   and probe hash; every archive still matches its recorded sha256; every
   substitution is flagged, justified and evidenced; FLORES-200 is not FLORES+.
7. **Documents** — every figure in this file and the README re-renders identically
   from the exported data, no figure span references an unknown key, and no bare
   multiplier appears outside a generated span.

## Caveats that matter

**FLORES is translationese.** Every non-English sentence is a translation of an
English source, produced by professional translators to a brief. That is what
makes it aligned and therefore usable, but translated prose tracks English
structure more closely than native writing. If anything this *understates* the
surcharge, since native text would use more of the constructions the vocabulary
does not cover. MASSIVE is a partial control and agrees closely.

**Fertility is a proxy, and cost is the least of it.** More tokens means more
money per idea, the easy number to quote. It also means less usable context for
the same document, and there is reason to think a language chopped into byte
fragments is modelled worse than one with whole-word tokens. The capability
ceiling is arguably the more serious harm, and this study does not measure it.

**Median, not mean.** All headline figures are medians over sentence pairs, so a
handful of pathological sentences cannot drive the result. `p90` is reported
alongside because tail cost determines whether a document fits in a context
window.

## Reproducing

```
cd pipeline
powershell -File pipeline.ps1        # Windows
make pipeline                        # everywhere else
```

Cold, roughly a 65 MB download and about five minutes end to end. Per-sentence
token counts cache to `data/cache/*.npz` keyed by corpus and tokenizer, so
subsequent runs take seconds. `make clean` drops everything re-downloadable.

To re-verify provenance against upstream and regenerate `sources.toml`:

```
uv run python -m src.refresh_sources
```
