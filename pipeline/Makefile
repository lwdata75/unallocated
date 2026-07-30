# SPDX-License-Identifier: MIT
.PHONY: pipeline setup fetch gates export docs verify test sources clean clean-cache

UV ?= uv

# Full run: empty cache to exported JSON and rendered documents.
#
# Order matters. The measurement and provenance gates run BEFORE the export, so
# the pipeline fails rather than writing numbers it cannot stand behind. The
# document gates can only run AFTER, because they check the rendered prose
# against the data that was just exported.
pipeline: setup fetch gates export docs verify

setup:
	$(UV) python install 3.12
	$(UV) sync

fetch:
	$(UV) run python -c "from src import corpora; corpora.fetch_flores(); corpora.fetch_massive()"

# Fail before exporting anything.
gates:
	$(UV) run pytest tests/test_gates.py tests/test_provenance.py

export:
	$(UV) run python -m src.build

# Rewrite every generated figure and the provenance table into the documents.
docs:
	$(UV) run python -m src.render_docs

# Everything, including the document gates.
verify:
	$(UV) run pytest

test: verify

# Re-check provenance against upstream and regenerate sources.toml. Deliberate,
# not part of a build: it changes recorded hashes.
sources:
	$(UV) run python -m src.refresh_sources

# Drop the derived token counts but keep the downloaded archives.
clean-cache:
	rm -rf ../data/cache

# Drop everything re-downloadable.
clean:
	rm -rf ../data/raw ../data/extracted ../data/cache ../data/tokenizers
