# SPDX-License-Identifier: MIT
"""Every number that appears in prose, with the referent that makes it checkable.

A figure quoted without its referent is not a finding, it is a rumour. "325
tokens for Telugu" is meaningless until you know it is a *median over the 997
FLORES-200 dev sentences* on a *named tokenizer* — and it is a different number
from "221 tiles", which is one particular sentence, and different again from a
count over a hand-written probe string.

So no figure is typed by hand into a document. Everything the README, the
METHODOLOGY and the site say numerically is computed here, exported to
``web/public/data/headline.json`` with its corpus, statistic, language,
tokenizer and sample size attached, and substituted into the documents by
``src.render_docs``. A pytest gate re-renders and fails if a document has
drifted from the data.
"""

from __future__ import annotations

import statistics
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any

from . import tokenizers_registry as tr
from .config import ENGLISH

TELUGU = "tel_Telu"
BENGALI = "ben_Beng"
DEMO_TOKENIZERS = ("gpt2", "cl100k", "o200k", "bloom")


@dataclass
class Figure:
    key: str
    text: str                        # exactly what appears in prose
    claim: str                       # what it is evidence for
    statistic: str
    referent: dict[str, Any]
    value: Any = None
    values: dict[str, Any] = field(default_factory=dict)


def _fmt(value: float, digits: int = 0) -> str:
    return f"{value:,.{digits}f}"


def compute(results, texts) -> list[Figure]:
    flores, floors = results["flores"]
    massive, _ = results["massive"]
    n_flores = len(texts["flores"][ENGLISH])
    n_massive = len(texts["massive"][ENGLISH])
    codes = sorted(flores)

    def med(tok: str) -> float:
        return statistics.median(flores[c][tok].fertility for c in codes)

    figures: list[Figure] = []

    # ---- 1. the inversion: allocation is scoped, not general -------------
    bloom_med, o200k_med = med("bloom"), med("o200k")
    figures.append(Figure(
        key="median_fertility_bloom_vs_o200k",
        text=f"{bloom_med:.2f}× against {o200k_med:.2f}×",
        claim=(
            "A vocabulary allocated multilingually is not uniformly better. "
            "BLOOM's median across all languages is slightly worse than the "
            "current OpenAI encoding's."
        ),
        statistic=f"median over {len(codes)} languages of per-language fertility",
        referent={"corpus": "flores200", "n_sentences": n_flores,
                  "n_languages": len(codes), "pivot": ENGLISH},
        values={"bloom": round(bloom_med, 2), "o200k": round(o200k_med, 2)},
    ))

    figures.append(Figure(
        key="bengali_bloom_vs_o200k",
        text=(f"{flores[BENGALI]['bloom'].fertility:.2f}× against "
              f"{flores[BENGALI]['o200k'].fertility:.2f}×"),
        claim=(
            "Inside its coverage, the multilingual vocabulary is dramatically "
            "better. The advantage is scoped to the languages it targeted."
        ),
        statistic="median per-sentence-pair fertility against English",
        referent={"corpus": "flores200", "language": BENGALI,
                  "n_sentences": n_flores, "pivot": ENGLISH},
        values={"bloom": round(flores[BENGALI]["bloom"].fertility, 2),
                "o200k": round(flores[BENGALI]["o200k"].fertility, 2)},
    ))

    beats = [c for c in codes
             if flores[c]["bloom"].fertility < flores[c]["o200k"].fertility]
    figures.append(Figure(
        key="bloom_beats_o200k_count",
        text=f"{len(beats)} of {len(codes)}",
        claim="The coverage boundary is visible in the numbers.",
        statistic="count of languages where BLOOM fertility < o200k fertility",
        referent={"corpus": "flores200", "n_languages": len(codes)},
        value=len(beats),
    ))

    # ---- 2. the demonstration: Telugu, decomposed ------------------------
    figures.append(Figure(
        key="telugu_median_tokens",
        text=", ".join(f"{_fmt(flores[TELUGU][t].tokens_median)} on {t}"
                       for t in DEMO_TOKENIZERS),
        claim=(
            "The same language costs wildly different amounts depending only on "
            "how much vocabulary was spent on it."
        ),
        statistic="median tokens per sentence",
        referent={"corpus": "flores200", "language": TELUGU, "n_sentences": n_flores},
        values={t: int(flores[TELUGU][t].tokens_median) for t in DEMO_TOKENIZERS},
    ))

    figures.append(Figure(
        key="english_median_tokens",
        text=", ".join(f"{_fmt(flores[ENGLISH][t].tokens_median)} on {t}"
                       for t in DEMO_TOKENIZERS),
        claim="The English baseline for the same sentences, on the same tokenizers.",
        statistic="median tokens per sentence",
        referent={"corpus": "flores200", "language": ENGLISH, "n_sentences": n_flores},
        values={t: int(flores[ENGLISH][t].tokens_median) for t in DEMO_TOKENIZERS},
    ))

    figures.append(Figure(
        key="telugu_floor_and_neglect",
        text=(f"floor {_fmt(floors[TELUGU])} tokens, "
              f"{_fmt(flores[TELUGU]['gpt2'].tokens_median - floors[TELUGU])} above it on GPT-2"),
        claim=(
            "Splitting the cost: the floor is what the writing system needs, the "
            "excess is vocabulary that was never allocated."
        ),
        statistic="min median tokens across the eight tokenizers, and the excess over it",
        referent={"corpus": "flores200", "language": TELUGU, "n_sentences": n_flores},
        values={"floor": int(floors[TELUGU]),
                "excess_gpt2": int(flores[TELUGU]["gpt2"].tokens_median - floors[TELUGU]),
                "neglect_gpt2": round(flores[TELUGU]["gpt2"].neglect, 2)},
    ))

    return figures


def compute_glyphless(texts, language: str = TELUGU, tok_key: str = "gpt2") -> Figure:
    """Share of tokens that carry no character of their own.

    Byte-level BPE splits a multi-byte character across several tokens; all but
    the one that completes it have an empty span. This walks the whole corpus
    rather than a single sentence, because a per-sentence count is a different
    statistic and the two have been confused before.
    """
    tok = tr.get(tok_key)
    total = empty = 0
    for sentence in texts["flores"][language]:
        for piece, _start, _end in tok.pieces(sentence):
            total += 1
            if piece == "":
                empty += 1
    share = empty / total
    return Figure(
        key="telugu_glyphless_share",
        text=f"{share:.0%}",
        claim=(
            "Most of what the worst tokenizer charges for is not letters. It is "
            "byte fragments of characters it has no vocabulary for."
        ),
        statistic="share of tokens whose span contains no character",
        referent={"corpus": "flores200", "language": language, "tokenizer": tok_key,
                  "n_sentences": len(texts["flores"][language]),
                  "n_tokens": total, "n_glyphless": empty},
        value=round(share, 4),
    )


def compute_aggregates(results) -> list[Figure]:
    flores, _ = results["flores"]
    massive, _ = results["massive"]
    codes = sorted(flores)
    out: list[Figure] = []

    for tok_key in ("gpt2", "o200k"):
        vals = [flores[c][tok_key].fertility for c in codes]
        over2 = sum(1 for v in vals if v > 2)
        over4 = sum(1 for v in vals if v > 4)
        out.append(Figure(
            key=f"{tok_key}_over_thresholds",
            text=f"{over2} of {len(codes)} above 2× and {over4} above 4×",
            claim="The surcharge is the normal case, not an edge case.",
            statistic="count of languages above a fertility threshold",
            referent={"corpus": "flores200", "tokenizer": tok_key,
                      "n_languages": len(codes)},
            values={"over_2x": over2, "over_4x": over4, "total": len(codes)},
        ))

    identical = [c for c in codes
                 if abs(flores[c]["llama3"].fertility - flores[c]["cl100k"].fertility) < 1e-9]
    out.append(Figure(
        key="llama3_identical_to_cl100k",
        text=f"{len(identical)} of {len(codes)}",
        claim=(
            "Llama-3 extends cl100k_base by roughly 28,000 tokens. For these "
            "languages it reports fertility identical to cl100k to the last "
            "decimal, because none of those additions went to them. Falsifiable: "
            "add coverage for any of them and the number drops."
        ),
        statistic="count of languages with fertility identical to cl100k",
        referent={"corpus": "flores200", "n_languages": len(codes),
                  "includes_telugu": TELUGU in identical,
                  "examples": sorted(identical)[:8]},
        value=len(identical),
    ))

    out.append(Figure(
        key="telugu_llama3_and_cl100k",
        text=(f"{flores[TELUGU]['llama3'].fertility:.2f}× on both "
              f"Llama-3 and cl100k"),
        claim=(
            "The clearest single instance of the negative space: two tokenizer "
            "generations apart, identical cost, because the newer vocabulary "
            "added nothing for this script."
        ),
        statistic="median per-sentence-pair fertility against English",
        referent={"corpus": "flores200", "language": TELUGU,
                  "tokenizers": ["llama3", "cl100k"], "pivot": ENGLISH},
        values={"llama3": round(flores[TELUGU]["llama3"].fertility, 2),
                "cl100k": round(flores[TELUGU]["cl100k"].fertility, 2)},
    ))

    from .measure import rank_correlation
    rhos = {k: round(rank_correlation(flores, massive, k)[0], 3) for k in tr.KEYS}
    out.append(Figure(
        key="cross_corpus_rank_correlation",
        text=f"{min(rhos.values()):.2f} to {max(rhos.values()):.2f}",
        claim="The ranking survives a change of register, so it is not an artefact of edited prose.",
        statistic="Spearman rho between FLORES-200 and MASSIVE fertility rankings",
        referent={"corpora": ["flores200", "massive"],
                  "n_shared_languages": len(set(flores) & set(massive))},
        values=rhos,
    ))
    return out


def build_payload(results, texts) -> dict:
    figures = compute(results, texts)
    figures.append(compute_glyphless(texts))
    figures.extend(compute_aggregates(results))
    return {
        "generated": date.today().isoformat(),
        "note": (
            "Every number quoted in the README, METHODOLOGY.md and the site is "
            "generated from here. Each figure carries the corpus, statistic, "
            "language, tokenizer and sample size it refers to, because the same "
            "language yields different numbers under different statistics and "
            "those have been conflated before."
        ),
        "figures": {f.key: asdict(f) for f in figures},
    }
