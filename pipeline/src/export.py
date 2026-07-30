"""Write the pre-aggregated JSON the site is built on.

Everything is aggregated here so the browser never tokenises on first paint and
never downloads a corpus. Two files:

``languages.json`` — every language, every tokenizer, both corpora.
``samples.json``   — 12 sentences in the showcase languages, pre-tokenised
                     against all eight tokenizers, with character offsets so the
                     hero can render tiles with no tokenizer in the browser.

Numbers are rounded to what the corpus actually supports. A 997-sentence sample
does not justify five significant figures.
"""

from __future__ import annotations

import json
from datetime import date

from . import metadata
from . import tokenizers_registry as tr
from .config import ENGLISH, WEB_DATA_DIR

# Scripts the hero has to render correctly, plus enough Latin-script languages
# to make the "even close relatives pay" point.
SHOWCASE = [
    "eng_Latn", "fra_Latn", "spa_Latn", "deu_Latn", "por_Latn", "ita_Latn",
    "pol_Latn", "tur_Latn", "vie_Latn", "swh_Latn", "ell_Grek", "rus_Cyrl",
    "heb_Hebr", "arb_Arab", "hin_Deva", "ben_Beng", "tel_Telu", "tam_Taml",
    "tha_Thai", "mya_Mymr", "amh_Ethi", "kat_Geor", "jpn_Jpan", "kor_Hang",
    "zho_Hans",
]

N_SAMPLES = 12
# Sentence length window, in English characters. Short enough that a tile field
# stays readable even at GPT-2 fertility on Burmese, long enough to be a real
# sentence rather than a fragment.
SAMPLE_MIN_CHARS = 45
SAMPLE_MAX_CHARS = 115


def _round(value: float, places: int) -> float:
    r = round(value, places)
    return int(r) if r == int(r) else r


def build_languages(results, generated: str) -> dict:
    flores_metrics, flores_floors = results["flores"]
    massive_metrics, massive_floors = results["massive"]

    corpora_floors = {"flores": flores_floors, "massive": massive_floors}
    per_corpus = {"flores": flores_metrics, "massive": massive_metrics}

    languages = []
    for code in sorted(flores_metrics):
        meta = metadata.describe(code)
        entry = {
            **meta,
            "floor": _round(flores_floors[code], 0),
            "floors": {
                corpus: _round(floors[code], 0)
                for corpus, floors in corpora_floors.items()
                if code in floors
            },
            "metrics": {},
        }
        for corpus, per_lang in per_corpus.items():
            if code not in per_lang:
                continue
            entry["metrics"][corpus] = {
                key: {
                    "tokens": _round(m.tokens_median, 0),
                    "fertility": _round(m.fertility, 2),
                    "p90": _round(m.p90_fertility, 2),
                    "cpt": _round(m.chars_per_token, 2),
                    "neglect": _round(m.neglect, 2),
                }
                for key, m in per_lang[code].items()
            }
        languages.append(entry)

    return {
        "meta": {
            "generated": generated,
            "corpora": ["flores200", "massive"],
            "n_sentences": {"flores": 997, "massive": 5000},
            "pivot": ENGLISH,
            "note": (
                "Fertility is the median per-sentence ratio against English on the "
                "same tokenizer. Floor is the lowest median token count any tokenizer "
                "in this registry achieves for the language; neglect is the excess "
                "above that floor, measured within each corpus."
            ),
        },
        "tokenizers": [
            {
                "key": t.key,
                "family": t.spec.family,
                "vocab": t.vocab_size,
                "note": t.spec.note,
            }
            for t in tr.all_tokenizers()
        ],
        "languages": languages,
    }


def pick_sample_indices(flores: dict[str, list[str]]) -> list[int]:
    """Deterministic pick: the N_SAMPLES sentences closest to the middle of the
    length window, spread across the corpus so they are not all consecutive."""
    eng = flores[ENGLISH]
    target = (SAMPLE_MIN_CHARS + SAMPLE_MAX_CHARS) / 2
    candidates = [
        i for i, s in enumerate(eng) if SAMPLE_MIN_CHARS <= len(s) <= SAMPLE_MAX_CHARS
    ]
    candidates.sort(key=lambda i: (abs(len(eng[i]) - target), i))
    chosen: list[int] = []
    for i in candidates:
        if all(abs(i - j) > 20 for j in chosen):
            chosen.append(i)
        if len(chosen) == N_SAMPLES:
            break
    if len(chosen) < N_SAMPLES:
        raise RuntimeError(f"only found {len(chosen)} sample sentences")
    return sorted(chosen)


def build_samples(flores: dict[str, list[str]], generated: str) -> dict:
    """Token boundaries as cumulative character end-offsets.

    Storing only end offsets halves the payload: the start of token *k* is the
    end of token *k-1*, and the frontend slices the text directly.
    """
    indices = pick_sample_indices(flores)
    languages = [c for c in SHOWCASE if c in flores]
    toks = tr.all_tokenizers()

    sentences = []
    for idx in indices:
        texts = {code: flores[code][idx] for code in languages}
        boundaries: dict[str, dict[str, list[int]]] = {}
        for code, text in texts.items():
            boundaries[code] = {}
            for t in toks:
                pieces = t.pieces(text)
                boundaries[code][t.key] = [end for (_piece, _start, end) in pieces]
        sentences.append({"id": idx, "texts": texts, "tokens": boundaries})

    return {
        "meta": {
            "generated": generated,
            "source": "FLORES-200 dev split",
            "encoding": (
                "tokens[lang][tokenizer] holds cumulative character end-offsets; "
                "token k spans text[ends[k-1]:ends[k]], with ends[-1] treated as 0."
            ),
        },
        "languages": [{**metadata.describe(c), "code": c} for c in languages],
        "sentences": sentences,
    }


def write_all(results, flores: dict[str, list[str]]) -> dict[str, int]:
    generated = date.today().isoformat()
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)

    written = {}
    for name, payload in (
        ("languages.json", build_languages(results, generated)),
        ("samples.json", build_samples(flores, generated)),
    ):
        path = WEB_DATA_DIR / name
        path.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        written[name] = path.stat().st_size
    return written
