.PHONY: pipeline setup fetch test export clean clean-cache

UV ?= uv

# Full run: empty cache to exported JSON, failing on any validation gate.
pipeline: setup fetch test export

setup:
	$(UV) python install 3.12
	$(UV) sync

fetch:
	$(UV) run python -c "from src import corpora; corpora.fetch_flores(); corpora.fetch_massive()"

test:
	$(UV) run pytest

export:
	$(UV) run python -m src.build

# Drop the derived token counts but keep the downloaded archives.
clean-cache:
	rm -rf ../data/cache

# Drop everything re-downloadable.
clean:
	rm -rf ../data/raw ../data/extracted ../data/cache ../data/tokenizers
