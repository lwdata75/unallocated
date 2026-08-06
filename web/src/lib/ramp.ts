// SPDX-License-Identifier: MIT
/**
 * The one data ramp.
 *
 * Sequential and single-hue: lightness falls monotonically from parity to the
 * worst measured case, so higher cost reads as more ink rather than as a worse
 * colour. The six stops are authored in OKLCH in styles/tokens.css; this module
 * reads them back, interpolates between them *in OKLCH*, and resolves to sRGB.
 *
 * Interpolating in the space the stops are authored in is the point. Six stops
 * spread over a 1×–8× domain leave long gaps, and a ramp interpolated in sRGB
 * dips in lightness between them — which on this page would mean a language at
 * 2.4× drawn lighter than one at 2.0×, i.e. the chart lying. OKLCH is
 * perceptually uniform in lightness, so a linear walk between two stops is a
 * linear walk in apparent density.
 *
 * Doing the conversion here rather than leaning on the browser is not
 * gold-plating: custom properties are unresolved, so getPropertyValue hands
 * back the literal `oklch(...)` text, and no colour library in the dependency
 * tree parses it.
 */

/** Fertility values the six authored stops sit at. */
const STOPS = [1.0, 1.4, 2.0, 3.0, 5.0, 8.0];
const VARS = ["--ramp-1_0", "--ramp-1_4", "--ramp-2_0", "--ramp-3_0", "--ramp-5_0", "--ramp-8_0"];

type Oklch = [l: number, c: number, h: number];

let stops: Oklch[] = read();

function read(): Oklch[] {
  const styles = getComputedStyle(document.documentElement);
  return VARS.map((v) => parseOklch(styles.getPropertyValue(v)) ?? [0.5, 0, 0]);
}

/** `oklch(0.765 0.072 68)` -> [0.765, 0.072, 68]. Percentages allowed on L. */
function parseOklch(value: string): Oklch | null {
  const body = value.trim().match(/^oklch\(([^)]*)\)$/i)?.[1];
  if (!body) return null;
  const parts = body.split("/")[0].trim().split(/\s+/);
  if (parts.length < 3) return null;
  const num = (s: string): number =>
    s.endsWith("%") ? Number(s.slice(0, -1)) / 100 : Number(s);
  const out: Oklch = [num(parts[0]), num(parts[1]), num(parts[2])];
  return out.every(Number.isFinite) ? out : null;
}

/** Call after the theme changes so the ramp picks up the other palette. */
export function refreshRamp(): void {
  stops = read();
}

/**
 * Hue is interpolated the short way but *without* wrap handling, deliberately:
 * both palettes walk a 30° arc from ochre to umber with no crossing of 0°, and
 * a wrap-aware path here would only be dead code that a future stop change
 * could silently start depending on. If the stops ever cross 0°, this comment
 * is the thing that should fail review.
 */
function mix(a: Oklch, b: Oklch, t: number): Oklch {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function sample(fertility: number): Oklch {
  if (fertility <= STOPS[0]) return stops[0];
  const last = STOPS.length - 1;
  if (fertility >= STOPS[last]) return stops[last];
  let i = 0;
  while (i < last && fertility > STOPS[i + 1]) i += 1;
  const t = (fertility - STOPS[i]) / (STOPS[i + 1] - STOPS[i]);
  return mix(stops[i], stops[i + 1], t);
}

/** OKLCH -> sRGB hex, gamut-clipped per channel. */
function toHex([L, C, H]: Oklch): string {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return `#${linear
    .map((v) => {
      const c = Math.max(0, Math.min(1, v));
      const encoded = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

export function fertilityColour(fertility: number): string {
  return toHex(sample(fertility));
}

/** Legend stops, for the scatter's axis key and the method section. */
export function rampStops(): Array<{ value: number; colour: string }> {
  return STOPS.map((value, i) => ({ value, colour: toHex(stops[i]) }));
}

// Badges and legends carry the ramp as a swatch beside neutral-on-neutral text,
// because no *single* ink colour clears 4.5:1 against the whole ramp — the pale
// end is too light for white and the dark end too dark for black.
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
  if (colour.startsWith("#")) {
    const hex = colour.slice(1);
    const wide = hex.length >= 6;
    const at = (i: number): number =>
      wide
        ? parseInt(hex.slice(i * 2, i * 2 + 2), 16)
        : parseInt(hex[i] + hex[i], 16);
    return [at(0), at(1), at(2)];
  }
  const parts = colour.match(/[\d.]+/g);
  if (!parts) return [128, 128, 128];
  // `rgb(r, g, b)` arrives in 0–255, but anything that has been through
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
 * Chosen per cell rather than fixed for the whole ramp, which is what makes
 * text on a ramp colour legitimate here at all.
 *
 * The extremes are deliberate. A softened near-black (#0d1016) reads better on
 * the pale end but does not clear 4.5:1 in the ramp's mid-tones, where white
 * does not clear it either — the exhaustive cell pass in scripts/contrast.mjs
 * measured 4.41:1 there and failed the build. With true black and true white
 * the two curves cross at a luminance of 0.179, where both give 4.58:1, so the
 * worst case anywhere on any ramp still clears the threshold. It is a narrow
 * margin and it is checked on every rendered cell rather than trusted.
 */
export function readableInk(fill: string): string {
  const l = luminance(parseColour(fill));
  const onWhite = 1.05 / (l + 0.05);
  const onBlack = (l + 0.05) / 0.05;
  return onWhite > onBlack ? "#ffffff" : "#000000";
}
