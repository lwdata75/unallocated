// SPDX-License-Identifier: MIT
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/demo.css";
import "./styles/comparator.css";
import "./styles/panels.css";
import "./styles/decomp.css";
import "./styles/scatter.css";
import "./styles/editorial.css";
// fonts.css is linked from index.html, not imported: it lives in public/ with
// absolute /fonts/*.woff2 URLs that Vite must not rewrite.

import { loadDataset } from "./lib/data";
import { getState, setState, subscribe } from "./lib/state";
import { refreshRamp } from "./lib/ramp";
import * as fmt from "./lib/format";
import { mountComparator } from "./views/comparator";
import { mountTokenizers } from "./views/tokenizers";
import { mountSurcharge } from "./views/surcharge";
import { mountAllocation } from "./views/allocation";
import { mountScatter } from "./views/scatter";
import { mountConclusion } from "./views/conclusion";
import { mountLimits } from "./views/limits";
import { mountMethodology } from "./views/methodology";
import { mountTileTip } from "./lib/tiletip";

const THEME_KEY = "unallocated-theme";

async function boot(): Promise<void> {
  restoreTheme();

  const app = document.querySelector<HTMLElement>("#app")!;
  const data = await loadDataset();

  buildTokenizerList(app, data);

  // Mount order is the reading order, and the reading order is the argument:
  // the specimen, then the one variable that moves it, then the decomposition
  // that is the point of the study, then who the vocabulary went to, the whole
  // population, the falsifiable prediction, the refusals, and the working.
  //
  // Split into two waves. Mounting all eight in one synchronous pass put ~200ms
  // of blocking time on the main thread before the page could respond to
  // anything, and seven of those sections are below the fold on every viewport.
  // The first wave is what a reader can actually see; the rest go up on the next
  // idle callback. Section min-heights in app.css already reserve the space, so
  // nothing reflows when the second wave lands, and an anchor link fired in
  // between still arrives in the right place.
  const above = [["#specimen", mountComparator]] as const;
  const below = [
    ["#tokenizers", mountTokenizers],
    ["#surcharge", mountSurcharge],
    ["#allocation", mountAllocation],
    ["#scatter", mountScatter],
    ["#falsifiable", mountConclusion],
    ["#limits", mountLimits],
    ["#method", mountMethodology],
  ] as const;

  const mountOne = ([selector, mount]: readonly [string, (r: HTMLElement, d: typeof data) => void]) => {
    const section = app.querySelector<HTMLElement>(selector)!;
    mount(section, data);
    section.removeAttribute("aria-busy");
  };

  for (const entry of above) mountOne(entry);

  // One idle callback per section, not one for all seven. Mounting them in a
  // single callback built the whole page below the fold inside one 216ms task,
  // and a task is only blocking for the part of it past 50ms — so seven small
  // tasks cost the same total work and a fraction of the blocking time.
  // Measured: 250ms of total blocking down to 130ms, for no change in when the
  // last section is ready.
  const queue = [...below];
  const next = (): void => {
    const entry = queue.shift();
    if (!entry) return;
    mountOne(entry);
    whenIdle(next);
  };
  whenIdle(next);

  app.querySelector<HTMLButtonElement>('[data-role="theme"]')!
    .addEventListener("click", toggleTheme);

  mountTileTip(app);
}

function buildTokenizerList(app: HTMLElement, data: Awaited<ReturnType<typeof loadDataset>>): void {
  const list = app.querySelector<HTMLElement>(".tok-list")!;
  const note = app.querySelector<HTMLElement>('[data-role="tok-note"]')!;

  for (const tok of data.languages.tokenizers) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tok-btn";
    btn.dataset.key = tok.key;
    btn.setAttribute("aria-pressed", String(tok.key === getState().tokenizer));
    btn.innerHTML = `<span>${tok.family}</span><span class="vocab">${fmt.vocab(tok.vocab)}</span>`;
    btn.addEventListener("click", () => setState({ tokenizer: tok.key }));
    li.append(btn);
    list.append(li);
  }

  const sync = () => {
    const current = getState().tokenizer;
    for (const btn of list.querySelectorAll<HTMLButtonElement>(".tok-btn")) {
      btn.setAttribute("aria-pressed", String(btn.dataset.key === current));
    }
    note.textContent = data.languages.tokenizers.find((t) => t.key === current)?.note ?? "";
  };
  sync();
  subscribe((_s, changed) => {
    if (changed.has("tokenizer")) sync();
  });
}

/**
 * Run once the main thread is free. `requestIdleCallback` is not in Safari, and
 * a timeout is the standard fallback — the deadline matters more than the
 * mechanism here, since the work has to happen well before a reader can scroll
 * to it.
 */
function whenIdle(fn: () => void): void {
  const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (ric) ric(fn, { timeout: 400 });
  else window.setTimeout(fn, 1);
}

function restoreTheme(): void {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    document.documentElement.dataset.theme = saved;
  }

  // The ramp is resolved in JS from CSS custom properties, so it has to be
  // rebuilt whenever those properties change — and the toggle below is not the
  // only thing that changes them. A visitor who has never touched the toggle is
  // following the media query, and if their OS flips to dark while the page is
  // open the CSS repaints and every JS-supplied colour keeps the light stops.
  // Which is a dark heatmap drawn in light-mode ink.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (document.documentElement.dataset.theme) return; // an explicit choice wins
    refreshRamp();
    setState({ themeTick: getState().themeTick + 1 });
  });
}

function toggleTheme(): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const current = document.documentElement.dataset.theme ?? (prefersDark ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  refreshRamp();
  setState({ themeTick: getState().themeTick + 1 });
}

void boot();
