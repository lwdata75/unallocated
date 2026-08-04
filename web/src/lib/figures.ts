// SPDX-License-Identifier: MIT
/**
 * Rendering a generated figure into prose, with its referent attached.
 *
 * Shared because the claim section and the methodology section both quote the
 * same pipeline figures, and a figure that rendered differently in two places
 * would defeat the point of generating them in the first place.
 */

import type { Dataset } from "./data";

type Figures = Dataset["headline"]["figures"];

/**
 * One figure, marked up so a reader can check what it refers to.
 *
 * `tabindex="0"` because the referent lives in a `title`, and a title on a
 * non-interactive element is unreachable without a pointer. A missing figure is
 * rendered loudly rather than silently omitted: a blank where a number should be
 * reads as prose, and would let a stale deploy quietly drop a claim's evidence.
 */
export function figureSpan(figures: Figures, key: string): string {
  const f = figures[key];
  if (!f) return `<span class="fig fig-missing">[missing figure: ${key}]</span>`;
  const ref = Object.entries(f.referent)
    .filter(([k]) => k !== "examples")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join(" · ");
  return `<span class="fig tabular" tabindex="0" title="${f.statistic} — ${ref}">${f.text}</span>`;
}

/** True when the pipeline's generated figures did not load at all. */
export function figuresMissing(figures: Figures): boolean {
  return Object.keys(figures).length === 0;
}
