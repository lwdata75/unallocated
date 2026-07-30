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
  // French for "even close relatives pay", Japanese for a genuine floor,
  // Telugu and Burmese for what neglect looks like further out.
  heroLanguages: ["eng_Latn", "fra_Latn", "jpn_Jpan", "tel_Telu", "mya_Mymr"],
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
