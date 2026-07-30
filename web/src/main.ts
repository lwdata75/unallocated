import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/comparator.css";
import "./styles/scatter.css";
import "./styles/editorial.css";
// fonts.css is linked from index.html, not imported: it lives in public/ with
// absolute /fonts/*.woff2 URLs that Vite must not rewrite.

import { loadDataset } from "./lib/data";
import { getState, setState, subscribe } from "./lib/state";
import { refreshRamp } from "./lib/ramp";
import * as fmt from "./lib/format";
import { mountComparator } from "./views/comparator";
import { mountScatter } from "./views/scatter";
import { mountMethodology } from "./views/methodology";

const THEME_KEY = "token-tax-theme";

async function boot(): Promise<void> {
  restoreTheme();

  const app = document.querySelector<HTMLElement>("#app")!;
  const data = await loadDataset();

  buildTokenizerList(app, data);

  const mounts = [
    ["#comparator", mountComparator],
    ["#scatter", mountScatter],
    ["#methodology", mountMethodology],
  ] as const;
  for (const [selector, mount] of mounts) {
    const section = app.querySelector<HTMLElement>(selector)!;
    mount(section, data);
    section.removeAttribute("aria-busy");
  }

  app.querySelector<HTMLButtonElement>('[data-role="theme"]')!
    .addEventListener("click", toggleTheme);
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

function restoreTheme(): void {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    document.documentElement.dataset.theme = saved;
  }
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
