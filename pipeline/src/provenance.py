# SPDX-License-Identifier: MIT
"""Machine-recorded provenance for every input the study depends on.

The authority of this study is its provenance, so it is not left to prose. Every
corpus, tokenizer and font family is a row in ``pipeline/sources.toml`` carrying
its canonical source, the source actually resolved, a revision, a hash, a
licence, and — where the two differ — an explicit ``substituted`` flag with a
reason. The pipeline verifies those hashes on every run, a pytest gate fails if
anything drifts, and ``METHODOLOGY.md`` and the site both render from the file
rather than restating it by hand.

**What counts as equivalence for a tokenizer.** Not the sha256 of
``tokenizer.json``. Legitimate mirrors of the same tokenizer differ in that file
— chat templates, added-token metadata and padding config vary between
re-uploads while the tokenizer behaves identically. Hashing the whole file would
flag honest mirrors and tell us nothing about behaviour. So equivalence is
asserted on two things that *are* behaviour:

* ``behaviour_sha256`` — a hash over the ``model`` (vocab and merges),
  ``normalizer``, ``pre_tokenizer`` and ``decoder`` sections only.
* ``probe_sha256`` — a hash over the token ids produced for a fixed probe set
  spanning Latin, CJK, Indic, Arabic, Hebrew, Thai, Ethiopic, Georgian, Greek,
  Cyrillic, emoji, ZWJ sequences, combining marks and whitespace edge cases.

Two sources that agree on both tokenize identically, which is the only property
the measurements actually rest on.
"""

from __future__ import annotations

import hashlib
import json
import os
import tomllib
import urllib.request
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .config import REPO_ROOT

SOURCES_FILE = REPO_ROOT / "pipeline" / "sources.toml"

# Fixed probe set. Deliberately includes the cases where tokenizers diverge:
# combining marks, pre-composed forms, ZWJ emoji, regional indicators, leading
# whitespace and tabs. Changing this list invalidates every recorded
# probe_sha256, so treat it as append-only.
PROBES: tuple[str, ...] = (
    "Hello world",
    "The quick brown fox jumps over the lazy dog.",
    "日本語は膠着語であり、語順は主語・目的語・動詞である。",
    "中文简体测试文本",
    "繁體中文測試文本",
    "한국어 테스트 문장입니다",
    "తెలుగు భాష ద్రావిడ కుటుంబానికి చెందినది.",
    "हिन्दी भाषा का परीक्षण",
    "বাংলা ভাষার পরীক্ষা",
    "தமிழ் மொழி சோதனை",
    "ಕನ್ನಡ ಪರೀಕ್ಷೆ",
    "മലയാളം പരീക്ഷണം",
    "اللغة العربية اختبار",
    "עברית בדיקה",
    "ภาษาไทยทดสอบ",
    "မြန်မာဘာသာစကား",
    "የአማርኛ ቋንቋ ሙከራ",
    "ქართული ენის ტესტი",
    "Ελληνικά δοκιμή",
    "Русский язык тест",
    "🙂🚀🎉",
    "👨‍👩‍👧‍👦",          # ZWJ sequence
    "🇫🇷🇯🇵🇮🇳",              # regional indicators
    "café naïve résumé",
    "café combining acute",   # decomposed, catches NFC normalizers
    "বাংলা য় pre-composed U+09DF",  # catches NFC normalizers
    "  leading spaces",
    "tab\there\tand\tmore",
    "line\nbreak\r\ncrlf",
    "def f(x):\n    return x ** 2",
    "1234567890 3.14159 1e-9",
    "ÅÄÖ åäö ﬁ ﬂ",
)


class ProvenanceError(RuntimeError):
    """Raised when a recorded source no longer matches what was fetched."""


@dataclass(frozen=True)
class Source:
    key: str
    kind: str                    # corpus | tokenizer | font
    canonical: str
    resolved: str
    revision: str
    licence: str
    spdx: str
    retrieved: str
    substituted: bool
    reason: str
    sha256: str = ""             # corpora and fonts: bytes of the artefact
    behaviour_sha256: str = ""   # tokenizers
    probe_sha256: str = ""       # tokenizers
    vocab_size: int = 0
    verified_against: str = ""   # how the substitution was checked
    notes: str = ""
    # Set once the canonical source has actually been fetched and compared.
    # "pending" means the canonical repo is still gated and the row rests on
    # corroboration rather than a direct comparison.
    canonical_check: str = ""
    canonical_sha256: str = ""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def behaviour_hash(tokenizer_json: dict) -> str:
    """Hash the parts of a tokenizer definition that determine its output.

    Excludes ``added_tokens``, chat templates and other metadata, which vary
    between legitimate mirrors of the same tokenizer.
    """
    payload = {
        section: tokenizer_json.get(section)
        for section in ("model", "normalizer", "pre_tokenizer", "decoder")
    }
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return sha256_bytes(canonical.encode("utf-8"))


def probe_hash(encode: "callable[[str], list[int]]") -> str:
    """Hash the token ids produced for the fixed probe set."""
    ids = [encode(text) for text in PROBES]
    canonical = json.dumps(ids, separators=(",", ":"))
    return sha256_bytes(canonical.encode("utf-8"))


def hf_revision(repo: str, token: str | None = None) -> str:
    """Current commit sha of a HuggingFace repo, so a row pins a point in time."""
    req = urllib.request.Request(f"https://huggingface.co/api/models/{repo}")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp).get("sha", "")


def hf_token() -> str | None:
    env = os.environ.get("HF_TOKEN")
    if env:
        return env
    path = Path.home() / ".cache" / "huggingface" / "token"
    return path.read_text().strip() if path.exists() else None


def load() -> dict[str, Source]:
    if not SOURCES_FILE.exists():
        raise ProvenanceError(
            f"{SOURCES_FILE} is missing. Run `uv run python -m src.refresh_sources`."
        )
    raw = tomllib.loads(SOURCES_FILE.read_text(encoding="utf-8"))
    out: dict[str, Source] = {}
    for kind, rows in raw.items():
        if not isinstance(rows, dict):
            continue
        for key, row in rows.items():
            out[f"{kind}.{key}"] = Source(key=key, kind=kind, **row)
    return out


def substitutions() -> list[Source]:
    return [s for s in load().values() if s.substituted]


def as_json() -> dict:
    """The payload exported to web/public/data/sources.json."""
    rows = load()
    return {
        "generated": date.today().isoformat(),
        "note": (
            "Every input this study depends on, with the source actually used. "
            "Where that differs from the canonical source the row says so and "
            "records how the substitute was verified to behave identically."
        ),
        "sources": [
            {
                "key": s.key,
                "kind": s.kind,
                "canonical": s.canonical,
                "resolved": s.resolved,
                "revision": s.revision,
                "licence": s.licence,
                "spdx": s.spdx,
                "retrieved": s.retrieved,
                "substituted": s.substituted,
                "reason": s.reason,
                "verified_against": s.verified_against,
                "sha256": s.sha256,
                "behaviour_sha256": s.behaviour_sha256,
                "probe_sha256": s.probe_sha256,
                "vocab_size": s.vocab_size,
                "notes": s.notes,
                "canonical_check": s.canonical_check,
                "canonical_sha256": s.canonical_sha256,
            }
            for s in sorted(rows.values(), key=lambda r: (r.kind, r.key))
        ],
    }


def _short_revision(revision: str) -> str:
    """Abbreviate a commit sha; leave a human-readable version string alone."""
    if len(revision) == 40 and all(c in "0123456789abcdef" for c in revision):
        return revision[:12]
    return revision or "—"


def markdown_table() -> str:
    """Rendered into METHODOLOGY.md so the prose cannot drift from the data.

    Corpora and tokenizers get a row each. The font families are summarised on
    one line: there are thirty of them, they share a source and a licence, and
    listing each would bury the two rows a reader is actually here to check.
    Full detail for every one is in sources.toml and sources.json.
    """
    rows = sorted(load().values(), key=lambda r: (r.kind, r.key))
    lines = [
        "| Key | Kind | Source used | Revision | Licence | Canonical? |",
        "|---|---|---|---|---|---|",
    ]
    for s in rows:
        if s.kind == "font":
            continue
        flag = "yes" if not s.substituted else "**substituted**"
        lines.append(
            f"| `{s.key}` | {s.kind} | `{s.resolved}` | `{_short_revision(s.revision)}` "
            f"| {s.licence} | {flag} |"
        )

    fonts = [s for s in rows if s.kind == "font"]
    if fonts:
        licences = {s.licence for s in fonts}
        lines.append(
            f"| _{len(fonts)} font families_ | font | Google Fonts, self-hosted | "
            f"`{fonts[0].retrieved}` | {', '.join(sorted(licences))} | yes |"
        )
    return "\n".join(lines)
