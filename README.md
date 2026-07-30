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

## Running the site

```
cd web
npm install
npm run fonts     # self-hosts every face; writes public/fonts/ (~13 MB, once)
npm run dev
```

Vite + TypeScript, vanilla DOM, D3 for scales and the scatter. No framework: the
interaction surface is a tokenizer selector, five language pickers and a brush.

Two views ship. **The comparator** puts the same sentence in five languages side
by side as physical token tiles; a dashed line drawn at the English column's
height turns every other column into visible surcharge. **The scatter** plots
cost against speaker population, and the shape is the argument.

Fonts are self-hosted with no CDN dependency, split per writing system and
fetched only for scripts actually on screen. Free-text tokenization lazy-loads
one tokenizer on demand — the three OpenAI families and Llama-3 — and never
more than one.

### Verifying

```
npm run build && npm run preview -- --port 4321 &
npm run verify        # glyph coverage, re-tiling, share card, 380px, contrast
npm run lighthouse
```

`npm run shots` drives the installed Chrome through playwright-core, so there is
no browser download. It fails the build if any of the 25 showcase languages
falls back to a system font, if switching tokenizers stops re-tiling, if the
share card is not exactly 1200×630, or if the page overflows horizontally at
380px. `npm run contrast` measures every text pair against its rendered
background — compositing through the glass surfaces — and requires 4.5:1.

Last measured: **Lighthouse performance 93, accessibility 100, best practices
100**; all 25 showcase scripts rendering from self-hosted faces; every contrast
pair passing.

## Caveats

FLORES is translationese; fertility is a proxy and the context-window cost is
arguably worse than the money; speaker counts are contested; any currency figure
is illustrative. These are not footnotes — see `METHODOLOGY.md`, which also
records every corpus, licence and source substitution.
