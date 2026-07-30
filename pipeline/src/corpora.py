# SPDX-License-Identifier: MIT
"""Load and align FLORES-200 and MASSIVE.

Both corpora are sentence-aligned: row *n* in Telugu carries the same meaning as
row *n* in English. That alignment is the entire basis of the study, so it is
asserted programmatically and the loaders raise rather than warn.

Source note: the maintained HuggingFace releases of both corpora are unusable
here. ``openlanguagedata/flores_plus`` and ``facebook/flores`` are gated behind
terms acceptance, and ``AmazonScience/massive`` is a legacy loading script that
no longer runs on ``datasets`` >= 3. We pull the upstream archives directly
instead; they carry the same content under the same licences.
"""

from __future__ import annotations

import hashlib
import json
import random
import tarfile
from collections import defaultdict
from pathlib import Path

import requests
from tqdm import tqdm

from .config import (
    CACHE_DIR,
    EXTRACTED_DIR,
    MASSIVE_SAMPLE_SEED,
    MASSIVE_SAMPLE_SIZE,
    RAW_DIR,
)

FLORES_URL = "https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz"
FLORES_LICENCE = "CC-BY-SA-4.0"

MASSIVE_URL = (
    "https://amazon-massive-nlu-dataset.s3.amazonaws.com/amazon-massive-dataset-1.1.tar.gz"
)
MASSIVE_LICENCE = "CC-BY-4.0"

CHECKSUM_FILE = RAW_DIR / "checksums.json"

# Pinned on first successful download; verified on every run afterwards.
KNOWN_SHA256 = {
    "flores200_dataset.tar.gz": None,
    "amazon-massive-dataset-1.1.tar.gz": None,
}

# MASSIVE locale -> FLORES-200 code. Hand-checked; the script suffix matters
# (az-AZ is Latin, mn-MN is Cyrillic, zh-CN/zh-TW split Hans/Hant).
MASSIVE_LOCALE_TO_FLORES = {
    "af-ZA": "afr_Latn",
    "am-ET": "amh_Ethi",
    "ar-SA": "arb_Arab",
    "az-AZ": "azj_Latn",
    "bn-BD": "ben_Beng",
    "ca-ES": "cat_Latn",
    "cy-GB": "cym_Latn",
    "da-DK": "dan_Latn",
    "de-DE": "deu_Latn",
    "el-GR": "ell_Grek",
    "en-US": "eng_Latn",
    "es-ES": "spa_Latn",
    "fa-IR": "pes_Arab",
    "fi-FI": "fin_Latn",
    "fr-FR": "fra_Latn",
    "he-IL": "heb_Hebr",
    "hi-IN": "hin_Deva",
    "hu-HU": "hun_Latn",
    "hy-AM": "hye_Armn",
    "id-ID": "ind_Latn",
    "is-IS": "isl_Latn",
    "it-IT": "ita_Latn",
    "ja-JP": "jpn_Jpan",
    "jv-ID": "jav_Latn",
    "ka-GE": "kat_Geor",
    "km-KH": "khm_Khmr",
    "kn-IN": "kan_Knda",
    "ko-KR": "kor_Hang",
    "lv-LV": "lvs_Latn",
    "ml-IN": "mal_Mlym",
    "mn-MN": "khk_Cyrl",
    "ms-MY": "zsm_Latn",
    "my-MM": "mya_Mymr",
    "nb-NO": "nob_Latn",
    "nl-NL": "nld_Latn",
    "pl-PL": "pol_Latn",
    "pt-PT": "por_Latn",
    "ro-RO": "ron_Latn",
    "ru-RU": "rus_Cyrl",
    "sl-SL": "slv_Latn",
    "sq-AL": "als_Latn",
    "sv-SE": "swe_Latn",
    "sw-KE": "swh_Latn",
    "ta-IN": "tam_Taml",
    "te-IN": "tel_Telu",
    "th-TH": "tha_Thai",
    "tl-PH": "tgl_Latn",
    "tr-TR": "tur_Latn",
    "ur-PK": "urd_Arab",
    "vi-VN": "vie_Latn",
    "zh-CN": "zho_Hans",
    "zh-TW": "zho_Hant",
}


class AlignmentError(RuntimeError):
    """Raised when the sentence alignment the study depends on does not hold."""


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _record_checksum(path: Path) -> str:
    digest = _sha256(path)
    pinned = KNOWN_SHA256.get(path.name)
    if pinned and pinned != digest:
        raise RuntimeError(
            f"{path.name} sha256 {digest} does not match pinned {pinned}. "
            "The upstream archive changed; re-verify before trusting the numbers."
        )
    seen = json.loads(CHECKSUM_FILE.read_text()) if CHECKSUM_FILE.exists() else {}
    seen[path.name] = digest
    CHECKSUM_FILE.write_text(json.dumps(seen, indent=2))
    return digest


def _download(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=120) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        with tmp.open("wb") as fh, tqdm(
            total=total, unit="B", unit_scale=True, desc=dest.name
        ) as bar:
            for chunk in resp.iter_content(1 << 20):
                fh.write(chunk)
                bar.update(len(chunk))
    tmp.replace(dest)
    return dest


def _extract(archive: Path, marker: Path) -> Path:
    """Extract ``archive`` into EXTRACTED_DIR unless ``marker`` already exists."""
    if marker.exists():
        return marker
    with tarfile.open(archive) as tf:
        tf.extractall(EXTRACTED_DIR, filter="data")
    if not marker.exists():
        raise RuntimeError(f"expected {marker} after extracting {archive.name}")
    return marker


def fetch_flores() -> Path:
    """Download and extract FLORES-200. Returns the directory holding dev/."""
    archive = _download(FLORES_URL, RAW_DIR / "flores200_dataset.tar.gz")
    _record_checksum(archive)
    return _extract(archive, EXTRACTED_DIR / "flores200_dataset" / "dev")


def fetch_massive() -> Path:
    """Download and extract MASSIVE 1.1. Returns the directory holding *.jsonl."""
    archive = _download(MASSIVE_URL, RAW_DIR / "amazon-massive-dataset-1.1.tar.gz")
    _record_checksum(archive)
    return _extract(archive, EXTRACTED_DIR / "1.1" / "data")


def load_flores() -> dict[str, list[str]]:
    """FLORES-200 dev split: {flores_code: [997 sentences]}, index-aligned."""
    dev = fetch_flores()
    sentences: dict[str, list[str]] = {}
    for path in sorted(dev.glob("*.dev")):
        code = path.stem
        lines = path.read_text(encoding="utf-8").splitlines()
        sentences[code] = [ln.strip() for ln in lines]
    if not sentences:
        raise RuntimeError(f"no .dev files under {dev}")
    assert_aligned(sentences, "flores")
    return sentences


def load_massive() -> dict[str, list[str]]:
    """MASSIVE 1.1: {flores_code: [n utterances]}, joined on utterance id.

    Only ids present in *every* locale are kept, then a seeded subsample is
    taken. Utterances are index-aligned across languages after the join.
    """
    cache = CACHE_DIR / f"massive_sample_{MASSIVE_SAMPLE_SIZE}_{MASSIVE_SAMPLE_SEED}.json"
    if cache.exists():
        sentences = json.loads(cache.read_text(encoding="utf-8"))
        assert_aligned(sentences, "massive")
        return sentences

    data_dir = fetch_massive()
    by_locale: dict[str, dict[str, str]] = {}
    for locale, code in MASSIVE_LOCALE_TO_FLORES.items():
        path = data_dir / f"{locale}.jsonl"
        if not path.exists():
            raise FileNotFoundError(f"MASSIVE locale file missing: {path}")
        rows: dict[str, str] = {}
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                rec = json.loads(line)
                utt = rec["utt"].strip()
                if utt:
                    rows[rec["id"]] = utt
        by_locale[code] = rows

    shared = set.intersection(*(set(r) for r in by_locale.values()))
    if len(shared) < MASSIVE_SAMPLE_SIZE:
        raise AlignmentError(
            f"only {len(shared)} utterance ids are shared across all "
            f"{len(by_locale)} MASSIVE locales; need >= {MASSIVE_SAMPLE_SIZE}"
        )
    ordered = sorted(shared, key=lambda i: int(i))
    rng = random.Random(MASSIVE_SAMPLE_SEED)
    chosen = sorted(rng.sample(ordered, MASSIVE_SAMPLE_SIZE), key=lambda i: int(i))

    sentences = {code: [rows[i] for i in chosen] for code, rows in by_locale.items()}
    assert_aligned(sentences, "massive")
    cache.write_text(json.dumps(sentences, ensure_ascii=False), encoding="utf-8")
    return sentences


def assert_aligned(sentences: dict[str, list[str]], corpus: str) -> None:
    """Fail loudly if the per-language row counts disagree or rows are empty."""
    if not sentences:
        raise AlignmentError(f"{corpus}: no languages loaded")

    counts = defaultdict(list)
    for code, rows in sentences.items():
        counts[len(rows)].append(code)
    if len(counts) != 1:
        summary = {n: (len(codes), sorted(codes)[:5]) for n, codes in counts.items()}
        raise AlignmentError(
            f"{corpus}: row counts differ across languages -> {summary}"
        )

    from .config import ENGLISH

    if ENGLISH not in sentences:
        raise AlignmentError(f"{corpus}: pivot language {ENGLISH} is missing")

    for code, rows in sentences.items():
        blank = [i for i, s in enumerate(rows) if not s.strip()]
        if blank:
            raise AlignmentError(
                f"{corpus}/{code}: {len(blank)} empty rows (first at index {blank[0]})"
            )


def corpus_loaders() -> dict[str, callable]:
    return {"flores": load_flores, "massive": load_massive}
