# Build spec — "The English Discount"

A data study on tokenizer fertility across languages. Paste this whole file into Claude Code as the opening brief.

---

## 0. Read this first

You are building a static, publishable data study — part research artifact, part interactive tool. It ships to Netlify as a static site with pre-aggregated JSON. There is no backend and no server-side inference.

**Work in two phases and stop between them.** Phase 1 is the Python pipeline; it must produce validated data before any UI work starts. Phase 2 is the frontend. Do not scaffold the frontend while the pipeline is unfinished.

**Before writing any frontend code, produce a short design plan** (palette, type scale, layout concept, signature element) and show it to me. Section 6 pins down most of it — but the layout concept and the hero treatment are yours to propose. Do not skip this step.

---

## 1. The thesis

Tokenizers are built on corpora dominated by English. Every other language pays for that: the same sentence costs more tokens, which means more money per idea, less usable context window, and often worse quality. English isn't "cheap" — everything else is surcharged.

The study must separate two causes, because conflating them is the obvious criticism:

- **Floor** — cost inherent to the writing system. Japanese packs more meaning per character; some of its token count is unavoidable.
- **Neglect** — cost above the floor, caused by vocabulary that was never allocated to that language. This is a choice, not a property of the language.

The site's job is to make that distinction visible and checkable.

**Non-goals.** No leaderboard of model versions. No head-to-head between sibling releases. No claim about model *quality*. We compare tokenizer *families*, and we say so on every axis label.

---

## 2. Repo structure

```
token-tax/
  pipeline/
    pyproject.toml
    src/
      corpora.py         # load + align FLORES-200, MASSIVE
      tokenizers_registry.py
      measure.py         # fertility, floor, neglect
      export.py          # write web/public/data/*.json
    tests/
    Makefile
  web/
    package.json
    index.html
    src/
      main.ts
      views/
      lib/
      styles/
    public/
      data/
      fonts/
  data/                  # raw cache, gitignored
  METHODOLOGY.md
  README.md
```

Python: `uv` for dependency management. Frontend: Vite + TypeScript, vanilla DOM plus D3 for scales and the scatter. No React — the interaction surface is small and a framework buys nothing here.

---

## 3. Phase 1 — the pipeline

### 3.1 Corpora

Two corpora, so the finding can be shown to hold across registers.

1. **FLORES-200** — ~1000 sentences × ~200 languages, professionally translated, sentence-aligned. Wikipedia-register prose. Primary source.
2. **MASSIVE** (Amazon) — 51 languages of short conversational utterances. Represents actual chat usage.

Sentence alignment is the entire basis of the comparison: sentence *n* in Telugu carries the same meaning as sentence *n* in English, so tokens-per-sentence becomes tokens-per-unit-of-meaning. **Assert alignment programmatically** — equal row counts per language, matched IDs — and fail loudly if it breaks.

The canonical HF paths have changed over time (the maintained FLORES release moved namespaces). Look up the current dataset ID and config naming before writing the loader rather than assuming; verify licence terms while you're there and record them in `METHODOLOGY.md`.

### 3.2 Tokenizer registry

One representative per family. Label everything by family in the UI, never by model version.

| Key | Family | Tokenizer | Notes |
|---|---|---|---|
| `gpt2` | Historical baseline | GPT-2 BPE, 50k | Shows how bad English-only vocab was |
| `cl100k` | OpenAI legacy | `cl100k_base` | via `tiktoken` |
| `o200k` | OpenAI current | `o200k_base` | via `tiktoken` |
| `llama3` | Llama | Llama-3 tokenizer, 128k | HF `tokenizers` |
| `gemma` | Gemma / Gemini | Gemma SentencePiece, 256k | HF |
| `tekken` | Mistral | Tekken, ~130k | `mistral-common` |
| `qwen2` | Qwen | Qwen2, 151k | HF |
| `bloom` | Multilingual-first | BLOOM, 250k | The "what's achievable" ceiling |

All of these run **locally on CPU, free**. Tokenizer files are a few MB; no model weights.

GPT-2 and BLOOM are load-bearing for the argument — one shows the failure mode, the other shows the counterfactual. Everything else sits between them, and that spread is the finding.

**Claude is optional and deferred.** Anthropic doesn't publish its tokenizer. `POST /v1/messages/count_tokens` is free and doesn't consume tokens, but it's a network dependency and a rate-limit problem at this volume. Build v1 without it. If added later, batch aggressively, cache every response to disk keyed by hash, and mark the column as measured differently.

### 3.3 Metrics

For each (language, tokenizer, corpus):

- `tokens_median` — median token count per sentence
- `fertility` — `median(tokens_lang / tokens_eng)` computed **per aligned sentence pair**, then medianed. Do not divide the two medians; that discards the pairing.
- `chars_per_token` — sanity check, catches script-density confounds
- `p90_fertility` — tail cost, matters for context-window claims

Then, per language:

- `floor` = `min(tokens_median)` across all tokenizers — empirical best achieved for that script
- `neglect[tok]` = `(tokens_median[tok] - floor) / floor` — excess above achievable

Also join per language: speaker count, script, language family, macro-region. Use a citable source (Ethnologue figures are widely reproduced but licence-restricted; Wikidata or Glottolog are safer) and record which one in `METHODOLOGY.md`.

### 3.4 Validation gates

The pipeline fails rather than exports if any of these break:

- English fertility == 1.0 exactly, for every tokenizer
- Every language present in both corpora has both rows
- Round-trip decode equals input for a 200-sentence sample per tokenizer
- No language has fertility < 0.85 without a written explanation (a genuine sub-English result is interesting but is more likely a bug)
- Rank correlation between FLORES and MASSIveE fertility > 0.7 — if it isn't, the domain sensitivity is itself the finding and must be surfaced, not hidden

Write these as pytest tests, not print statements.

### 3.5 Export schema

Pre-aggregate everything. Target under 1 MB total, gzipped by the CDN.

`web/public/data/languages.json`
```json
{
  "meta": { "generated": "2026-07-30", "corpora": ["flores200", "massive"], "n_sentences": 997 },
  "tokenizers": [
    { "key": "o200k", "family": "OpenAI current", "vocab": 200000 }
  ],
  "languages": [
    {
      "code": "tel_Telu",
      "name": "Telugu",
      "script": "Telugu",
      "family": "Dravidian",
      "region": "South Asia",
      "speakers": 96000000,
      "floor": 41,
      "metrics": {
        "flores": {
          "o200k": { "tokens": 78, "fertility": 3.9, "p90": 5.2, "cpt": 1.6, "neglect": 0.90 }
        }
      }
    }
  ]
}
```

`web/public/data/samples.json` — 12 hand-picked sentences with their translations in ~20 showcase languages, pre-tokenized against all 8 tokenizers, token boundaries included. This powers the hero without needing a tokenizer in the browser at all on first paint.

---

## 4. Phase 2 — the four views

Ship 1 and 2. Views 3 and 4 are v1.1; do not let them block a deploy.

### View 1 — The comparator (hero, signature element)

One sentence, four language columns side by side, tokens rendered as **individual physical tiles with visible seams**. Same meaning, visibly different tile counts: 9 versus 38. That contrast is the whole argument and it should land in under three seconds without reading a word.

- Language columns are user-swappable. Default: English, French, Spanish, Japanese — then a fifth "and this is what it looks like further out" slot defaulting to Telugu.
- A running token count per column, and a multiplier badge relative to English.
- Tokenizer selector — switching it re-tiles live. Watching Telugu collapse from GPT-2 to BLOOM is the best single interaction on the site.
- Free-text input: type your own sentence and see it tiled. This needs a real tokenizer client-side.

**Client-side tokenization.** Pre-tokenized `samples.json` covers first paint with zero JS cost. For free text, lazy-load on first keystroke: `js-tiktoken` or `gpt-tokenizer` for the OpenAI families; `@huggingface/transformers` can load a bare `tokenizer.json` (a few MB, no weights) for the HF families. Load one tokenizer on demand, never all eight. Show a quiet loading state on the tile field, not a spinner overlay.

**Script rendering is a functional requirement.** Telugu, Burmese, Amharic, Thai, and Japanese must render correctly or the hero is broken. Self-host per-script Noto subsets in `public/fonts/` and switch the stack per column based on the language's script. Do not rely on system fallback. Test that combining marks and Indic conjuncts render — a tile boundary that splits a grapheme cluster mid-conjunct is visually confusing and worth handling explicitly (show the partial cluster with a dotted circle rather than silently mangling it).

### View 2 — The scatter

x = fertility multiplier (log scale, 1.0 pinned). y = speakers (log). Dot area = speakers, fill = diverging ramp on fertility, stroke = script family.

The shape is the argument: the surcharge rises as speaker population and economic weight fall. Hover for a language card. Brush to filter. Tokenizer selector redraws with a transition so you can watch the whole cloud pull left as vocab coverage improves.

This is the frame people screenshot. Make sure it reads at 1200×630 with the axis labels legible.

### View 3 — Context shrinkage (v1.1)

A fixed 200k-token rectangle, filled with the same document in different languages. Turkish gets a third of the page. More visceral than a euro figure, because it's a capability ceiling rather than a bill.

### View 4 — The neglect grid (v1.1)

8 tokenizers × 40 languages heatmap on the `neglect` metric, rows sorted to make family clusters visible. This is the reference view — where a visitor looks up their own language. Sortable, searchable, with the raw numbers on hover.

### Methodology section

Not a footnote — a real section, linked from the header. It must state plainly: pricing per token varies by provider so any currency figure is illustrative; FLORES is translationese and mildly unnatural; fertility is a proxy and high fertility also degrades quality and effective context, which is arguably worse than the cost; speaker counts are contested. Including these is what makes it read as research instead of advocacy.

---

## 5. Copy

Sentence case throughout. Active voice. No exclamation marks, no rhetorical questions as headings, no em-dash-heavy breathless register, no emoji anywhere.

Name things by what the reader controls: "Tokenizer" not "Model backend". Labels label; captions explain; nothing does double duty. The empty state of the free-text input is an invitation with a concrete example in it, not "Enter text...".

Numbers get units and a comparison. "3.9× English" beats "3.9".

---

## 6. Design system

The brief: professional, restrained, glass, distinctive colorimetry, and it must not look AI-generated.

### 6.1 The glass has a reason

Glass is not decoration here. The data field — scatter, tile grid, heatmap — is full-bleed and *underneath*. Control panels, language cards, and the methodology drawer float over it as frosted surfaces, so the blur is refracting actual content. If a panel has nothing behind it, it is not glass; it is a flat card. Enforce that distinction.

```css
--glass-bg: color-mix(in srgb, var(--surface) 62%, transparent);
backdrop-filter: blur(20px) saturate(1.35);
border: 1px solid color-mix(in srgb, var(--edge) 40%, transparent);
box-shadow: inset 0 1px 0 color-mix(in srgb, white 45%, transparent);
```

The `inset` top highlight is what reads as a physical edge. One shadow, tight and low-opacity. No outer glow, no double borders, no `blur(40px)`.

### 6.2 Palette

Cool neutrals, deliberately — warm cream backgrounds with terracotta accents are the current house style of AI-generated design and would undercut the whole point.

```
--field-0   #E9ECF0   cool paper, page base
--field-1   #F4F6F8   raised
--ink       #12151C   blue-black, primary text
--ink-2     #5A6472   secondary
--edge      #C3CAD4   hairlines
--marine    #0F5FA6   interactive, links, focus
```

Data ramp — diverging, anchored at 1.0× so "at parity" is visually neutral:

```
1.0×   #2E9E8F   teal
1.4×   #8FBBA8
2.0×   #DFCB8C   sand
3.0×   #D2814A
5.0×   #B04A32   rust
8.0×+  #6E2437   oxblood
```

One ramp, one interactive colour. Everything else is neutral. Ship a dark variant (`--field-0: #12151C`, ink and edge inverted, ramp lightened ~12%) and honour `prefers-color-scheme`.

### 6.3 Type

Three roles, none of them the defaults:

- **Display** — Archivo, variable, width ~112, weight 600. Big multipliers and section heads. Used with restraint.
- **UI / body** — Instrument Sans. Slightly narrow, professional, not Inter.
- **Data** — Martian Mono, tabular figures on, for every number in the interface. Token tiles use it too.
- **Script rendering** — per-script Noto subsets, self-hosted, selected by the language's script property.

All numerals `font-variant-numeric: tabular-nums`. Numbers in a comparison must align vertically or the comparison is harder to read than it needs to be.

### 6.4 Layout and motion

Asymmetric. A left rail for controls, the data field taking the remaining width, and an editorial column that is genuinely a column — max 68ch — for the methodology and findings. Not a grid of equal-sized cards.

Motion: one orchestrated moment, not scattered effects. When the tokenizer changes, the tiles should re-flow with a staggered transition (~180ms, 12ms stagger) so you can *see* tokens merging. That's the one place to spend the animation budget. Everything else is a 120ms opacity or transform. Respect `prefers-reduced-motion` by cutting to the end state.

### 6.5 Explicitly forbidden

These are the tells. None of them appear:

- Purple-to-blue gradients, or gradients as decoration anywhere
- Glowing or neon borders, `box-shadow` with a colour at >20% opacity
- Warm cream `#F4F1EA`-adjacent backgrounds with terracotta accents
- Near-black page with a single acid-green accent
- Emoji, sparkles, or "✨"-adjacent copy
- Bento grid of equal-weight cards
- `border-radius` above 12px on anything that isn't a pill badge
- Everything centred; centred hero + centred subhead + centred CTA
- Font weights 700+, or more than three weights total
- Rainbow categorical palettes; colour used where it encodes nothing
- Fake precision — `3.94721×` when the corpus supports `3.9×`

### 6.6 Quality floor

Responsive to 380px (the scatter becomes a sorted bar list below 720px; do not try to squeeze it). Visible keyboard focus using `--marine`. Every colour pair meets 4.5:1. Charts have accessible text alternatives. Lighthouse performance above 90 with the tokenizer lazy-loaded.

---

## 7. Definition of done

- `make pipeline` runs clean from empty cache to exported JSON, all tests green
- `METHODOLOGY.md` states every corpus, source, licence, metric definition, and caveat
- Hero renders correct glyphs for all 20 showcase languages, verified visually
- Free-text tokenization works for at least the OpenAI and Llama families
- Scatter is legible as a 1200×630 screenshot
- Dark mode complete, reduced-motion complete, keyboard-navigable
- Deployed to Netlify, README has a one-paragraph finding with the headline numbers

---

## 8. Deferred, and stay deferred

Claude token counting. Views 3 and 4. Cost calculator with live provider pricing. Per-language quality correlation. Anything involving calling a model.
