<!-- SPDX-License-Identifier: MIT -->

# Notice — third-party material and derived data

The code in this repository is MIT (see `LICENSE`). Almost nothing else is.
This file states what is covered by what, and how this project complies.

Machine-readable equivalents of everything below live in
`pipeline/sources.toml` and `web/public/data/sources.json`, each row carrying an
SPDX identifier.

---

## 1. Corpora

### FLORES-200 — CC-BY-SA-4.0

Source: `https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz`
(Meta's own distribution; the HuggingFace paths are gated mirrors.)

> Team, N. L. L. B. et al. *No Language Left Behind: Scaling Human-Centered
> Machine Translation.* 2022.

**Share-alike reaches the measurements, and this is the important part.**
CC-BY-SA-4.0 requires that adaptations be distributed under the same licence.
The exported files `web/public/data/languages.json`, `samples.json` and
`headline.json` are derived from FLORES-200 sentences — `samples.json` in
particular contains FLORES sentence text verbatim. They are therefore
**licensed CC-BY-SA-4.0**, not MIT.

How this project complies:

- Attribution to the NLLB team is given here, in `METHODOLOGY.md`, and in the
  site's methodology section.
- The derived data files are distributed under CC-BY-SA-4.0. Anyone
  redistributing `web/public/data/*.json`, or a site built from them, must do so
  under the same terms and attribute FLORES-200.
- The source corpus is not modified or re-hosted; it is downloaded at build time
  from Meta's URL.

If you fork this repository, the code stays MIT and the data files stay
CC-BY-SA-4.0. They are not the same licence and should not be conflated.

### MASSIVE 1.1 — CC-BY-4.0

Source: `https://amazon-massive-nlu-dataset.s3.amazonaws.com/amazon-massive-dataset-1.1.tar.gz`
(Amazon's own distribution.)

> FitzGerald, J. et al. *MASSIVE: A 1M-Example Multilingual Natural Language
> Understanding Dataset with 51 Typologically-Diverse Languages.* 2022.

Attribution required; no share-alike. Only aggregate statistics derived from
MASSIVE are exported — no utterance text ships in the site data.

---

## 2. Tokenizers

Tokenizer files are downloaded at build time and are **not committed**, except
where noted. Each remains under its own terms.

| Family | Source used | Licence | Committed here? |
|---|---|---|---|
| GPT-2, cl100k, o200k | `tiktoken` package | MIT | No — pip dependency |
| Llama-3 | `NousResearch/Meta-Llama-3-8B` | Meta Llama 3 Community License | **No** — fetched at build time |
| Gemma | `unsloth/gemma-2-2b` | Gemma Terms of Use | No — fetched into `data/`, gitignored |
| Tekken | `mistralai/Mistral-Nemo-Base-2407` | Apache-2.0 | No — fetched into `data/`, gitignored |
| Qwen2 | `Qwen/Qwen2-7B` | Apache-2.0 | No — fetched into `data/`, gitignored |
| BLOOM | `bigscience/bloom` | BigScience RAIL License v1.0 | No — fetched into `data/`, gitignored |

### The Llama-3 tokenizer specifically

Meta's Llama 3 Community License is not an open-source licence and is not
compatible with MIT. Committing `tokenizer.json` to a public repository is
redistribution under those terms.

This repository therefore does **not** commit it. `web/public/tokenizers/` is
gitignored, and `web/scripts/fetch-tokenizers.mjs` retrieves the file during the
build — which is also why the Netlify build command is
`npm run assets && npm run build`. The deployed site serves the file; the source
tree does not carry it. Users of the deployed site remain subject to Meta's
terms for that file.

Only the *tokenizer* is used anywhere in this project. No model weights are
downloaded, and no inference is ever run.

### Gated sources

`meta-llama/Meta-Llama-3-8B` and `google/gemma-2-2b` are access-gated and return
HTTP 403 without an approved request. The mirrors above are used instead, and
are verified to tokenize identically — see `METHODOLOGY.md` for the evidence and
`pipeline/sources.toml` for the recorded hashes. Using a mirror does not change
the licence that applies to the file.

---

## 3. Fonts — SIL Open Font License 1.1

Noto Sans (per-script subsets), Noto Serif Tibetan, Archivo, Instrument Sans and
Martian Mono, retrieved from Google Fonts and self-hosted in
`web/public/fonts/`.

OFL-1.1 explicitly permits bundled redistribution provided the licence
accompanies the fonts, so these **are** committed, and the licence text ships
alongside them at `web/public/fonts/OFL.txt`. The reserved font names are not
used for any modified version; the files are unmodified subsets as served by
Google Fonts.

---

## 4. Language metadata

| Source | Used for | Licence |
|---|---|---|
| Glottolog CLDF | language family, macro-area | CC-BY-4.0 |
| Wikidata (P1098, P220) | speaker counts | CC0-1.0 |

Ethnologue is **not** used. Its figures are more complete and more widely
reproduced, but they are licence-restricted.

> Hammarström, H., Forkel, R., Haspelmath, M., Bank, S. *Glottolog.*
> Max Planck Institute for Evolutionary Anthropology.

---

## 5. Software dependencies

Python: `tiktoken` (MIT), `tokenizers` (Apache-2.0), `huggingface-hub`
(Apache-2.0), `numpy` (BSD-3-Clause), `requests` (Apache-2.0), `tqdm`
(MPL-2.0/MIT), `scipy` (BSD-3-Clause), `pytest` (MIT).

JavaScript: `vite` (MIT), `typescript` (Apache-2.0), the `d3-*` modules
(ISC), `js-tiktoken` (MIT), `@lenml/tokenizers` (Apache-2.0),
`playwright-core` (Apache-2.0), `lighthouse` (Apache-2.0).

---

## 6. Summary

| Artefact | Licence |
|---|---|
| Everything under `pipeline/src`, `web/src`, `web/scripts` | MIT |
| `web/public/data/*.json` | **CC-BY-SA-4.0** (derived from FLORES-200) |
| `web/public/fonts/**` | OFL-1.1 |
| `web/public/tokenizers/**` (build output only) | Meta Llama 3 Community License |
| Documentation (`README.md`, `METHODOLOGY.md`, `docs/BRIEF.md`) | MIT |
