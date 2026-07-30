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

// Note: nothing sets text on a ramp colour. The mid-tones (sand, rust) cannot
// reach 4.5:1 against either black or white, so badges and legends carry the
// ramp as a swatch beside neutral-on-neutral text instead.
