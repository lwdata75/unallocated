# SPDX-License-Identifier: MIT
"""Per-language metadata: script, family, macro-region, speaker count.

Sources, chosen for licence safety and citability:

* **Script** — the ISO 15924 suffix carried by the FLORES code itself
  (``tel_Telu`` -> Telugu). No external lookup, no ambiguity.
* **Family and macro-region** — Glottolog CLDF ``languages.csv`` (CC-BY-4.0),
  joined on ISO 639-3. Glottolog macroareas are coarse (Eurasia rather than
  South Asia); that coarseness is documented rather than papered over.
* **Speaker counts** — Wikidata P1098 via SPARQL, joined on ISO 639-3 (P220).
  Ethnologue's figures are more complete but licence-restricted, so they are
  deliberately not used. Speaker counts are contested regardless; the site says
  so in the methodology section.

Both remote sources are cached to ``data/cache/`` on first run.
"""

from __future__ import annotations

import csv
import io
import json
from functools import lru_cache

import requests

from .config import CACHE_DIR

GLOTTOLOG_URL = (
    "https://raw.githubusercontent.com/glottolog/glottolog-cldf/master/cldf/languages.csv"
)
GLOTTOLOG_LICENCE = "CC-BY-4.0"

WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"
WIKIDATA_LICENCE = "CC0-1.0"
USER_AGENT = "unallocated/1.0 (https://github.com/lwdata75/unallocated)"

SPEAKERS_QUERY = """
SELECT ?iso (MAX(?count) AS ?speakers) WHERE {
  ?lang wdt:P220 ?iso ;
        wdt:P1098 ?count .
}
GROUP BY ?iso
"""

# ISO 15924 code -> human-readable script name, restricted to what FLORES uses.
SCRIPT_NAMES = {
    "Adlm": "Adlam", "Arab": "Arabic", "Armn": "Armenian", "Beng": "Bengali",
    "Cans": "Canadian Aboriginal Syllabics", "Cyrl": "Cyrillic", "Deva": "Devanagari",
    "Ethi": "Ethiopic", "Geor": "Georgian", "Grek": "Greek", "Gujr": "Gujarati",
    "Guru": "Gurmukhi", "Hang": "Hangul", "Hans": "Han (Simplified)",
    "Hant": "Han (Traditional)", "Hebr": "Hebrew", "Jpan": "Japanese",
    "Khmr": "Khmer", "Knda": "Kannada", "Laoo": "Lao", "Latn": "Latin",
    "Mlym": "Malayalam", "Mymr": "Myanmar", "Olck": "Ol Chiki", "Orya": "Odia",
    "Sinh": "Sinhala", "Taml": "Tamil", "Telu": "Telugu", "Tfng": "Tifinagh",
    "Thai": "Thai", "Tibt": "Tibetan",
}

# Glottolog has no ISO 639-3 row for a handful of FLORES codes, and Wikidata has
# no P1098 for some. Filled from the languages' own Wikipedia infoboxes; every
# entry here is an editorial choice and is listed in METHODOLOGY.md.
OVERRIDES: dict[str, dict] = {
    "arb_Arab": {"name": "Modern Standard Arabic", "family": "Afro-Asiatic", "region": "Eurasia", "speakers": 274_000_000},
    "zho_Hans": {"name": "Chinese (Simplified)", "family": "Sino-Tibetan", "region": "Eurasia", "speakers": 941_000_000},
    "zho_Hant": {"name": "Chinese (Traditional)", "family": "Sino-Tibetan", "region": "Eurasia", "speakers": 941_000_000},
    "eng_Latn": {"name": "English", "family": "Indo-European", "region": "Eurasia", "speakers": 390_000_000},
    "pes_Arab": {"name": "Western Persian", "family": "Indo-European", "region": "Eurasia", "speakers": 57_000_000},
    "khk_Cyrl": {"name": "Halh Mongolian", "family": "Mongolic-Khitan", "region": "Eurasia", "speakers": 2_800_000},
    "zsm_Latn": {"name": "Standard Malay", "family": "Austronesian", "region": "Papunesia", "speakers": 33_000_000},
    "als_Latn": {"name": "Tosk Albanian", "family": "Indo-European", "region": "Eurasia", "speakers": 1_800_000},
    "swh_Latn": {"name": "Swahili", "family": "Atlantic-Congo", "region": "Africa", "speakers": 18_000_000},
    "lvs_Latn": {"name": "Standard Latvian", "family": "Indo-European", "region": "Eurasia", "speakers": 1_500_000},
    "azj_Latn": {"name": "North Azerbaijani", "family": "Turkic", "region": "Eurasia", "speakers": 9_200_000},
    # Glottolog indexes these below language level (dialects of a macrolanguage),
    # so the ISO-639-3 join finds nothing. Filled by hand.
    "ajp_Arab": {"name": "South Levantine Arabic", "family": "Afro-Asiatic", "region": "Eurasia", "speakers": 11_000_000},
    "ars_Arab": {"name": "Najdi Arabic", "family": "Afro-Asiatic", "region": "Eurasia", "speakers": 10_000_000},
    "bos_Latn": {"name": "Bosnian", "family": "Indo-European", "region": "Eurasia", "speakers": 2_700_000},
    "hrv_Latn": {"name": "Croatian", "family": "Indo-European", "region": "Eurasia", "speakers": 5_600_000},
    "srp_Cyrl": {"name": "Serbian", "family": "Indo-European", "region": "Eurasia", "speakers": 9_000_000},
    "est_Latn": {"name": "Estonian", "family": "Uralic", "region": "Eurasia", "speakers": 1_100_000},
    "eus_Latn": {"name": "Basque", "family": "Isolate", "region": "Eurasia", "speakers": 750_000},
    "grn_Latn": {"name": "Guarani", "family": "Tupian", "region": "South America", "speakers": 6_500_000},
    "kon_Latn": {"name": "Kikongo", "family": "Atlantic-Congo", "region": "Africa", "speakers": 5_000_000},
    "ltg_Latn": {"name": "Latgalian", "family": "Indo-European", "region": "Eurasia", "speakers": 150_000},
    "nno_Latn": {"name": "Norwegian Nynorsk", "family": "Indo-European", "region": "Eurasia", "speakers": 5_300_000},
    "nob_Latn": {"name": "Norwegian Bokmål", "family": "Indo-European", "region": "Eurasia", "speakers": 5_300_000},
    "srd_Latn": {"name": "Sardinian", "family": "Indo-European", "region": "Eurasia", "speakers": 1_000_000},
    "twi_Latn": {"name": "Twi", "family": "Atlantic-Congo", "region": "Africa", "speakers": 9_000_000},
    "ayr_Latn": {"name": "Central Aymara", "family": "Aymaran", "region": "South America", "speakers": 1_700_000},
    "cjk_Latn": {"name": "Chokwe", "family": "Atlantic-Congo", "region": "Africa", "speakers": 1_000_000},
    "kmb_Latn": {"name": "Kimbundu", "family": "Atlantic-Congo", "region": "Africa", "speakers": 2_000_000},
}

# FLORES codes whose ISO 639-3 part differs from the macrolanguage Wikidata and
# Glottolog index under.
ISO_ALIASES = {
    "arb": "ara", "pes": "fas", "khk": "mon", "zsm": "msa", "als": "sqi",
    "swh": "swa", "lvs": "lav", "azj": "aze", "zho": "zho", "npi": "nep",
    "ory": "ori", "gaz": "orm", "uzn": "uzb", "ydd": "yid", "plt": "mlg",
    "pbt": "pus", "lvs": "lav", "kmr": "kur", "ckb": "kur", "quy": "que",
    "dik": "din", "knc": "kau", "fuv": "ful", "gle": "gle",
}


def _cached_json(name: str, fetch) -> dict:
    path = CACHE_DIR / name
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    data = fetch()
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


@lru_cache(maxsize=1)
def _glottolog() -> dict[str, dict[str, str]]:
    """{iso639_3: {name, family, macroarea}} from Glottolog CLDF."""

    def fetch() -> dict:
        resp = requests.get(GLOTTOLOG_URL, timeout=120, headers={"User-Agent": USER_AGENT})
        resp.raise_for_status()
        rows = list(csv.DictReader(io.StringIO(resp.text)))
        family_names = {r["ID"]: r["Name"] for r in rows if r["Level"] == "family"}
        out: dict[str, dict] = {}
        for r in rows:
            iso = r["ISO639P3code"]
            if not iso or r["Level"] != "language":
                continue
            fam_id = r["Family_ID"]
            out[iso] = {
                "name": r["Name"],
                "family": family_names.get(fam_id) or ("Isolate" if r["Is_Isolate"] == "True" else ""),
                "macroarea": r["Macroarea"],
            }
        return out

    return _cached_json("glottolog_languages.json", fetch)


@lru_cache(maxsize=1)
def _speakers() -> dict[str, int]:
    """{iso639_3: speaker count} from Wikidata P1098."""

    def fetch() -> dict:
        resp = requests.get(
            WIKIDATA_ENDPOINT,
            params={"query": SPEAKERS_QUERY, "format": "json"},
            headers={"Accept": "application/sparql-results+json", "User-Agent": USER_AGENT},
            timeout=180,
        )
        resp.raise_for_status()
        out: dict[str, int] = {}
        for b in resp.json()["results"]["bindings"]:
            iso = b["iso"]["value"]
            try:
                n = int(float(b["speakers"]["value"]))
            except (ValueError, KeyError):
                continue
            if n > 0:
                out[iso] = n
        return out

    return _cached_json("wikidata_speakers.json", fetch)


def describe(code: str) -> dict:
    """Full metadata record for one FLORES code."""
    iso, _, script = code.partition("_")
    glotto = _glottolog()
    speakers_by_iso = _speakers()

    entry = glotto.get(iso) or glotto.get(ISO_ALIASES.get(iso, ""), {})
    speakers = speakers_by_iso.get(iso) or speakers_by_iso.get(ISO_ALIASES.get(iso, ""), 0)

    record = {
        "code": code,
        "name": entry.get("name") or iso,
        "script": SCRIPT_NAMES.get(script, script),
        "family": entry.get("family") or "Unclassified",
        "region": entry.get("macroarea") or "Unknown",
        "speakers": int(speakers),
    }
    record.update(OVERRIDES.get(code, {}))
    return record


def coverage_report(codes: list[str]) -> dict[str, list[str]]:
    """Which codes are missing which fields. Used by the export step to keep the
    gaps visible instead of silently shipping zeros."""
    gaps: dict[str, list[str]] = {"speakers": [], "family": [], "region": []}
    for code in codes:
        rec = describe(code)
        if not rec["speakers"]:
            gaps["speakers"].append(code)
        if rec["family"] == "Unclassified":
            gaps["family"].append(code)
        if rec["region"] == "Unknown":
            gaps["region"].append(code)
    return gaps
