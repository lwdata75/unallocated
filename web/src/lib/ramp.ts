// SPDX-License-Identifier: MIT
/**
 * The one data ramp. Diverging, anchored at 1.0x so "at parity" reads as
 * visually neutral rather than as the good end of a good-to-bad scale.
 *
 * Colours live in CSS custom properties so the dark variant is defined in one
 * place; this module reads them back and rebuilds when the theme changes.
 */

import { scaleLinear } from "d3-scale";
import { interpolateLab } from "d3-interpolate";

const STOPS = [1.0, 1.4, 2.0, 3.0, 5.0, 8.0];
const VARS = ["--ramp-1_0", "--ramp-1_4", "--ramp-2_0", "--ramp-3_0", "--ramp-5_0", "--ramp-8_0"];

let scale = build();

function build() {
  const styles = getComputedStyle(document.documentElement);
  const colours = VARS.map((v) => styles.getPropertyValue(v).trim() || "#888888");
  return scaleLinear<string>()
    .domain(STOPS)
    .range(colours)
    .interpolate(interpolateLab)
    .clamp(true);
}

/** Call after the theme changes so the ramp picks up the lightened variant. */
export function refreshRamp(): void {
  scale = build();
}

export function fertilityColour(fertility: number): string {
  return scale(fertility);
}

/** Legend stops, for the scatter's axis key and the methodology section. */
export function rampStops(): Array<{ value: number; colour: string }> {
  return STOPS.map((value) => ({ value, colour: scale(value) }));
}

// Badges and legends carry the ramp as a swatch beside neutral-on-neutral text,
// because no *single* ink colour clears 4.5:1 against the whole ramp — the
// mid-tones are too light for white and the ends too dark for black.
//
// The heatmap is the one place that has to set text on a ramp colour, and it can
// only do that by choosing the ink per cell. That is what follows.

/** sRGB relative luminance, per WCAG 2.1. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseColour(colour: string): [number, number, number] {
  const parts = colour.match(/[\d.]+/g);
  if (!parts) return [128, 128, 128];
  // d3 hands back `rgb(r, g, b)` in 0–255, but a colour that has been through
  // color-mix comes back as `color(srgb …)` in 0–1.
  const scaleTo255 = colour.startsWith("color(") ? 255 : 1;
  return [
    Number(parts[0]) * scaleTo255,
    Number(parts[1]) * scaleTo255,
    Number(parts[2]) * scaleTo255,
  ];
}

/**
 * Black or white, whichever has more contrast against the given fill.
 *
 * Chosen per cell rather than fixed for the whole ramp, which is what makes text
 * on a ramp colour legitimate here.
 *
 * The extremes are deliberate. A softened near-black (#0d1016) reads better on
 * the pale end but does not clear 4.5:1 anywhere in the ramp's rust zone, where
 * white does not clear it either — the exhaustive cell pass in
 * scripts/contrast.mjs measured 4.41:1 there and failed the build. With true
 * black and true white the two curves cross at a luminance of 0.179, where both
 * give 4.58:1, so the worst case anywhere on the ramp still clears the
 * threshold. It is a narrow margin and it is checked on every rendered cell
 * rather than trusted.
 */
export function readableInk(fill: string): string {
  const l = luminance(parseColour(fill));
  const onWhite = 1.05 / (l + 0.05);
  const onBlack = (l + 0.05) / 0.05;
  return onWhite > onBlack ? "#ffffff" : "#000000";
}
