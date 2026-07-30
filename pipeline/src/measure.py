"""Fertility, floor and neglect.

Fertility is computed **per aligned sentence pair** and then medianed. Dividing
one median by another would discard the pairing, which is the only thing that
makes tokens-per-sentence a measure of tokens-per-unit-of-meaning.

    fertility(lang, tok) = median_i( tokens(lang_i, tok) / tokens(eng_i, tok) )

Floor and neglect split the surcharge in two:

    floor(lang)        = min over tokenizers of median tokens per sentence
    neglect(lang, tok) = (tokens_median - floor) / floor

The floor is the empirical best any tokenizer in the registry achieves for that
script — an approximation of the cost inherent to the writing system. Neglect is
everything above it, which is a vocabulary allocation choice rather than a
property of the language.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass

import numpy as np
from tqdm import tqdm

_QUIET = not sys.stderr.isatty()

from . import tokenizers_registry as tr
from .config import CACHE_DIR, ENGLISH


@dataclass(frozen=True)
class Metrics:
    tokens_median: float
    fertility: float
    p90_fertility: float
    chars_per_token: float
    neglect: float = 0.0


def _cache_path(corpus: str, tok_key: str) -> "object":
    return CACHE_DIR / f"counts_{corpus}_{tok_key}.npz"


def token_counts(
    corpus: str, sentences: dict[str, list[str]], tok_key: str
) -> dict[str, np.ndarray]:
    """Per-sentence token counts for one tokenizer over one corpus.

    Cached to npz keyed by (corpus, tokenizer) so re-runs cost nothing. The
    cache is invalidated by language set and row count, so a corpus change
    forces a recompute.
    """
    path = _cache_path(corpus, tok_key)
    codes = sorted(sentences)
    n_rows = len(sentences[codes[0]])

    if path.exists():
        with np.load(path, allow_pickle=False) as z:
            if list(z["_codes"]) == codes and int(z["_rows"]) == n_rows:
                return {c: z[c] for c in codes}

    tok = tr.get(tok_key)
    out: dict[str, np.ndarray] = {}
    for code in tqdm(codes, desc=f"{corpus}/{tok_key}", leave=False, disable=_QUIET):
        counts = tok.count_batch(sentences[code])
        out[code] = np.asarray(counts, dtype=np.int32)

    np.savez_compressed(
        path, _codes=np.array(codes), _rows=np.array(n_rows), **out
    )
    return out


def measure_corpus(
    corpus: str, sentences: dict[str, list[str]]
) -> dict[str, dict[str, Metrics]]:
    """{language: {tokenizer: Metrics}} for one corpus."""
    codes = sorted(sentences)
    char_counts = {c: np.array([len(s) for s in sentences[c]], dtype=np.int64) for c in codes}

    per_tok_counts = {
        key: token_counts(corpus, sentences, key) for key in tr.KEYS
    }

    result: dict[str, dict[str, Metrics]] = {c: {} for c in codes}
    for key, counts in per_tok_counts.items():
        eng = counts[ENGLISH].astype(np.float64)
        if np.any(eng <= 0):
            raise ValueError(f"{corpus}/{key}: English rows with zero tokens")
        for code in codes:
            lang = counts[code].astype(np.float64)
            ratios = lang / eng
            result[code][key] = Metrics(
                tokens_median=float(np.median(lang)),
                fertility=float(np.median(ratios)),
                p90_fertility=float(np.percentile(ratios, 90)),
                chars_per_token=float(char_counts[code].sum() / lang.sum()),
            )

    # floor and neglect, per language, across the tokenizer registry
    floors: dict[str, float] = {}
    for code in codes:
        floor = min(m.tokens_median for m in result[code].values())
        floors[code] = floor
        for key, m in result[code].items():
            excess = (m.tokens_median - floor) / floor if floor > 0 else 0.0
            result[code][key] = Metrics(**{**asdict(m), "neglect": excess})

    return result, floors


def measure_all(corpora: dict[str, dict[str, list[str]]]):
    """{corpus: ({language: {tokenizer: Metrics}}, {language: floor})}"""
    return {name: measure_corpus(name, rows) for name, rows in corpora.items()}


def rank_correlation(
    a: dict[str, dict[str, Metrics]],
    b: dict[str, dict[str, Metrics]],
    tok_key: str,
) -> tuple[float, int]:
    """Spearman rho between two corpora's fertility rankings, over the languages
    they share. Returns (rho, n)."""
    from scipy.stats import spearmanr

    shared = sorted(set(a) & set(b))
    if len(shared) < 3:
        raise ValueError(f"only {len(shared)} shared languages")
    xs = [a[c][tok_key].fertility for c in shared]
    ys = [b[c][tok_key].fertility for c in shared]
    rho = float(spearmanr(xs, ys).statistic)
    return rho, len(shared)


def summary_json(results) -> str:
    """Compact dump used by the tests so gates run without re-tokenising."""
    payload = {}
    for corpus, (per_lang, floors) in results.items():
        payload[corpus] = {
            "floors": floors,
            "metrics": {
                code: {k: asdict(m) for k, m in toks.items()}
                for code, toks in per_lang.items()
            },
        }
    return json.dumps(payload)
