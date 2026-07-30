# SPDX-License-Identifier: MIT
"""Provenance gate.

The study's authority rests on knowing exactly what went into it. These tests
fail if any recorded source stops matching what the pipeline actually loads, so
a substitution, an upstream edit or a silent re-upload cannot pass unnoticed.

They are deliberately offline except where noted: they compare the *recorded*
identity in ``sources.toml`` against the tokenizer the pipeline just built, and
against the local corpus archives.
"""

from __future__ import annotations

import pytest

from src import corpora, provenance
from src import tokenizers_registry as tr
from src.config import RAW_DIR
from src.provenance import PROBES, probe_hash, sha256_file

ARCHIVES = {
    "flores200": "flores200_dataset.tar.gz",
    "massive": "amazon-massive-dataset-1.1.tar.gz",
}


@pytest.fixture(scope="session")
def sources():
    return provenance.load()


@pytest.mark.gate
def test_every_input_has_a_provenance_row(sources):
    """Nothing may be measured that is not recorded."""
    recorded = {key.split(".", 1)[1] for key in sources if key.startswith("tokenizer.")}
    assert recorded == set(tr.KEYS), (
        f"tokenizers without a sources.toml row: {set(tr.KEYS) - recorded}; "
        f"rows without a tokenizer: {recorded - set(tr.KEYS)}"
    )
    corpus_rows = {key.split(".", 1)[1] for key in sources if key.startswith("corpus.")}
    assert corpus_rows == {"flores200", "massive"}


@pytest.mark.gate
@pytest.mark.parametrize("key", tr.KEYS)
def test_tokenizer_matches_its_recorded_identity(sources, key):
    """The tokenizer the pipeline loaded must be the one provenance claims.

    Compared on behaviour, not on the sha256 of tokenizer.json: legitimate
    mirrors of the same tokenizer differ in chat templates and added-token
    metadata while tokenizing identically, so a whole-file hash would flag
    honest sources and still say nothing about output.
    """
    row = sources[f"tokenizer.{key}"]
    tok = tr.get(key)

    assert tok.vocab_size == row.vocab_size, (
        f"{key}: vocabulary is {tok.vocab_size}, sources.toml records "
        f"{row.vocab_size}. The upstream tokenizer changed."
    )
    assert probe_hash(tok.encode) == row.probe_sha256, (
        f"{key}: token ids for the {len(PROBES)}-string probe set no longer match "
        f"the recorded hash. Every exported number measured with this tokenizer "
        f"is suspect. Re-run `uv run python -m src.refresh_sources` only after "
        f"establishing why it changed."
    )
    assert row.resolved, f"{key}: no resolved source recorded"
    assert row.spdx, f"{key}: no SPDX identifier recorded"


@pytest.mark.gate
@pytest.mark.parametrize("key,filename", sorted(ARCHIVES.items()))
def test_corpus_archive_matches_its_recorded_hash(sources, key, filename):
    archive = RAW_DIR / filename
    if not archive.exists():
        pytest.skip(f"{filename} not fetched; run the pipeline first")
    assert sha256_file(archive) == sources[f"corpus.{key}"].sha256, (
        f"{key}: the archive on disk is not the one recorded in sources.toml"
    )


@pytest.mark.gate
def test_substitutions_are_flagged_and_justified(sources):
    """A substituted source must say why, and how it was checked.

    Two of the eight tokenizers are substituted, both because the canonical repo
    is access-gated. Neither corpus is substituted: FLORES-200 and MASSIVE are
    fetched from Meta's and Amazon's own distributions, which are the canonical
    sources — it is the HuggingFace paths that are mirrors.
    """
    subs = {s.key for s in sources.values() if s.substituted}
    assert subs == {"llama3", "gemma"}, (
        f"unexpected substitution set {subs}; if this changed deliberately, "
        "update this gate and METHODOLOGY together"
    )
    for source in sources.values():
        if not source.substituted:
            continue
        assert len(source.reason) > 40, f"{source.key}: substitution reason too thin"
        assert len(source.verified_against) > 80, (
            f"{source.key}: no evidence recorded for why the substitute is equivalent"
        )
        assert source.canonical != source.resolved


@pytest.mark.gate
def test_non_substituted_sources_really_are_canonical(sources):
    """Guards the mistake of quietly demoting a canonical source to a mirror."""
    for source in sources.values():
        if source.substituted:
            continue
        assert source.canonical == source.resolved or source.kind == "font", (
            f"{source.key} is not flagged as substituted but canonical "
            f"({source.canonical}) and resolved ({source.resolved}) differ"
        )


@pytest.mark.gate
def test_flores_release_is_flores_200_not_flores_plus(sources):
    """FLORES-200 and FLORES+ are different releases and must not be conflated.

    The loader pulls Meta's NLLB archive, whose own README self-identifies as
    'FLORES 200 dataset'. FLORES+ (openlanguagedata/flores_plus) is a separately
    maintained continuation with a different language inventory, and is not what
    is measured here.
    """
    row = sources["corpus.flores200"]
    assert "flores200_dataset.tar.gz" in row.resolved
    assert "flores_plus" not in row.resolved
    assert "FLORES-200" in row.revision

    readme = corpora.EXTRACTED_DIR / "flores200_dataset" / "README"
    if readme.exists():
        assert "FLORES 200" in readme.read_text(encoding="utf-8", errors="replace")


@pytest.mark.gate
def test_licences_are_recorded_for_everything(sources):
    for source in sources.values():
        assert source.licence, f"{source.key}: no licence recorded"
        assert source.spdx, f"{source.key}: no SPDX identifier recorded"
        assert source.retrieved, f"{source.key}: no retrieval date recorded"
