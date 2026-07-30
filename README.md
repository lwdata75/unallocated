# The English Discount

A data study on tokenizer fertility across languages. Static site, pre-aggregated
JSON, no backend.

## The finding

The same sentence costs more tokens in every language than it does in English,
and most of that surcharge is a choice rather than a property of the language.
Measured across 204 languages of FLORES-200 and 52 locales of MASSIVE against
eight tokenizer families: on GPT-2, 176 of 204 languages cost more than twice
what English costs for the same meaning, and 74 of them cost more than four
times. Current vocabularies are far better but have not closed the gap — on
OpenAI's `o200k`, 40 languages still pay more than 2×. The distinction the study
is built to make is visible in one language: a FLORES sentence in Telugu takes
325 tokens on GPT-2, 208 on `cl100k`, 48 on `o200k` and 34 on BLOOM, against 24
for the English original. Telugu's writing system did not change between those
four numbers. What changed was how much vocabulary anyone spent on it, and the
291-token difference between the worst and the best is the part that was never
inherent to the language.

The comparison runs by tokenizer *family*, never by model version, and makes no
claim about model quality.

## Layout

```
pipeline/    Python 3.12 (uv). Corpora, tokenizers, metrics, validation, export.
web/         Vite + TypeScript frontend. Reads pipeline/../web/public/data/*.json.
data/        Raw cache. Gitignored, fully regenerable.
METHODOLOGY.md
```

## Running the pipeline

```
cd pipeline
powershell -File pipeline.ps1        # Windows
make pipeline                  # everywhere else
```

Cold, from an empty cache: ~65 MB of downloads and about five minutes end to end
(measured: 282 s, of which ~200 s is the gate suite). Everything runs locally
and free — tokenizer files only, no model weights, no API calls. Per-sentence
token counts are cached to `data/cache/*.npz`, so re-runs take seconds.

The pipeline **fails rather than exports**. Five validation gates run as pytest
before the export step; see `METHODOLOGY.md` for what each one checks and why.

```
cd pipeline && uv run pytest     # 50 tests
```

## Output

| File | Raw | Gzipped |
|---|---|---|
| `web/public/data/languages.json` | 188 KB | 27 KB |
| `web/public/data/samples.json` | 451 KB | 86 KB |

`languages.json` carries every language × tokenizer × corpus, with fertility,
p90, chars-per-token, floor and neglect. `samples.json` carries 12 FLORES
sentences in 25 showcase languages, pre-tokenised against all eight tokenizers
with character offsets, so the hero renders token tiles without loading a
tokenizer in the browser.

## Caveats

FLORES is translationese; fertility is a proxy and the context-window cost is
arguably worse than the money; speaker counts are contested; any currency figure
is illustrative. These are not footnotes — see `METHODOLOGY.md`, which also
records every corpus, licence and source substitution.
