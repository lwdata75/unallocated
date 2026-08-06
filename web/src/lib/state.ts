// SPDX-License-Identifier: MIT
/** Shared UI state. Small enough that a framework would buy nothing. */

export interface AppState {
  tokenizer: string;
  /** Hero columns, in order. English first: it is the pivot every ratio uses. */
  heroLanguages: string[];
  corpus: "flores" | "massive";
  /** Free text overrides the sample sentence when non-empty. */
  freeText: string;
  sampleIndex: number;
  /** Bumped when the theme changes. Views read ramp colours at paint time, so
      they need an explicit nudge to repaint with the lightened dark variant. */
  themeTick: number;
}

type Listener = (state: AppState, changed: Set<keyof AppState>) => void;

const state: AppState = {
  tokenizer: "o200k",
  // French for "even close relatives pay", Japanese for a genuine floor, Telugu
  // for what neglect looks like further out.
  //
  // Four, not five. Five columns did not fit the field at any common desktop
  // width, so the specimen — the first thing on the page and the whole argument
  // — opened behind a horizontal scrollbar with its fifth column cut off. Four
  // fit, and each one is about 70px wider for it. Burmese went because it was
  // the last, and because Japanese already carries the same point: a language
  // well above parity that is sitting exactly at its floor.
  heroLanguages: ["eng_Latn", "fra_Latn", "jpn_Jpan", "tel_Telu"],
  corpus: "flores",
  freeText: "",
  sampleIndex: 0,
  themeTick: 0,
};

const listeners = new Set<Listener>();

export function getState(): Readonly<AppState> {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  const changed = new Set<keyof AppState>();
  for (const [key, value] of Object.entries(patch) as [keyof AppState, never][]) {
    if (state[key] !== value) {
      state[key] = value;
      changed.add(key);
    }
  }
  if (changed.size === 0) return;
  for (const listener of listeners) listener(state, changed);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
