# Methodology

What was measured, how, from what sources, and where the numbers should not be
trusted.

## What fertility means here

For a language *L* and a tokenizer *T*, **fertility** is the median, over
aligned sentence pairs, of the ratio between the token count in *L* and the
token count in English for the same sentence and the same tokenizer:

```
fertility(L, T) = median_i ( tokens(L_i, T) / tokens(English_i, T) )
```

The pairing is the point. Sentence *i* in Telugu and sentence *i* in English are
professional translations of each other, so they carry the same meaning; the
ratio of their token counts is therefore a ratio of cost per unit of meaning
rather than cost per unit of text. Dividing the median Telugu count by the
median English count would produce a similar-looking number while discarding the
pairing, and the pipeline has a test (`test_fertility_is_paired_not_a_ratio_of_medians`)
whose only job is to fail if that ever silently happens.

English fertility is 1.0 by construction, and a gate asserts it exactly.

## Floor and neglect

Conflating the two causes of high token counts is the obvious criticism of this
kind of study, so they are reported separately.

```
floor(L)      = min over tokenizers of ( median tokens per sentence in L )
neglect(L, T) = ( median tokens(L, T) - floor(L) ) / floor(L)
```

**Floor** is the best any tokenizer in this registry actually achieves for that
language. It stands in for the cost inherent to the writing system: Japanese
packs more meaning into each character, and some of its token count is not
recoverable by any vocabulary.

**Neglect** is everything above the floor. It is not a property of the language.
It is the consequence of a vocabulary that was never allocated to that script,
and a different tokenizer demonstrably does better on the same text.

The floor is *empirical*, not theoretical. It is the minimum over the eight
tokenizers measured here, so it is an upper bound on the true floor: a tokenizer
outside this registry could be better, which would mean the neglect figures are
understated rather than overstated.

`languages.json` reports `floor` (FLORES) at the language level per the study
schema, and `floors` with both corpora alongside it. Neglect is always computed
against the floor of the same corpus.

## Corpora

### FLORES-200 — primary

~997 sentences of Wikipedia-register prose, professionally translated into 204
language-script pairs, sentence-aligned. The `dev` split is used.

**Source substitution.** The spec anticipated pulling this from HuggingFace, and
the canonical path has indeed moved namespaces. Both current HuggingFace
releases — `openlanguagedata/flores_plus` and `facebook/flores` — are gated
behind terms acceptance and return HTTP 403 to an unauthenticated client, which
makes a reproducible build awkward. The pipeline therefore downloads Meta's
original archive directly:

- `https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz`
- Licence: **CC-BY-SA-4.0**
- Same content, no gating, sha256 recorded in `data/raw/checksums.json` on first
  fetch and verified on every run afterwards.

### MASSIVE 1.1 — secondary

Amazon's corpus of short conversational utterances, parallel across 52 locales
(51 languages; Chinese appears as both Simplified and Traditional). It is
included so the finding can be shown to survive a change of register: FLORES is
edited prose, MASSIVE is what people actually type at an assistant.

**Source substitution.** The HuggingFace dataset `AmazonScience/massive` is a
legacy loading script and no longer executes under `datasets` v3 and later. The
pipeline downloads Amazon's archive directly:

- `https://amazon-massive-nlu-dataset.s3.amazonaws.com/amazon-massive-dataset-1.1.tar.gz`
- Licence: **CC-BY-4.0**

**Subsampling.** Locales are joined on utterance `id`, keeping only ids present
in *every* locale, and then a **seeded sample of 5,000 utterances** is drawn
(seed `20260730`, `random.Random.sample` over ids sorted numerically). This is a
runtime decision, not a statistical one: measuring all ~16.5k utterances against
eight tokenizers adds nothing to a median computed over 5,000 pairs. The sample
is deterministic and re-runs reproduce it exactly.

### Alignment

Alignment is the entire basis of the comparison, so it is asserted rather than
assumed. `corpora.assert_aligned` raises `AlignmentError` if per-language row
counts disagree, if the English pivot is missing, or if any row is empty. It
runs on every load, and there is a separate gate for it in the test suite.

## Tokenizers

One representative per family. The study compares tokenizer *families* and every
axis label says so; it makes no claim about model quality, and it is not a
leaderboard of model versions.

| Key | Family | Source | Vocab |
|---|---|---|---|
| `gpt2` | Historical baseline | `tiktoken` `r50k_base` | 50,257 |
| `cl100k` | OpenAI legacy | `tiktoken` `cl100k_base` | 100,277 |
| `o200k` | OpenAI current | `tiktoken` `o200k_base` | 200,019 |
| `llama3` | Llama | `NousResearch/Meta-Llama-3-8B` | 128,256 |
| `gemma` | Gemma / Gemini | `unsloth/gemma-2-2b` | 256,000 |
| `tekken` | Mistral | `mistralai/Mistral-Nemo-Base-2407` | 131,072 |
| `qwen2` | Qwen | `Qwen/Qwen2-7B` | 151,646 |
| `bloom` | Multilingual-first | `bigscience/bloom` | 250,680 |

Everything runs locally on CPU. Only tokenizer files are downloaded — no model
weights.

**Mirror substitution.** `meta-llama/Meta-Llama-3-8B` and `google/gemma-2-2b`
are gated and return 403 unauthenticated. The pipeline reads the same
`tokenizer.json` from ungated mirrors, listed above. Vocabulary sizes are read
off the loaded tokenizer object, never from a model `config.json`, whose
`vocab_size` is padded for tensor-shape reasons and overstates the real
vocabulary — Qwen2 is the clearest case, 151,646 real against 152,064 padded.

**Tekken.** Mistral's Tekken tokenizer is read from the HF-format
`tokenizer.json` published in the same repository as `tekken.json`, rather than
through `mistral-common`. This keeps one code path for all six non-tiktoken
families and means the browser can load the identical file.

**Qwen2 normalises.** Qwen2's tokenizer declares an NFC normalizer, so
`decode(encode(s))` returns a canonically equivalent string rather than a byte
identical one — pre-composed Bengali য় (U+09DF) comes back as য + nukta, and
decomposed Latin diacritics come back composed. This is a property of the
tokenizer. The round-trip gate compares against `NFC(s)` for Qwen2 and against
`s` for the other seven. The effect on token counts is negligible but non-zero
for scripts with pre-composed forms.

**A coincidence worth flagging.** Llama-3's tokenizer extends `cl100k_base` with
roughly 28,000 additional tokens. For languages that received none of those
additions, `llama3` and `cl100k` report *identical* fertility. Telugu at 8.33×
on both is not a copy-paste error in the data; it is the finding that Llama-3
added no Telugu coverage.

**Claude is deliberately absent.** Anthropic does not publish a tokenizer.
`POST /v1/messages/count_tokens` is free and does not consume tokens, but it is
a network dependency and a rate-limit problem at this volume, and a column
measured by a different mechanism does not belong in the same table without
being marked as such. It is out of scope for v1.

## Language metadata

- **Script** — taken from the ISO 15924 suffix of the FLORES code itself
  (`tel_Telu` → Telugu). No external lookup, no ambiguity.
- **Family and macro-region** — Glottolog CLDF `languages.csv`, joined on
  ISO 639-3. Licence **CC-BY-4.0**.
- **Speaker counts** — Wikidata property P1098, joined on ISO 639-3 (P220),
  taking the maximum where several figures exist. Licence **CC0-1.0**.

Ethnologue's figures are more complete and more widely reproduced, but they are
licence-restricted, so they are deliberately not used.

**Known limitations.** Glottolog macroareas are coarse — South Asia, Central
Asia and Europe all appear as "Eurasia" — and that coarseness is carried through
to the site rather than being invented away. Where Glottolog indexes a FLORES
code below language level (dialects of a macrolanguage: Bosnian, Croatian,
Serbian, Norwegian Bokmål and Nynorsk, Levantine and Najdi Arabic, and others)
the ISO 639-3 join finds nothing, and the record is filled from a hand-written
override table in `pipeline/src/metadata.py`. Every override is visible in that
file. There are 17 of them, covering 204 languages.

**Speaker counts are contested.** They depend on whether second-language
speakers are counted, on how a macrolanguage is subdivided, and on national
census politics. They are used here for dot area and for ordering, not for any
quantitative claim.

## Validation gates

The pipeline fails rather than exports. These run as pytest, not as print
statements, and `make pipeline` will not reach the export step if any of them
break.

1. **English fertility is exactly 1.0** for every tokenizer and both corpora.
2. **Coverage** — every language present in both corpora carries a full set of
   tokenizer rows in both; the MASSIVE locale map is complete and injective.
3. **Round-trip** — `decode(encode(s)) == s` over a 200-sentence sample drawn
   across languages (so a tokenizer that handles Latin but mangles combining
   marks still fails), modulo the documented Qwen2 NFC normalisation. A separate
   gate checks that the token offsets shipped in `samples.json` tile the input
   exactly and reassemble to the original string.
4. **No unexplained sub-English fertility** — anything below 0.85× fails unless
   it is argued for in writing in `pipeline/src/known_exceptions.py`. A companion
   gate deletes-by-failing any exception that no longer applies, so the list
   cannot rot. Two entries currently qualify: Chinese Simplified and Traditional
   on BLOOM, on MASSIVE only. Both are real. BLOOM's vocabulary has heavy Chinese
   coverage, and MASSIVE's short imperative utterances are where Chinese's
   density per character pays off most; the same pair scores above 1.0 on FLORES
   prose, which is what a register effect rather than a bug looks like.
5. **Cross-corpus rank correlation** — Spearman ρ between FLORES and MASSIVE
   fertility rankings must exceed 0.7 for every tokenizer. If it did not, the
   domain sensitivity would itself be the finding and would have to be surfaced
   rather than hidden. Measured: **0.958 (o200k), 0.980 (gpt2), 0.988 (bloom)**
   over the 52 shared locales. The ranking survives the register change.

## Caveats that matter

**FLORES is translationese.** Every non-English sentence is a translation of an
English source, produced by professional translators working to a brief. That is
what makes it aligned and therefore usable, but translated prose is measurably
less natural than text originally written in the language — it tends to track
English structure. If anything this *understates* the surcharge, since native
text would use more of the constructions the vocabulary does not cover. MASSIVE
is included as a partial control and agrees closely.

**Fertility is a proxy, and cost is the least of it.** More tokens means more
money per idea, and that is the easy number to quote. It also means less usable
context window for the same document, and there is evidence that high-fertility
languages are handled worse by the models themselves — a language chopped into
byte fragments is harder to model than one with whole-word tokens. The capability
ceiling is arguably the more serious harm, and this study does not measure it.

**Currency figures are illustrative.** Per-token pricing varies by provider, by
model, by input versus output, and changes frequently. Any monetary figure on the
site is a worked example of what a multiplier means, not a quote.

**The floor is an upper bound.** See "Floor and neglect" above — a better
tokenizer outside this registry would lower the floor and raise every neglect
figure.

**Median, not mean.** All headline figures are medians over sentence pairs, so a
handful of pathological sentences cannot drive the result. `p90` is reported
alongside because tail cost is what actually determines whether a document fits
in a context window.

## Reproducing

```
cd pipeline
powershell -File pipeline.ps1        # Windows
make pipeline                  # everywhere else
```

Cold, that is roughly a 65 MB download and about five minutes end to end
(measured: 282 s, most of it the gate suite). Per-sentence
token counts are cached to `data/cache/*.npz` keyed by corpus and tokenizer, so
subsequent runs take seconds. `make clean` drops everything re-downloadable.
