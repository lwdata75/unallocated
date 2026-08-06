// SPDX-License-Identifier: MIT
/** Number formatting. Numbers get units and a comparison, and no fake precision. */

/** `3.9` -> `3.9x`, `13.74` -> `14x`. The corpus does not support more digits. */
export function multiplier(value: number): string {
  const digits = value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)}×`;
}

/** The same, but saying what it is relative to. */
export function multiplierVsEnglish(value: number): string {
  return value === 1 ? "at parity with English" : `${multiplier(value)} English`;
}

export function tokens(value: number): string {
  return value.toLocaleString("en-US");
}

/** `82000000` -> `82M`. Speaker counts are contested; do not imply precision. */
export function speakers(value: number): string {
  if (!value) return "no figure";
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}bn`;
  if (value >= 1e6) return `${Math.round(value / 1e6)}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`;
  return String(value);
}

/** `0.9` -> `+90%`. Neglect is an excess over the floor, so it is always signed. */
export function neglect(value: number): string {
  if (value <= 0.005) return "at the floor";
  return `+${Math.round(value * 100)}% over floor`;
}

export function vocab(value: number): string {
  return `${Math.round(value / 1000)}k`;
}

/**
 * "a" or "an" for a number the reader will say out loud.
 *
 * The window sizes are generated, so the article in front of them has to be
 * too — hardcoding "a" gave "a 8,000-token window" the moment 8k was selected.
 * The English rule is about the spoken form, and the only spoken forms that
 * start with a vowel are the eights ("eight", "eighty", "eight thousand") and
 * the elevens and eighteens when read as hundreds.
 */
export function article(value: number): string {
  const digits = String(Math.abs(Math.round(value)));
  if (digits[0] === "8") return "an";
  if (digits.length === 4 && (digits.startsWith("11") || digits.startsWith("18"))) return "an";
  return "a";
}
