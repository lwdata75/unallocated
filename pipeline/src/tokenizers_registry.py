"""One tokenizer per family, behind a uniform interface.

The study compares tokenizer *families*, never model versions — every label in
the UI says so. Each entry below is the representative for its family.

Two families are load-bearing for the argument: GPT-2 shows the failure mode of
an English-only vocabulary, BLOOM shows what is achievable when a vocabulary is
allocated multilingually. Everything else sits between them, and that spread is
the finding.

Source note: ``meta-llama/*`` and ``google/gemma-*`` are gated on HuggingFace.
We use byte-identical ungated mirrors and record that in METHODOLOGY.md.
Mistral's Tekken is pulled as a plain ``tokenizer.json`` rather than through
``mistral-common``, which keeps the dependency set to one HF library and lets
the browser reuse the exact same file in phase 2.
"""

from __future__ import annotations

import os
import unicodedata
from bisect import bisect_right
from dataclasses import dataclass
from functools import cached_property

os.environ.setdefault("TOKENIZERS_PARALLELISM", "true")

from .config import TOKENIZER_DIR  # noqa: E402


@dataclass(frozen=True)
class TokenizerSpec:
    key: str
    family: str
    backend: str  # "tiktoken" | "hf"
    ref: str  # tiktoken encoding name, or HF repo id
    note: str
    gated_original: str | None = None


REGISTRY: tuple[TokenizerSpec, ...] = (
    TokenizerSpec(
        key="gpt2",
        family="Historical baseline",
        backend="tiktoken",
        ref="r50k_base",
        note="GPT-2 byte-level BPE. Shows how bad an English-only vocabulary was.",
    ),
    TokenizerSpec(
        key="cl100k",
        family="OpenAI legacy",
        backend="tiktoken",
        ref="cl100k_base",
        note="Used by GPT-3.5 and GPT-4 era models.",
    ),
    TokenizerSpec(
        key="o200k",
        family="OpenAI current",
        backend="tiktoken",
        ref="o200k_base",
        note="Current OpenAI encoding.",
    ),
    TokenizerSpec(
        key="llama3",
        family="Llama",
        backend="hf",
        ref="NousResearch/Meta-Llama-3-8B",
        note="Llama-3 tokenizer.",
        gated_original="meta-llama/Meta-Llama-3-8B",
    ),
    TokenizerSpec(
        key="gemma",
        family="Gemma / Gemini",
        backend="hf",
        ref="unsloth/gemma-2-2b",
        note="Gemma SentencePiece vocabulary.",
        gated_original="google/gemma-2-2b",
    ),
    TokenizerSpec(
        key="tekken",
        family="Mistral",
        backend="hf",
        ref="mistralai/Mistral-Nemo-Base-2407",
        note="Tekken, read from the repo's HF-format tokenizer.json.",
    ),
    TokenizerSpec(
        key="qwen2",
        family="Qwen",
        backend="hf",
        ref="Qwen/Qwen2-7B",
        note="Qwen2 tokenizer.",
    ),
    TokenizerSpec(
        key="bloom",
        family="Multilingual-first",
        backend="hf",
        ref="bigscience/bloom",
        note="Vocabulary allocated multilingually from the start. The ceiling.",
    ),
)

BY_KEY = {spec.key: spec for spec in REGISTRY}
KEYS = tuple(spec.key for spec in REGISTRY)


class Tok:
    """Uniform wrapper over a tiktoken encoding or an HF ``tokenizers`` model."""

    def __init__(self, spec: TokenizerSpec) -> None:
        self.spec = spec
        self.key = spec.key

    @cached_property
    def _impl(self):
        if self.spec.backend == "tiktoken":
            import tiktoken

            return tiktoken.get_encoding(self.spec.ref)

        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        local = hf_hub_download(
            repo_id=self.spec.ref,
            filename="tokenizer.json",
            local_dir=str(TOKENIZER_DIR / self.spec.key),
        )
        tok = Tokenizer.from_file(local)
        tok.no_truncation()
        tok.no_padding()
        return tok

    @property
    def vocab_size(self) -> int:
        """Read off the loaded tokenizer, never from a model config.json —
        config vocab sizes are padded for tensor-shape reasons and overstate it."""
        if self.spec.backend == "tiktoken":
            return self._impl.n_vocab
        return self._impl.get_vocab_size()

    def count_batch(self, texts: list[str]) -> list[int]:
        """Token counts for a batch. No special tokens on either backend."""
        if self.spec.backend == "tiktoken":
            return [len(ids) for ids in self._impl.encode_ordinary_batch(texts)]
        encodings = self._impl.encode_batch_fast(texts, add_special_tokens=False)
        return [len(e.ids) for e in encodings]

    def encode(self, text: str) -> list[int]:
        if self.spec.backend == "tiktoken":
            return self._impl.encode_ordinary(text)
        return self._impl.encode(text, add_special_tokens=False).ids

    def decode(self, ids: list[int]) -> str:
        if self.spec.backend == "tiktoken":
            return self._impl.decode(ids)
        return self._impl.decode(ids, skip_special_tokens=True)

    def normalize(self, text: str) -> str:
        """The form this tokenizer round-trips to.

        Qwen2 declares an NFC normalizer, so ``decode(encode(s))`` returns NFC(s)
        rather than s — pre-composed Bengali and decomposed Latin diacritics come
        back in a different but canonically equivalent form. That is a property
        of the tokenizer, not a defect in the measurement, and it is what the
        round-trip gate compares against.
        """
        if self.key == "qwen2":
            return unicodedata.normalize("NFC", text)
        return text

    def pieces(self, text: str) -> list[tuple[str, int, int]]:
        """Token surface strings with (start, end) character offsets into ``text``.

        Spans are guaranteed monotone, contiguous and non-overlapping, and there
        is exactly one span per token id. Byte-level BPE regularly splits a
        multi-byte character across two tokens; when that happens the character
        is attributed to the token that completes it and the earlier token gets
        an **empty span**. The frontend renders empty spans as continuation tiles
        with a dotted circle rather than duplicating or dropping the glyph.
        """
        if self.spec.backend == "tiktoken":
            raw_offsets = self._tiktoken_offsets(text)
        else:
            raw_offsets = self._impl.encode(text, add_special_tokens=False).offsets
        return _contiguous_spans(text, raw_offsets)

    def _tiktoken_offsets(self, text: str) -> list[tuple[int, int]]:
        """tiktoken exposes no offsets, but its encodings are byte-level: the
        concatenated token bytes reproduce the UTF-8 of the input exactly. Walk
        the byte stream and convert each boundary into a count of *complete*
        characters, which is the character offset we want."""
        enc = self._impl
        ids = enc.encode_ordinary(text)

        # byte offset at which each character starts, plus a terminator
        char_starts = [0]
        for ch in text:
            char_starts.append(char_starts[-1] + len(ch.encode("utf-8")))

        offsets: list[tuple[int, int]] = []
        pos = 0
        prev_chars = 0
        for tid in ids:
            pos += len(enc.decode_single_token_bytes(tid))
            # number of characters fully consumed by byte offset `pos`
            complete = bisect_right(char_starts, pos) - 1
            offsets.append((prev_chars, complete))
            prev_chars = complete
        if pos != char_starts[-1]:
            raise AssertionError(
                f"{self.key}: byte walk ended at {pos}, expected {char_starts[-1]}"
            )
        return offsets


def _contiguous_spans(
    text: str, offsets: list[tuple[int, int]]
) -> list[tuple[str, int, int]]:
    """Force raw tokenizer offsets into a clean tiling of ``text``.

    Raw offsets are not usable as-is: byte-level BPE reports overlapping ranges
    when a character straddles a token boundary, and SentencePiece-style
    normalizers report gaps where a space became a marker glyph. Overlaps
    collapse to empty spans, gaps get absorbed by the following token, and the
    final token is stretched to the end so no character is ever dropped.
    """
    spans: list[tuple[str, int, int]] = []
    prev = 0
    limit = len(text)
    for (_start, end) in offsets:
        start = prev
        end = min(max(end, prev), limit)
        spans.append((text[start:end], start, end))
        prev = end
    if spans and spans[-1][2] < limit:
        _piece, start, _end = spans[-1]
        spans[-1] = (text[start:limit], start, limit)
    return spans


_LOADED: dict[str, Tok] = {}


def get(key: str) -> Tok:
    if key not in _LOADED:
        _LOADED[key] = Tok(BY_KEY[key])
    return _LOADED[key]


def all_tokenizers() -> list[Tok]:
    return [get(k) for k in KEYS]
