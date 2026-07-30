# SPDX-License-Identifier: MIT
"""Substitute generated figures into the documents.

Markdown carries spans like::

    <!--fig:telugu_median_tokens-->325 on gpt2, ...<!--/fig-->

and this module rewrites the contents from ``headline.json``. The same applies
to the provenance table in METHODOLOGY.md, which renders from ``sources.toml``.

    uv run python -m src.render_docs           # rewrite in place
    uv run python -m src.render_docs --check   # fail if anything is stale

The ``--check`` mode runs as a pytest gate, so a number edited by hand in a
document — or a figure that moved because the pipeline was re-run — fails the
build instead of quietly disagreeing with the data.
"""

from __future__ import annotations

import json
import re
import sys

from . import provenance
from .config import REPO_ROOT, WEB_DATA_DIR

DOCS = ("README.md", "METHODOLOGY.md")

FIG_PATTERN = re.compile(r"(<!--fig:([a-z0-9_]+)-->)(.*?)(<!--/fig-->)", re.S)
TABLE_PATTERN = re.compile(r"(<!--sources-table-->)(.*?)(<!--/sources-table-->)", re.S)


class StaleDocument(RuntimeError):
    pass


def _figures() -> dict:
    path = WEB_DATA_DIR / "headline.json"
    if not path.exists():
        raise StaleDocument(
            f"{path} is missing. Run the pipeline before rendering documents."
        )
    return json.loads(path.read_text(encoding="utf-8"))["figures"]


def render(text: str, figures: dict) -> str:
    def replace_figure(match: re.Match) -> str:
        open_tag, key, _current, close_tag = match.groups()
        if key not in figures:
            raise StaleDocument(
                f"document references unknown figure '{key}'. "
                f"Known figures: {', '.join(sorted(figures))}"
            )
        return f"{open_tag}{figures[key]['text']}{close_tag}"

    text = FIG_PATTERN.sub(replace_figure, text)
    text = TABLE_PATTERN.sub(
        lambda m: f"{m.group(1)}\n{provenance.markdown_table()}\n{m.group(3)}", text
    )
    return text


def main(argv: list[str]) -> int:
    check = "--check" in argv
    figures = _figures()
    stale: list[str] = []

    for name in DOCS:
        path = REPO_ROOT / name
        if not path.exists():
            continue
        original = path.read_text(encoding="utf-8")
        updated = render(original, figures)
        if original == updated:
            continue
        if check:
            stale.append(name)
        else:
            path.write_text(updated, encoding="utf-8")
            print(f"updated {name}")

    if check and stale:
        print(
            "These documents no longer match the exported data: "
            + ", ".join(stale)
            + "\nRun `uv run python -m src.render_docs` to bring them back in line.",
            file=sys.stderr,
        )
        return 1
    if check:
        print("documents match the exported figures")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
