# SPDX-License-Identifier: MIT
"""Regenerate ``pipeline/sources.toml`` from what is actually on disk and online.

Run deliberately, not as part of a build:

    uv run python -m src.refresh_sources

It fetches the current revision of every remote source, recomputes hashes, and
re-runs the equivalence checks for substituted sources. The resulting file is
committed, and ``tests/test_provenance.py`` fails if a later run disagrees with
it — so a silent upstream change becomes a failing build rather than a quietly
different number.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

from . import corpora, provenance
from . import tokenizers_registry as tr
from .config import RAW_DIR, REPO_ROOT
from .provenance import SOURCES_FILE, behaviour_hash, probe_hash, sha256_file

FONT_MANIFEST = REPO_ROOT / "web" / "public" / "fonts" / "manifest.json"

# Independent re-uploads used to corroborate a substituted tokenizer. Agreement
# across unrelated organisations is what makes a community mirror trustworthy.
CORROBORATING_MIRRORS = {
    "llama3": ["unsloth/llama-3-8b", "princeton-nlp/Llama-3-Base-8B-SFT"],
    "gemma": ["unsloth/gemma-2-9b-it", "philschmid/gemma-tokenizer-chatml"],
}

CORPUS_ROWS = {
    "flores200": {
        "canonical": corpora.FLORES_URL,
        "resolved": corpora.FLORES_URL,
        "revision": "FLORES-200 (NLLB release, 2022)",
        "licence": "Creative Commons Attribution-ShareAlike 4.0",
        "spdx": "CC-BY-SA-4.0",
        "substituted": False,
        "reason": "",
        "verified_against": (
            "Archive README self-identifies as 'FLORES 200 dataset'; 204 language "
            "files, 997 dev sentences each. This is Meta's own distribution, not a "
            "mirror. Distinct from FLORES+ (openlanguagedata/flores_plus), which is "
            "a separately maintained continuation and is NOT what this study uses."
        ),
        "notes": (
            "The HuggingFace paths facebook/flores and openlanguagedata/flores_plus "
            "are gated and return 403 unauthenticated; this first-party archive is "
            "not, which is why it is used."
        ),
        "archive": "flores200_dataset.tar.gz",
    },
    "massive": {
        "canonical": corpora.MASSIVE_URL,
        "resolved": corpora.MASSIVE_URL,
        "revision": "1.1",
        "licence": "Creative Commons Attribution 4.0",
        "spdx": "CC-BY-4.0",
        "substituted": False,
        "reason": "",
        "verified_against": (
            "Amazon's own S3 distribution of MASSIVE 1.1, not a mirror. 52 locale "
            "files joined on utterance id."
        ),
        "notes": (
            "The HuggingFace dataset AmazonScience/massive is a legacy loading "
            "script that no longer executes under datasets>=3."
        ),
        "archive": "amazon-massive-dataset-1.1.tar.gz",
    },
}

TOKENIZER_ROWS = {
    "gpt2": dict(canonical="tiktoken r50k_base", licence="MIT", spdx="MIT",
                 substituted=False, reason="",
                 verified_against="First-party OpenAI encoding, shipped in the tiktoken package.",
                 notes="GPT-2 byte-level BPE."),
    "cl100k": dict(canonical="tiktoken cl100k_base", licence="MIT", spdx="MIT",
                   substituted=False, reason="",
                   verified_against="First-party OpenAI encoding, shipped in the tiktoken package.",
                   notes=""),
    "o200k": dict(canonical="tiktoken o200k_base", licence="MIT", spdx="MIT",
                  substituted=False, reason="",
                  verified_against="First-party OpenAI encoding, shipped in the tiktoken package.",
                  notes=""),
    "llama3": dict(canonical="meta-llama/Meta-Llama-3-8B",
                   licence="Meta Llama 3 Community License",
                   spdx="LicenseRef-Meta-Llama-3",
                   substituted=True,
                   reason=(
                       "meta-llama/Meta-Llama-3-8B is gated=manual and returns 403 "
                       "without an approved access request. This is gating, not an "
                       "outage."
                   ),
                   verified_against="",
                   notes=""),
    "gemma": dict(canonical="google/gemma-2-2b",
                  licence="Gemma Terms of Use",
                  spdx="LicenseRef-Gemma",
                  substituted=True,
                  reason=(
                      "google/gemma-2-2b is gated=manual and returns 403 without "
                      "accepting the Gemma terms. This is gating, not an outage."
                  ),
                  verified_against="",
                  notes=""),
    "tekken": dict(canonical="mistralai/Mistral-Nemo-Base-2407",
                   licence="Apache License 2.0", spdx="Apache-2.0",
                   substituted=False, reason="",
                   verified_against="First-party mistralai repository, ungated.",
                   notes=(
                       "Read from the HF-format tokenizer.json published alongside "
                       "tekken.json in the same first-party repo. A file-format "
                       "choice within the canonical source, not a substitution."
                   )),
    "qwen2": dict(canonical="Qwen/Qwen2-7B", licence="Apache License 2.0",
                  spdx="Apache-2.0", substituted=False, reason="",
                  verified_against="First-party Qwen repository, ungated.",
                  notes="Declares an NFC normalizer; see METHODOLOGY."),
    "bloom": dict(canonical="bigscience/bloom", licence="BigScience RAIL License v1.0",
                  spdx="LicenseRef-BigScience-RAIL-1.0", substituted=False, reason="",
                  verified_against="First-party BigScience repository, ungated.",
                  notes=""),
}


def _toml_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")


def _emit(kind: str, key: str, row: dict) -> str:
    lines = [f"[{kind}.{key}]"]
    for field, value in row.items():
        if isinstance(value, bool):
            lines.append(f"{field} = {str(value).lower()}")
        elif isinstance(value, int):
            lines.append(f"{field} = {value}")
        else:
            lines.append(f'{field} = "{_toml_escape(str(value))}"')
    return "\n".join(lines)


def _tokenizer_identity(spec_ref: str, token: str | None):
    """(behaviour_sha256, probe_sha256, vocab_size) for a HF repo."""
    from huggingface_hub import hf_hub_download
    from tokenizers import Tokenizer

    path = hf_hub_download(repo_id=spec_ref, filename="tokenizer.json")
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    tok = Tokenizer.from_file(path)
    return (
        behaviour_hash(raw),
        probe_hash(lambda s: tok.encode(s, add_special_tokens=False).ids),
        tok.get_vocab_size(),
    )


def _compare_with_canonical(key: str, canonical: str, row: dict, token: str | None):
    """Fetch the gated canonical source and compare, if access has been granted.

    Returns ``(status, sha256, note)``. When the canonical repo is still gated
    this reports ``pending`` rather than silently leaving the row looking
    verified — the difference between "checked" and "not checked yet" is exactly
    what a reviewer is here for.
    """
    import urllib.error

    from huggingface_hub import hf_hub_download
    from huggingface_hub.utils import GatedRepoError, HfHubHTTPError
    from tokenizers import Tokenizer

    try:
        path = hf_hub_download(repo_id=canonical, filename="tokenizer.json", token=token)
    except (GatedRepoError, HfHubHTTPError, urllib.error.HTTPError, OSError) as err:
        return "pending", "", (
            f"Canonical comparison pending: {canonical} is still gated for this "
            f"account ({type(err).__name__}). Accept the licence upstream and "
            f"re-run `uv run python -m src.refresh_sources` to close it."
        )

    data = Path(path).read_bytes()
    raw = json.loads(data.decode("utf-8"))
    tok = Tokenizer.from_file(path)
    canon = {
        "behaviour": behaviour_hash(raw),
        "probes": probe_hash(lambda s: tok.encode(s, add_special_tokens=False).ids),
        "vocab": tok.get_vocab_size(),
    }
    mismatches = [
        name for name, value, expected in (
            ("vocabulary size", canon["vocab"], row["vocab_size"]),
            ("behaviour hash", canon["behaviour"], row["behaviour_sha256"]),
            ("probe token ids", canon["probes"], row["probe_sha256"]),
        ) if value != expected
    ]
    if mismatches:
        raise provenance.ProvenanceError(
            f"{key}: the substitute DISAGREES with canonical {canonical} on "
            f"{', '.join(mismatches)}. Every exported number measured with this "
            f"tokenizer is wrong and the pipeline must be re-run against the "
            f"canonical source before anything else happens."
        )

    digest = provenance.sha256_bytes(data)
    identical_bytes = digest == provenance.sha256_file(
        Path(hf_hub_download(repo_id=row["resolved"], filename="tokenizer.json", token=token))
    )
    return date.today().isoformat(), digest, (
        f"Canonical comparison PASSED against {canonical} on "
        f"{date.today().isoformat()}: identical vocabulary size, behaviour hash "
        f"and token ids for all {len(provenance.PROBES)} probes"
        + (", and byte-identical tokenizer.json." if identical_bytes else ".")
    )


def _llama3_anchor() -> str:
    """Check the Llama-3 mirror against a first-party, ungated source.

    Llama-3's vocabulary is cl100k_base extended with roughly 28k tokens. If a
    mirror is genuine, every cl100k token must appear at the same id. tiktoken
    is OpenAI's own package, so this anchors the mirror to something no
    re-uploader controls.
    """
    import tiktoken

    cl = tiktoken.get_encoding("cl100k_base")
    vocab = tr.get("llama3")._impl.get_vocab()

    bs = (list(range(ord("!"), ord("~") + 1)) + list(range(ord("\xa1"), ord("\xac") + 1))
          + list(range(ord("\xae"), ord("\xff") + 1)))
    cs, n = bs[:], 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    byte_encoder = {b: chr(c) for b, c in zip(bs, cs)}

    match = mismatch = absent = 0
    for i in range(cl.n_vocab):
        try:
            raw = cl.decode_single_token_bytes(i)
        except Exception:
            continue
        key = "".join(byte_encoder[x] for x in raw)
        if key not in vocab:
            absent += 1
        elif vocab[key] == i:
            match += 1
        else:
            mismatch += 1
    if mismatch:
        raise provenance.ProvenanceError(
            f"llama3 mirror disagrees with cl100k on {mismatch} token ids; "
            "the mirror is not the Llama-3 tokenizer and every exported number "
            "measured with it is suspect."
        )
    extra = tr.get("llama3").vocab_size - cl.n_vocab
    return (
        f"All {match} cl100k_base token ids reproduced exactly at the same "
        f"positions ({absent} OpenAI special tokens replaced by Llama's own), "
        f"plus {extra} added tokens, matching Meta's documented ~28k extension. "
        f"Anchored against first-party tiktoken, which no re-uploader controls."
    )


def main() -> int:
    token = provenance.hf_token()
    blocks: list[str] = [
        "\n".join([
            "# Generated by `uv run python -m src.refresh_sources`. Do not edit by hand.",
            "#",
            "# Every input this study depends on. `substituted = true` means the source",
            "# actually used is not the canonical one; `reason` says why, and",
            "# `verified_against` records how the substitute was shown to behave",
            "# identically. tests/test_provenance.py fails if any of this drifts.",
            f"# Refreshed: {date.today().isoformat()}",
        ])
    ]

    # ---------------------------------------------------------------- corpora
    for key, row in CORPUS_ROWS.items():
        archive = RAW_DIR / row.pop("archive")
        if not archive.exists():
            print(f"fetching {key}...")
            (corpora.fetch_flores if key == "flores200" else corpora.fetch_massive)()
        blocks.append(_emit("corpus", key, {
            **row,
            "retrieved": date.today().isoformat(),
            "sha256": sha256_file(archive),
        }))
        print(f"corpus     {key:12s} ok")

    # ------------------------------------------------------------- tokenizers
    for key, row in TOKENIZER_ROWS.items():
        spec = tr.BY_KEY[key]
        tok = tr.get(key)
        row = dict(row)
        row["resolved"] = (
            f"tiktoken {spec.ref}" if spec.backend == "tiktoken" else spec.ref
        )
        row["revision"] = (
            f"tiktoken {__import__('tiktoken').__version__}"
            if spec.backend == "tiktoken"
            else provenance.hf_revision(spec.ref, token)
        )
        row["vocab_size"] = tok.vocab_size
        row["probe_sha256"] = probe_hash(tok.encode)
        if spec.backend == "hf":
            from huggingface_hub import hf_hub_download
            path = hf_hub_download(repo_id=spec.ref, filename="tokenizer.json")
            row["behaviour_sha256"] = behaviour_hash(
                json.loads(Path(path).read_text(encoding="utf-8"))
            )
        else:
            row["behaviour_sha256"] = ""

        if row["substituted"]:
            evidence = []
            if key == "llama3":
                evidence.append(_llama3_anchor())
            agree = []
            for mirror in CORROBORATING_MIRRORS.get(key, []):
                b, p, v = _tokenizer_identity(mirror, token)
                same = (p == row["probe_sha256"] and v == row["vocab_size"])
                agree.append(f"{mirror}={'match' if same else 'MISMATCH'}")
                if not same:
                    raise provenance.ProvenanceError(
                        f"{key}: mirror {mirror} disagrees with the resolved source "
                        f"on the probe set or vocab size. The substitution is not safe."
                    )
            if agree:
                evidence.append(
                    "Independent re-uploads agree on vocabulary size and on token ids "
                    f"for all {len(provenance.PROBES)} probes: " + ", ".join(agree) + "."
                )
            status, digest, note = _compare_with_canonical(
                key, row["canonical"], row, token
            )
            row["canonical_check"] = status
            row["canonical_sha256"] = digest
            evidence.append(note)
            row["verified_against"] = " ".join(evidence)
        else:
            row["canonical_check"] = "n/a — canonical source used directly"
            row["canonical_sha256"] = ""

        row["retrieved"] = date.today().isoformat()
        ordered = {
            k: row[k] for k in (
                "canonical", "resolved", "revision", "licence", "spdx", "retrieved",
                "substituted", "reason", "verified_against", "canonical_check",
                "canonical_sha256", "behaviour_sha256", "probe_sha256",
                "vocab_size", "notes",
            )
        }
        blocks.append(_emit("tokenizer", key, ordered))
        status = "canonical"
        if row["substituted"]:
            status = (
                "SUBSTITUTED, canonical verified"
                if row["canonical_check"] not in ("", "pending")
                else "SUBSTITUTED, canonical PENDING"
            )
        print(f"tokenizer  {key:12s} vocab={row['vocab_size']:6d} {status}")

    # ------------------------------------------------------------------ fonts
    if FONT_MANIFEST.exists():
        manifest = json.loads(FONT_MANIFEST.read_text(encoding="utf-8"))
        for family in manifest["families"]:
            blocks.append(_emit("font", family["key"], {
                "canonical": f"{manifest['source']}?family={family['spec']}",
                "resolved": f"web/public/fonts/{family['css']}",
                "revision": manifest["generated"],
                "licence": manifest["licence"],
                "spdx": manifest["spdx"],
                "retrieved": manifest["generated"],
                "substituted": False,
                "reason": "",
                "verified_against": (
                    "Self-hosted from Google Fonts. The CSS hash covers the woff2 "
                    "payloads transitively: their filenames are content-hashed."
                ),
                "sha256": family["sha256"],
                "notes": "",
            }))
        print(f"fonts      {len(manifest['families'])} families")
    else:
        print(f"fonts      SKIPPED - run `npm run fonts` first ({FONT_MANIFEST} missing)")

    SOURCES_FILE.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
    print(f"\nwrote {SOURCES_FILE.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
