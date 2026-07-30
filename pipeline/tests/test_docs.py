# SPDX-License-Identifier: MIT
"""Documents must agree with the exported data.

Numbers typed by hand into two documents diverge. These gates make that a build
failure rather than something a reader discovers.
"""

from __future__ import annotations

import json
import re

import pytest

from src import render_docs
from src.config import REPO_ROOT, WEB_DATA_DIR

# Figures that appeared in an earlier draft with the wrong referent, or with no
# referent at all. They must not come back.
BANNED_STRINGS = {
    "70 of 110": "a hand-written probe string, not a corpus statistic",
    "110 tokens": "per-sentence count from an ad-hoc string, conflated with corpus medians",
    "The English Discount": "former project name",
    "The English discount": "former project name",
    "token tax": "former project name",
}


@pytest.fixture(scope="session")
def headline():
    path = WEB_DATA_DIR / "headline.json"
    if not path.exists():
        pytest.skip("headline.json not exported yet; run the pipeline")
    return json.loads(path.read_text(encoding="utf-8"))["figures"]


@pytest.mark.gate
def test_documents_match_the_exported_figures():
    """Re-render and fail if anything moved. Equivalent to a formatter check."""
    assert render_docs.main(["--check"]) == 0, (
        "a document no longer matches headline.json. Run "
        "`uv run python -m src.render_docs` to bring it back in line."
    )


@pytest.mark.gate
def test_every_figure_span_resolves(headline):
    """A document may not reference a figure the pipeline does not export."""
    for name in render_docs.DOCS:
        path = REPO_ROOT / name
        if not path.exists():
            continue
        for _open, key, _body, _close in render_docs.FIG_PATTERN.findall(
            path.read_text(encoding="utf-8")
        ):
            assert key in headline, f"{name} references unknown figure '{key}'"


@pytest.mark.gate
def test_every_figure_carries_a_referent(headline):
    """A number without corpus, statistic and sample size is not checkable."""
    for key, figure in headline.items():
        assert figure["statistic"], f"{key}: no statistic recorded"
        assert figure["claim"], f"{key}: no claim recorded"
        referent = figure["referent"]
        assert referent, f"{key}: no referent recorded"
        assert any(k in referent for k in ("corpus", "corpora")), (
            f"{key}: referent names no corpus"
        )
        assert figure["value"] is not None or figure["values"], f"{key}: no value"


@pytest.mark.gate
@pytest.mark.parametrize("name", render_docs.DOCS)
def test_no_stale_or_unreferenced_figures_in_prose(name):
    path = REPO_ROOT / name
    if not path.exists():
        pytest.skip(f"{name} absent")
    text = path.read_text(encoding="utf-8")
    for needle, why in BANNED_STRINGS.items():
        assert needle not in text, f"{name} still contains '{needle}' — {why}"


@pytest.mark.gate
@pytest.mark.parametrize("name", render_docs.DOCS)
def test_bare_multipliers_are_inside_figure_spans(name):
    """Catch numbers typed straight into prose.

    Any `N.N×` or `N×` outside a generated span is a figure nobody can trace, so
    it either becomes a figure or it goes. A short allowlist covers values that
    are definitional rather than measured.
    """
    allowed = {"1.0×", "1×", "2×", "4×", "0.85×"}
    text = (REPO_ROOT / name).read_text(encoding="utf-8")
    outside = render_docs.FIG_PATTERN.sub("", text)
    # `(?!\d)` so image dimensions like 1200×630 are not read as multipliers.
    found = set(re.findall(r"\d+(?:\.\d+)?×(?!\d)", outside)) - allowed
    assert not found, (
        f"{name} quotes multipliers outside a generated span: {sorted(found)}. "
        "Add them to headline.py and wrap them in <!--fig:key--> spans."
    )
