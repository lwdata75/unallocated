# SPDX-License-Identifier: MIT
"""Shared paths and constants for the pipeline."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPO_ROOT / "data"

RAW_DIR = DATA_ROOT / "raw"
EXTRACTED_DIR = DATA_ROOT / "extracted"
CACHE_DIR = DATA_ROOT / "cache"
TOKENIZER_DIR = DATA_ROOT / "tokenizers"

WEB_DATA_DIR = REPO_ROOT / "web" / "public" / "data"

for _d in (RAW_DIR, EXTRACTED_DIR, CACHE_DIR, TOKENIZER_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# The pivot language every fertility ratio is measured against.
ENGLISH = "eng_Latn"

CORPORA = ("flores", "massive")

# MASSIVE is ~16.5k utterances per locale. Measuring all of them against eight
# tokenizers is ~7M encodes for no extra signal, so we take a seeded subsample.
# Recorded in METHODOLOGY.md.
MASSIVE_SAMPLE_SIZE = 5000
MASSIVE_SAMPLE_SEED = 20260730
