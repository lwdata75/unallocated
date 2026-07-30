# SPDX-License-Identifier: MIT
"""Languages permitted to score below 0.85x fertility, each with a reason.

A genuinely sub-English result is interesting, but it is more often a bug — a
broken alignment, a truncated file, a tokenizer emitting special tokens. So the
gate fails by default and every exception has to be argued for here, in writing,
before the pipeline will export.
"""

SUB_ENGLISH_ALLOWED: dict[tuple[str, str, str], str] = {
    ("massive", "zho_Hans", "bloom"): (
        "Real, not a bug. BLOOM's 250k vocabulary was allocated with Chinese as a "
        "major component of the ROOTS training corpus, so common Chinese words get "
        "whole tokens. Combined with MASSIVE's short imperative utterances, where "
        "Chinese expresses the same command in far fewer characters than English "
        "('stop' vs a single character), the pair ratio drops below 1.0. The same "
        "language on the same tokenizer scores above 1.0 on FLORES prose, which is "
        "consistent with a register effect rather than a measurement error."
    ),
    ("massive", "zho_Hant", "bloom"): (
        "Same cause as zho_Hans on BLOOM: dense short utterances against a "
        "vocabulary with heavy Chinese coverage. Traditional characters tokenise "
        "marginally worse than Simplified, which is why this is the less extreme "
        "of the two."
    ),
}
