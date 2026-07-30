# SPDX-License-Identifier: MIT
"""The validation gates from spec section 3.4.

These are gates, not diagnostics: the pipeline fails rather than exports if any
of them break. They run against the same objects ``build.results()`` hands to
the exporter, so a green test suite is a statement about the shipped JSON.
"""

from __future__ import annotations

import pytest

from src import build, corpora, measure
from src import tokenizers_registry as tr
from src.config import ENGLISH
from src.known_exceptions import SUB_ENGLISH_ALLOWED

ROUND_TRIP_SAMPLE = 200
MIN_RANK_CORRELATION = 0.7
MIN_FERTILITY = 0.85


@pytest.fixture(scope="session")
def res():
    return build.results()


@pytest.fixture(scope="session")
def texts():
    return build.texts()


# ---------------------------------------------------------------- gate 1

@pytest.mark.gate
@pytest.mark.parametrize("corpus", ["flores", "massive"])
@pytest.mark.parametrize("tok_key", tr.KEYS)
def test_english_fertility_is_exactly_one(res, corpus, tok_key):
    """English is the pivot, so its ratio against itself must be 1.0 exactly.
    Anything else means the pairing was lost somewhere."""
    per_lang, _ = res[corpus]
    assert per_lang[ENGLISH][tok_key].fertility == 1.0
    assert per_lang[ENGLISH][tok_key].p90_fertility == 1.0
    assert per_lang[ENGLISH][tok_key].neglect >= 0.0


# ---------------------------------------------------------------- gate 2

@pytest.mark.gate
def test_languages_in_both_corpora_have_both_rows(res):
    """Every MASSIVE language must also carry FLORES metrics, for every
    tokenizer. A language present in one corpus but half-measured in the other
    would silently distort the cross-corpus comparison."""
    flores, _ = res["flores"]
    massive, _ = res["massive"]

    missing = sorted(set(massive) - set(flores))
    assert not missing, f"in MASSIVE but not FLORES: {missing}"

    for code in sorted(massive):
        for corpus_name, table in (("flores", flores), ("massive", massive)):
            got = set(table[code])
            assert got == set(tr.KEYS), (
                f"{corpus_name}/{code} missing tokenizers: {set(tr.KEYS) - got}"
            )


@pytest.mark.gate
def test_massive_locale_map_is_complete_and_injective():
    """Every MASSIVE locale maps to a distinct FLORES code."""
    mapping = corpora.MASSIVE_LOCALE_TO_FLORES
    assert len(set(mapping.values())) == len(mapping), "duplicate FLORES targets"
    flores_codes = set(build.texts()["flores"])
    unknown = sorted(set(mapping.values()) - flores_codes)
    assert not unknown, f"mapped to codes FLORES does not have: {unknown}"


# ---------------------------------------------------------------- gate 3

@pytest.mark.gate
@pytest.mark.parametrize("tok_key", tr.KEYS)
def test_round_trip_decode(texts, tok_key):
    """decode(encode(s)) == s over a 200-sentence sample spanning many scripts.

    The sample is drawn across languages rather than from one, so a tokenizer
    that round-trips Latin text but mangles combining marks still fails.

    The comparison target is ``tok.normalize(s)``, which is the identity for
    seven of the eight families. Qwen2 declares an NFC normalizer, so it returns
    a canonically equivalent — not identical — string; that is a documented
    property of the tokenizer and METHODOLOGY.md records it.
    """
    flores = texts["flores"]
    codes = sorted(flores)
    sample: list[str] = []
    i = 0
    while len(sample) < ROUND_TRIP_SAMPLE:
        code = codes[i % len(codes)]
        sample.append(flores[code][i % len(flores[code])])
        i += 1

    tok = tr.get(tok_key)
    failures = []
    for text in sample:
        got = tok.decode(tok.encode(text))
        want = tok.normalize(text)
        if got != want:
            failures.append((want, got))

    if failures:
        original, got = failures[0]
        pytest.fail(
            f"{tok_key}: {len(failures)}/{len(sample)} sentences did not round-trip. "
            f"First divergence:\n  in : {original!r}\n  out: {got!r}"
        )


@pytest.mark.gate
@pytest.mark.parametrize("tok_key", tr.KEYS)
def test_offsets_tile_the_string_exactly(tok_key):
    """The offsets samples.json ships must tile the input exactly: one span per
    token id, monotone, contiguous, no overlaps, and reassembling to the
    original string. Empty spans are legal and expected — they are the
    continuation half of a character split across two tokens — but nothing may
    be duplicated or lost."""
    tok = tr.get(tok_key)
    for text in (
        "The quick brown fox jumps over the lazy dog.",
        "తెలుగు భాష ద్రావిడ కుటుంబానికి చెందినది.",
        "မြန်မာဘာသာစကားသည် တိဘက်-ဗမာနွယ် ဘာသာစကားဖြစ်သည်။",
        "የአማርኛ ቋንቋ የሴማዊ ቋንቋዎች ቤተሰብ አባል ነው።",
        "日本語は膠着語であり、語順は主語・目的語・動詞である。",
    ):
        pieces = tok.pieces(text)
        assert len(pieces) == len(tok.encode(text)), f"{tok_key}: piece/id count differs"
        assert pieces[0][1] == 0
        assert pieces[-1][2] == len(text)
        for (_p, _s, end), (_p2, start2, _e2) in zip(pieces, pieces[1:]):
            assert end == start2, f"{tok_key}: gap or overlap at offset {end}"
        assert "".join(p for p, _s, _e in pieces) == text, (
            f"{tok_key}: reassembled spans do not equal the input"
        )


# ---------------------------------------------------------------- gate 4

@pytest.mark.gate
@pytest.mark.parametrize("corpus", ["flores", "massive"])
def test_no_unexplained_sub_english_fertility(res, corpus):
    """A language cheaper than English is interesting but is more likely a bug,
    so each case must be argued for in known_exceptions.py before it passes."""
    per_lang, _ = res[corpus]
    offenders = []
    for code, per_tok in per_lang.items():
        for key, m in per_tok.items():
            if m.fertility < MIN_FERTILITY:
                reason = SUB_ENGLISH_ALLOWED.get((corpus, code, key))
                if not reason or len(reason) < 80:
                    offenders.append(f"{corpus}/{code}/{key} = {m.fertility:.3f}")
    assert not offenders, (
        "fertility below "
        f"{MIN_FERTILITY} without a written explanation in known_exceptions.py: "
        + ", ".join(sorted(offenders))
    )


@pytest.mark.gate
def test_exception_list_has_no_stale_entries(res):
    """An exception that no longer fires is a claim about the data that is no
    longer true. Remove it rather than leaving it to rot."""
    stale = []
    for (corpus, code, key) in SUB_ENGLISH_ALLOWED:
        per_lang, _ = res[corpus]
        if per_lang[code][key].fertility >= MIN_FERTILITY:
            stale.append(f"{corpus}/{code}/{key}")
    assert not stale, f"known_exceptions entries that no longer apply: {stale}"


# ---------------------------------------------------------------- gate 5

@pytest.mark.gate
@pytest.mark.parametrize("tok_key", tr.KEYS)
def test_rank_correlation_across_corpora(res, tok_key):
    """FLORES is Wikipedia-register prose, MASSIVE is short spoken commands. If
    the fertility ranking did not survive the register change, the domain
    sensitivity would itself be the finding and would have to be surfaced rather
    than hidden — so this fails loudly instead of degrading quietly."""
    flores, _ = res["flores"]
    massive, _ = res["massive"]
    rho, n = measure.rank_correlation(flores, massive, tok_key)
    assert rho > MIN_RANK_CORRELATION, (
        f"{tok_key}: Spearman rho {rho:.3f} over {n} shared languages is below "
        f"{MIN_RANK_CORRELATION}. Surface this in METHODOLOGY.md before shipping."
    )


# ---------------------------------------------- structural sanity checks

@pytest.mark.parametrize("corpus", ["flores", "massive"])
def test_alignment_holds(texts, corpus):
    corpora.assert_aligned(texts[corpus], corpus)


def test_floor_is_the_minimum_and_neglect_is_relative_to_it(res):
    """floor and neglect must stay consistent with each other, per corpus."""
    for corpus, (per_lang, floors) in res.items():
        for code, per_tok in per_lang.items():
            floor = floors[code]
            assert floor == min(m.tokens_median for m in per_tok.values())
            for key, m in per_tok.items():
                expected = (m.tokens_median - floor) / floor
                assert m.neglect == pytest.approx(expected, abs=1e-9)
                assert m.neglect >= 0.0, f"{corpus}/{code}/{key} has negative neglect"


def test_fertility_is_paired_not_a_ratio_of_medians(res):
    """Guards the one methodological mistake that would quietly invalidate the
    study: dividing median by median discards the sentence pairing. For a
    language with variable-length sentences the two differ, so if they ever
    agree everywhere the pairing has been lost."""
    flores, _ = res["flores"]
    eng = flores[ENGLISH]
    differs = 0
    for code, per_tok in flores.items():
        if code == ENGLISH:
            continue
        for key, m in per_tok.items():
            naive = m.tokens_median / eng[key].tokens_median
            if abs(naive - m.fertility) > 1e-6:
                differs += 1
    assert differs > 100, (
        "paired fertility is indistinguishable from the ratio of medians almost "
        "everywhere, which suggests the pairing was dropped"
    )


def test_vocab_sizes_match_the_published_families():
    """Read off the loaded tokenizer, not a model config.json, whose vocab_size
    is padded for tensor shapes and overstates the real vocabulary."""
    expected = {
        "gpt2": 50_257, "cl100k": 100_277, "o200k": 200_019, "llama3": 128_256,
        "gemma": 256_000, "tekken": 131_072, "qwen2": 151_646, "bloom": 250_680,
    }
    for key, want in expected.items():
        assert tr.get(key).vocab_size == want, f"{key} vocab changed upstream"
