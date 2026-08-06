// SPDX-License-Identifier: MIT
/**
 * Who the vocabulary went to.
 *
 * Every language measured, against every tokenizer measured, as a matrix. The
 * claim before it argues that allocation is a scoped choice; this is where the
 * scope becomes visible. Read a row and you see one language's fortunes across
 * eight vocabularies. Read a column and you see one vendor's priorities.
 *
 * The stripes are the finding. A tokenizer that had simply "got better" would
 * shade its whole column evenly; these do not. o200k is dramatically better than
 * cl100k for some rows and identical for others, and which rows those are was
 * decided by whoever assembled the training data.
 *
 * Cells carry their number, which means text sits on a ramp colour — the one
 * place on the site where that happens. It is only legitimate because the ink is
 * picked per cell for contrast (see ramp.ts) and the result is checked rather
 * than assumed.
 */

import type { Dataset, Language } from "../lib/data";
import { fertilityColour, readableInk, rampStops } from "../lib/ramp";
import { figureSpan } from "../lib/figures";
import { getState, setState, subscribe } from "../lib/state";
import * as fmt from "../lib/format";

type SortKey = "speakers" | "cost" | "spread" | "name";

const DEFAULT_ROWS = 24;

interface Row {
  language: Language;
  /** Fertility per tokenizer key; undefined where the language was not measured. */
  cells: Array<{ key: string; fertility: number; tokens: number } | null>;
  cost: number;
  /** Worst tokenizer's fertility over the best one's: the size of the choice. */
  spread: number;
  best: string;
  worst: string;
}

export function mountAllocation(root: HTMLElement, data: Dataset): void {
  const tokenizers = data.languages.tokenizers;
  const fig = (key: string): string => figureSpan(data.headline.figures, key);
  const regions = [
    ...new Set(data.languages.languages.flatMap((l) => l.region.split(";"))),
  ]
    .filter(Boolean)
    .sort();

  let sort: SortKey = "speakers";
  let region = "";
  let query = "";
  let expanded = DEFAULT_ROWS;
  let selected: string | null = null;

  root.innerHTML = `
    <div class="section-head">
      <p class="step-mark">Four</p>
      <h2>Who the vocabulary went to</h2>
      <p class="standfirst">
        Nobody bought "multilingual". They bought a list. This is the list, and
        the edges of it are legible in the measurements.
      </p>
    </div>

    <div class="editorial editorial-lead">
      <p>
        BLOOM was built multilingual-first with a 250,000-token vocabulary. Its
        median fertility across all ${data.languages.languages.length} languages
        is ${fig("median_fertility_bloom_vs_o200k")} for OpenAI's o200k — very
        slightly <em>worse</em> overall. On Bengali it costs
        ${fig("bengali_bloom_vs_o200k")}. It wins on
        ${fig("bloom_beats_o200k_count")} languages and loses on the rest, and
        ROOTS, the corpus it was trained on, covered roughly 46 languages. A
        vocabulary allocated multilingually is not uniformly better. It is better
        exactly where somebody pointed it.
      </p>
      <p class="caption">
        Every language down the side, every tokenizer across the top, coloured by
        what that pairing costs against English. If tokenizers had simply been
        getting better, each column would shade evenly. They do not. Search or
        filter to find a language, click any row to open it in full, and sort by
        the last column to see where the largest choices were made.
      </p>
    </div>

    <div class="matrix-controls">
      <label class="inline-field">
        <span>Find a language</span>
        <input type="search" class="lang-search" list="lang-options"
               placeholder="Telugu, Yoruba, Welsh…" autocomplete="off" />
      </label>
      <datalist id="lang-options">
        ${data.languages.languages.map((l) => `<option value="${l.name}"></option>`).join("")}
      </datalist>
      <label class="inline-field">
        <span>Region</span>
        <select class="region-select">
          <option value="">All</option>
          ${regions.map((r) => `<option value="${r}">${r}</option>`).join("")}
        </select>
      </label>
      <label class="inline-field">
        <span>Sort by</span>
        <select class="sort-select">
          <option value="speakers">Speakers</option>
          <option value="cost">Cost on the selected tokenizer</option>
          <option value="spread">Spread between best and worst</option>
          <option value="name">Name</option>
        </select>
      </label>
      <span class="matrix-count tabular" role="status"></span>
    </div>

    <p class="matrix-hint">
      The table takes a single tab stop; use the up and down arrows to move
      between languages, and Enter to open one.
    </p>

    <div class="matrix-scroll">
      <table class="matrix">
        <caption class="visually-hidden">
          Fertility against English for every language and tokenizer measured.
        </caption>
        <thead></thead>
        <tbody></tbody>
      </table>
    </div>

    <ul class="ramp-legend matrix-legend"></ul>

    <div class="lang-detail" hidden></div>
  `;

  const theadEl = root.querySelector<HTMLElement>("thead")!;
  const tbodyEl = root.querySelector<HTMLElement>("tbody")!;
  const countEl = root.querySelector<HTMLElement>(".matrix-count")!;
  const detailEl = root.querySelector<HTMLElement>(".lang-detail")!;
  const legendEl = root.querySelector<HTMLElement>(".matrix-legend")!;
  const searchEl = root.querySelector<HTMLInputElement>(".lang-search")!;

  searchEl.addEventListener("input", () => {
    query = searchEl.value.trim().toLowerCase();
    expanded = DEFAULT_ROWS;
    render();
  });
  root.querySelector<HTMLSelectElement>(".region-select")!.addEventListener("change", (e) => {
    region = (e.target as HTMLSelectElement).value;
    expanded = DEFAULT_ROWS;
    render();
  });
  root.querySelector<HTMLSelectElement>(".sort-select")!.addEventListener("change", (e) => {
    sort = (e.target as HTMLSelectElement).value as SortKey;
    render();
  });

  subscribe((_s, changed) => {
    if (changed.has("tokenizer") || changed.has("themeTick")) render();
  });

  render();

  // ------------------------------------------------------------------- render

  function buildRows(): Row[] {
    const current = getState().tokenizer;
    return data.languages.languages
      .map((language): Row | null => {
        const metrics = language.metrics.flores;
        if (!metrics) return null;
        const cells = tokenizers.map((t) => {
          const m = metrics[t.key];
          return m ? { key: t.key, fertility: m.fertility, tokens: m.tokens } : null;
        });
        const present = cells.filter((c): c is NonNullable<typeof c> => c !== null);
        if (present.length === 0) return null;
        const best = present.reduce((a, b) => (b.fertility < a.fertility ? b : a));
        const worst = present.reduce((a, b) => (b.fertility > a.fertility ? b : a));
        return {
          language,
          cells,
          cost: metrics[current]?.fertility ?? Number.POSITIVE_INFINITY,
          spread: best.fertility > 0 ? worst.fertility / best.fertility : 1,
          best: best.key,
          worst: worst.key,
        };
      })
      .filter((r): r is Row => r !== null);
  }

  function render(): void {
    const all = buildRows();

    const filtered = all.filter((r) => {
      if (region && !r.language.region.split(";").includes(region)) return false;
      if (query && !r.language.name.toLowerCase().includes(query)) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      switch (sort) {
        case "cost":
          return b.cost - a.cost;
        case "spread":
          return b.spread - a.spread;
        case "name":
          return a.language.name.localeCompare(b.language.name);
        default:
          return b.language.speakers - a.language.speakers;
      }
    });

    const shown = sorted.slice(0, expanded);

    const current = getState().tokenizer;
    theadEl.innerHTML = `
      <tr>
        <th scope="col" class="matrix-corner">Language</th>
        ${tokenizers
          .map(
            (t) => `<th scope="col" class="${t.key === current ? "is-current" : ""}">
              <span class="matrix-tok">${t.family}</span>
              <span class="matrix-vocab tabular">${fmt.vocab(t.vocab)}</span>
            </th>`
          )
          .join("")}
        <th scope="col" class="matrix-spread-head">Spread</th>
      </tr>`;

    tbodyEl.innerHTML = shown
      .map((r) => {
        const cells = r.cells
          .map((c, i) => {
            if (!c) return `<td class="matrix-cell is-empty" aria-label="not measured">·</td>`;
            const fill = fertilityColour(c.fertility);
            const isCurrent = tokenizers[i].key === current;
            return `<td class="matrix-cell${isCurrent ? " is-current" : ""}"
              style="background:${fill};color:${readableInk(fill)}"
              title="${r.language.name} on ${tokenizers[i].family}: ${fmt.multiplier(c.fertility)} English, ${fmt.tokens(c.tokens)} median tokens per sentence">
              <span class="tabular">${c.fertility < 10 ? c.fertility.toFixed(1) : Math.round(c.fertility)}</span>
            </td>`;
          })
          .join("");
        // Roving tabindex: one stop for the whole table, arrows move within it.
        // Making every row tabbable put 24 stops between the reader and the next
        // control — the visual gate measured the walk to the scatter going from
        // 44 tabs to 87 — which is the standard failure mode for a focusable
        // grid and the reason the pattern exists.
        const roving = r.language.code === (selected ?? shown[0]?.language.code) ? 0 : -1;
        return `
        <tr data-code="${r.language.code}" tabindex="${roving}" ${
          selected === r.language.code ? 'class="is-selected"' : ""
        }>
          <th scope="row" class="matrix-name">
            <span class="matrix-lang">${r.language.name}</span>
            <span class="matrix-meta">${r.language.script} · ${fmt.speakers(r.language.speakers)}</span>
          </th>
          ${cells}
          <td class="matrix-spread tabular">${fmt.multiplier(r.spread)}</td>
        </tr>`;
      })
      .join("");

    const more = sorted.length - shown.length;
    countEl.innerHTML =
      more > 0
        ? `${fmt.tokens(shown.length)} of ${fmt.tokens(sorted.length)} shown ·
           <button type="button" class="link-btn" data-role="more">show all ${fmt.tokens(sorted.length)}</button>`
        : `${fmt.tokens(sorted.length)} language${sorted.length === 1 ? "" : "s"}`;

    countEl.querySelector('[data-role="more"]')?.addEventListener("click", () => {
      expanded = Number.MAX_SAFE_INTEGER;
      render();
    });

    const trs = [...tbodyEl.querySelectorAll<HTMLElement>("tr")];
    for (const [index, tr] of trs.entries()) {
      const open = () => {
        selected = tr.dataset.code!;
        renderDetail(selected);
        for (const other of trs) other.classList.toggle("is-selected", other === tr);
      };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
          return;
        }
        const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
        if (step === 0) return;
        e.preventDefault();
        const next = trs[index + step];
        if (!next) return;
        // Move the single tab stop with the focus, or Tab would return the
        // reader to the row they started from rather than leaving the table.
        tr.tabIndex = -1;
        next.tabIndex = 0;
        next.focus();
      });
    }

    legendEl.innerHTML =
      `<li class="legend-title">Tokens per sentence, against English</li>` +
      rampStops()
        .map(
          (s) =>
            `<li><span class="swatch" style="background:${s.colour}"></span>` +
            `<span class="tabular">${fmt.multiplier(s.value)}</span></li>`
        )
        .join("");

    if (selected) renderDetail(selected);
  }

  /**
   * One language, in full. This is the "what about mine?" answer — the question
   * every reader has and that a 204-row matrix does not answer on its own.
   */
  function renderDetail(code: string): void {
    const language = data.byCode.get(code);
    const metrics = language?.metrics.flores;
    if (!language || !metrics) {
      detailEl.hidden = true;
      return;
    }

    const rows = tokenizers
      .map((t) => ({ t, m: metrics[t.key] }))
      .filter((r): r is { t: (typeof tokenizers)[number]; m: NonNullable<typeof r.m> } => !!r.m);
    const max = Math.max(...rows.map((r) => r.m.fertility));
    const best = rows.reduce((a, b) => (b.m.fertility < a.m.fertility ? b : a));
    const worst = rows.reduce((a, b) => (b.m.fertility > a.m.fertility ? b : a));
    const floor = language.floors?.flores ?? language.floor;

    detailEl.hidden = false;
    detailEl.innerHTML = `
      <div class="detail-head">
        <div>
          <h3>${language.name}</h3>
          <p class="detail-meta">
            ${language.script} script · ${language.family} · ${language.region.replace(/;/g, ", ")}
            · ${fmt.speakers(language.speakers)} speakers
          </p>
        </div>
        <button type="button" class="chip" data-role="close-detail">Close</button>
      </div>

      <ol class="detail-bars">
        ${rows
          .map((r) => {
            const fill = fertilityColour(r.m.fertility);
            return `<li>
              <span class="detail-name">${r.t.family}</span>
              <span class="detail-track">
                <span class="detail-bar" style="width:${(r.m.fertility / max) * 100}%;
                      background:${fill}"></span>
              </span>
              <span class="detail-value tabular">${fmt.multiplier(r.m.fertility)}<em>${fmt.tokens(r.m.tokens)} tok</em></span>
            </li>`;
          })
          .join("")}
      </ol>

      <p class="detail-summary">
        ${
          best.t.key === worst.t.key
            ? `Only one tokenizer measured for ${language.name}.`
            : `The cheapest vocabulary measured spends
               <strong>${fmt.tokens(best.m.tokens)}</strong> tokens on a sentence of
               ${language.name}; the most expensive spends
               <strong>${fmt.tokens(worst.m.tokens)}</strong>. The language did not
               change between those two numbers. Its floor — the least any of these
               eight manages — is ${fmt.tokens(floor)} tokens, so anything above
               that is vocabulary that was available to allocate and went
               elsewhere.`
        }
      </p>`;

    detailEl.querySelector('[data-role="close-detail"]')?.addEventListener("click", () => {
      selected = null;
      detailEl.hidden = true;
      for (const other of tbodyEl.querySelectorAll("tr")) other.classList.remove("is-selected");
    });
  }

  void setState;
}
