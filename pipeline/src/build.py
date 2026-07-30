# SPDX-License-Identifier: MIT
"""The pipeline driver. ``make pipeline`` runs this.

Order matters: fetch -> load -> assert alignment -> measure -> validate -> export.
The validation gates in ``tests/`` import ``results()`` from here, so they check
the same objects that get exported rather than a re-derivation of them.
"""

from __future__ import annotations

import sys
from functools import lru_cache

from . import corpora, export, measure, metadata, provenance
from . import tokenizers_registry as tr
from .config import ENGLISH


@lru_cache(maxsize=1)
def texts() -> dict[str, dict[str, list[str]]]:
    """{corpus: {language: [sentences]}} — aligned, or it raises."""
    return {"flores": corpora.load_flores(), "massive": corpora.load_massive()}


@lru_cache(maxsize=1)
def results():
    """{corpus: ({language: {tokenizer: Metrics}}, {language: floor})}"""
    return measure.measure_all(texts())


def summarise() -> str:
    """The headline numbers, printed at the end of a run."""
    res = results()
    flores, floors = res["flores"]
    lines: list[str] = []

    def fert(code: str, key: str) -> float:
        return flores[code][key].fertility

    worst = sorted(flores, key=lambda c: -fert(c, "o200k"))[:8]
    lines.append("Worst hit on the current OpenAI tokenizer (o200k):")
    for code in worst:
        m = metadata.describe(code)
        lines.append(
            f"  {m['name'][:24]:24s} {m['script'][:12]:12s} "
            f"{fert(code, 'o200k'):6.1f}x  (gpt2 {fert(code, 'gpt2'):6.1f}x, "
            f"bloom {fert(code, 'bloom'):5.1f}x)"
        )

    lines.append("")
    lines.append("Median fertility across all 204 languages, by tokenizer:")
    import statistics

    for key in tr.KEYS:
        vals = [fert(c, key) for c in flores]
        lines.append(
            f"  {key:8s} median {statistics.median(vals):5.2f}x   "
            f"p90 {sorted(vals)[int(0.9 * len(vals))]:6.2f}x   "
            f"max {max(vals):7.2f}x"
        )

    lines.append("")
    massive, _ = res["massive"]
    for key in ("o200k", "gpt2", "bloom"):
        rho, n = measure.rank_correlation(flores, massive, key)
        lines.append(f"Spearman rho FLORES vs MASSIVE ({key}, n={n}): {rho:.3f}")

    gaps = metadata.coverage_report(sorted(flores))
    lines.append("")
    lines.append(
        f"Metadata gaps: {len(gaps['speakers'])} without speaker counts, "
        f"{len(gaps['family'])} unclassified family, {len(gaps['region'])} unknown region"
    )
    return "\n".join(lines)


def main() -> int:
    print(f"pivot language: {ENGLISH}")
    corpus_texts = texts()
    for name, rows in corpus_texts.items():
        print(f"{name}: {len(rows)} languages x {len(rows[ENGLISH])} rows")

    # Verify every recorded source still is what it claims before exporting
    # anything derived from it.
    print(f"provenance: {len(provenance.load())} sources, "
          f"{len(provenance.substitutions())} substituted")

    res = results()
    written = export.write_all(res, corpus_texts["flores"], corpus_texts)
    print()
    for name, size in written.items():
        print(f"wrote web/public/data/{name}  {size / 1024:.0f} KB")
    print()
    print(summarise())
    return 0


if __name__ == "__main__":
    sys.exit(main())
