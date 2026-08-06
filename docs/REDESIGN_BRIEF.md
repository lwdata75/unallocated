# Unallocated — visual & narrative redesign brief

Drop this at `docs/REDESIGN_BRIEF.md` and start Claude Code with:

> Read `docs/REDESIGN_BRIEF.md`, `README.md` and `METHODOLOGY.md`. Then do Phase 0 only:
> come back with the design plan and stop. Do not touch any file yet.

---

## 1. What is not changing

Non-negotiable. Violating any of these is a failed change, not a trade-off.

- **No number is ever typed by hand.** Every figure in the DOM continues to come from
  `web/public/data/*.json` and is substituted mechanically. The drift gate stays.
- **The pipeline is untouched.** `pipeline/` is out of scope. This is a `web/` change only.
- **`npm run verify` must pass**, including: all 25 showcase scripts rendering from
  self-hosted faces (no system fallback), tokenizer switch re-tiles, share card exactly
  1200×630, no horizontal overflow at 380px, every contrast pair over threshold.
- **Lighthouse floors:** performance ≥ 93, accessibility 100, best practices 100.
  Accessibility 100 is a floor, not a target — keyboard focus stays visible, motion
  respects `prefers-reduced-motion`, colour is never the only carrier of meaning.
- **Stack stays.** Vite + TypeScript, vanilla DOM, D3 for scales and the scatter.
  No React, no UI library, no animation library heavier than ~5 KB gzipped.
  Argue for any new dependency before adding it.
- **The "What this does not claim" section stays**, and stays legible. It is the
  credibility of the whole study. It does not get shrunk into a footnote or a modal.

## 2. The problem with the current design

The page presents a measurement. It should present an *argument*, and the argument
should be visible before it is read. Right now the reader meets navigation, an abstract
section list ("See it / What it costs / The claim"), and only then the object.

The tiles are the argument. Lead with them.

## 3. Narrative arc to build toward

Replace the current section list with this sequence. Section labels should name the
content, not the rhetorical move ("The claim" tells the reader nothing).

1. **Cold open — the specimen.** One FLORES-200 sentence, rendered as physical token
   tiles, in English plus four other languages, with the parity line at the English
   column's height. Title and subtitle sit *under* or *beside* it, not above. The
   reader should understand the finding before reading a word of prose.
2. **It is not the writing system.** Telugu across gpt2 / cl100k / o200k / bloom —
   325 → 208 → 48 → 34 for identical text. Same script, four columns, one variable.
3. **Floor and surcharge.** The decomposition: what the script inherently needs versus
   what nobody spent vocabulary on. This is the emotional centre of the page.
4. **Who the vocabulary went to.** BLOOM beats o200k on 93 of 204 languages and loses
   on the rest; ROOTS covered ~46 languages and that boundary is legible in the data.
   The point: nobody bought "multilingual", they bought a list.
5. **All 204, against speakers.** The scatter. Keep it, it earns its space.
6. **The negative space is falsifiable.** Llama-3 adds ~28,000 tokens over cl100k and
   17 languages come out identical to the last decimal. State the falsification test.
7. **What this does not claim.** Verbatim in substance. Do not soften it.
8. **Method, provenance, licence.**

Copy rules: plain verbs, sentence case, no filler, no rhetorical questions, no
exclamation. Specific beats clever. The subject is serious; the voice is calm and
exact, never indignant on the reader's behalf.

## 4. Signature element — spend the boldness here

The site is called *Unallocated*. Make negative space the visual motif, literally:

**Render the floor tokens as solid tiles and the surcharge tokens as hollow ones** —
hairline outline, no fill, the same footprint. The unallocated vocabulary becomes a
visible absence in the tile grid rather than a number in a caption. On GPT-2, 63% of
Telugu tokens contain no character at all; those specifically should read as empty.

Everything else on the page stays quiet so this lands. If a decoration does not serve
this idea, cut it.

## 5. Typography

Two tiers, and they must not be confused:

- **Specimen tier (locked).** The multilingual sample text keeps full Noto coverage for
  all 25 showcase scripts, self-hosted, unchanged. Do not swap this for aesthetics —
  `npm run verify` fails on system fallback, and correctly so.
- **Chrome tier (open).** Display, body and data/caption faces for the Latin UI. Latin
  subset only, woff2, ideally under ~40 KB total added.

Do not pick one and build. **Propose three pairings**, each with a one-line rationale
tied to *this* subject, and show a rendered specimen of each before committing. Criteria:
tabular figures are mandatory for the data tier; the display face needs presence at
large sizes without novelty; avoid the obvious geometric-sans default and avoid the
high-contrast-serif-on-cream look, which is a current AI-design cliché.

Set an explicit type scale with intentional weights and tracking. The type treatment
should be memorable, not a neutral delivery vehicle.

## 6. Colour

- Define tokens in **OKLCH**, light and dark, both first-class (the page already
  declares `color-scheme: light dark`).
- **4–6 named values**, no more: surface, raised surface, text, muted text, one accent,
  one hairline. Name them semantically, never by hue.
- **The fertility ramp is a separate decision from the brand accent.** It must be
  perceptually uniform, colourblind-safe, and must not moralise — no red-is-bad /
  green-is-good. Higher cost should read as heavier or denser, not as "wrong".
- Every pair goes through the existing contrast gate. Muted text is the usual casualty
  of a "soft" palette; check it explicitly.

## 7. Materials — the glass, done responsibly

Wanted, but rationed. Glass belongs on **chrome only**, never behind data:

- Allowed: the sticky header, the tokenizer switcher, tooltips, the section rail.
- Forbidden: anything layered over the tile grid or the 204-point scatter.
  `backdrop-filter: blur()` over a live SVG is the fastest way to lose the 93.

Execution notes: pair `blur()` with a small `saturate()`; add a 1px inner hairline at
low alpha on the top edge; use two stacked shadows (one tight and dark, one wide and
soft) rather than one large one; keep radii on a consistent scale. Provide a non-blur
fallback via `@supports` and verify contrast *with* the blur active.

## 8. Motion

One orchestrated sequence beats scattered effects. Scattered micro-animations are the
strongest tell that a page was generated rather than designed.

- **Page load:** a single staged reveal where the specimen tiles tile in, in reading
  order. Once, on first paint, under 900 ms total.
- **Scroll:** the floor/surcharge decomposition is scroll-linked — the hollow tiles
  separate from the solid ones as the section enters. This is the one moment that
  earns real motion.
- **Pointer:** tile-level hover that surfaces the token string and its index, and a
  tooltip that tracks with slight lag. **No cursor-following blob, no parallax, no
  spotlight gradient.**
- Easing: spring-like, short durations, nothing over 400 ms except the load sequence.
- `prefers-reduced-motion: reduce` disables all of it and jumps to end state. Test it.

## 9. Process — do not one-shot this

**Phase 0 — plan, then stop.** A compact token system (palette as 4–6 named hexes,
three type pairings, layout concept as ASCII wireframes, the signature element).
Then critique your own plan: for each choice, ask whether you would have produced it
for any generic data-viz page. Revise what you would have, and say what changed and why.
Wait for approval.

**Phase 1 — tokens + one vertical slice.** CSS custom properties, then the cold-open
specimen section fully built at desktop and 380px. Screenshot both, in light and dark.
Wait for approval before touching other sections.

**Phase 2 — roll out** section by section, screenshotting as you go.

**Phase 3 — gates.** `npm run build && npm run preview`, then `npm run verify` and
`npm run lighthouse`. Paste the actual numbers. If any gate fails, fix it rather than
adjusting the gate. Update the "Last measured" line in `README.md` from the real output.

Watch CSS specificity between section-level and element-level selectors — cancelled-out
padding rules between sections are the usual failure mode in a refactor this size.
