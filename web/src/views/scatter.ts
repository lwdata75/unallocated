// SPDX-License-Identifier: MIT
/**
 * View 2 — the scatter. The frame people screenshot.
 *
 * x = fertility multiplier, log, 1.0 pinned at the left edge.
 * y = speakers, log. Dot area = speakers. Fill = the diverging ramp.
 *
 * The shape is the argument: the surcharge rises as speaker population falls.
 * Changing the tokenizer transitions the whole cloud, so you can watch it pull
 * left as vocabulary coverage improves.
 *
 * One deliberate deviation from the brief. It asks for stroke to encode script
 * family, but section 6.5 forbids rainbow categorical palettes and section 6.2
 * allows exactly one ramp and one interactive colour. Fifteen distinguishable
 * stroke hues would break both. Script family is therefore a *highlight* — pick
 * one in the rail and its languages take the marine stroke while the rest stay
 * neutral — which keeps the grouping legible without spending a palette on it.
 */

import { scaleLog, scaleSqrt } from "d3-scale";
import { extent } from "d3-array";
import { select } from "d3-selection";
import { brushX } from "d3-brush";
import "d3-transition";

import type { Dataset, Language, LanguageMetrics } from "../lib/data";
import { getState, subscribe } from "../lib/state";
import { fertilityColour } from "../lib/ramp";
import * as fmt from "../lib/format";

const W = 1200;
const H = 630;
// Left margin clears the y labels and leaves room for the 1.0x dot, which is
// pinned to the axis and would otherwise be sliced in half by it.
const M = { top: 28, right: 44, bottom: 58, left: 116 };

const X_TICKS = [1, 1.5, 2, 3, 5, 8, 14];
const Y_TICKS = [1e4, 1e5, 1e6, 1e7, 1e8, 1e9];

export function mountScatter(root: HTMLElement, data: Dataset): void {
  const languages = data.languages.languages.filter(
    (l) => l.speakers > 0 && l.metrics.flores
  );
  const scripts = [...new Set(languages.map((l) => l.script))].sort();

  root.innerHTML = `
    <div class="section-head">
      <h2>The surcharge rises as the speaker population falls</h2>
      <p class="caption">
        Every dot is one language on the FLORES-200 corpus. Horizontal position is
        what it costs relative to English; vertical position is how many people
        speak it. Drag across the plot to filter, and change the tokenizer to
        watch the cloud move.
      </p>
      <div class="scatter-controls">
        <label class="inline-field">
          <span>Highlight script</span>
          <select class="script-select">
            <option value="">None</option>
            ${scripts.map((s) => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </label>
        <span class="brush-readout tabular" role="status"></span>
      </div>
    </div>
    <figure class="scatter-figure">
      <svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet"></svg>
      <figcaption class="visually-hidden"></figcaption>
    </figure>
    <div class="bar-list" hidden></div>
    <div class="lang-card" hidden role="status"></div>
  `;

  const svgEl = root.querySelector<SVGSVGElement>("svg")!;
  const cardEl = root.querySelector<HTMLElement>(".lang-card")!;
  const readoutEl = root.querySelector<HTMLElement>(".brush-readout")!;
  const captionEl = root.querySelector<HTMLElement>("figcaption")!;
  const barListEl = root.querySelector<HTMLElement>(".bar-list")!;
  const scriptSelect = root.querySelector<HTMLSelectElement>(".script-select")!;

  const svg = select(svgEl);
  // 1.0x is pinned, but inset from the axis so the English dot sits beside the
  // parity line rather than straddling it.
  const x = scaleLog().range([M.left + 34, W - M.right]).clamp(true);
  const y = scaleLog().range([H - M.bottom, M.top]);
  const r = scaleSqrt().range([3, 34]);

  let brushRange: [number, number] | null = null;
  let highlight = "";
  let activeIndex = 0;

  const gGrid = svg.append("g").attr("class", "grid");
  const gAxes = svg.append("g").attr("class", "axes");
  const gBrush = svg.append("g").attr("class", "brush");
  // role=list on the container: the dots are role=listitem, and a listitem
  // without a list ancestor is an accessibility-tree error.
  const gDots = svg
    .append("g")
    .attr("class", "dots")
    .attr("role", "list")
    .attr("aria-label", "Languages by cost and speaker count");

  scriptSelect.addEventListener("change", () => {
    highlight = scriptSelect.value;
    draw(false);
  });

  const brush = brushX()
    .extent([[M.left, M.top], [W - M.right, H - M.bottom]])
    .on("brush end", (event) => {
      brushRange = event.selection
        ? [x.invert(event.selection[0]), x.invert(event.selection[1])]
        : null;
      draw(false);
      updateReadout();
    });
  gBrush.call(brush as never);

  // Declared before the first draw(): draw() reads `media`, and a const read
  // from inside a function that runs earlier is a temporal dead zone error.
  const media = window.matchMedia("(max-width: 720px)");
  media.addEventListener("change", () => draw(false));

  gDots.on("keydown", (event: KeyboardEvent) => {
    const circles = [...gDots.node()!.querySelectorAll<SVGCircleElement>("circle")];
    if (circles.length === 0) return;
    const step: Record<string, number> = {
      ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1,
    };
    let next: number | null = null;
    if (event.key in step) next = activeIndex + step[event.key];
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = circles.length - 1;
    if (next === null) return;

    event.preventDefault();
    activeIndex = Math.max(0, Math.min(circles.length - 1, next));
    for (const [i, c] of circles.entries()) c.setAttribute("tabindex", i === activeIndex ? "0" : "-1");
    circles[activeIndex].focus();
  });

  draw(false);
  subscribe((_s, changed) => {
    if (changed.has("tokenizer")) draw(true);
    else if (changed.has("themeTick")) draw(false);
  });

  // ------------------------------------------------------------------- draw

  function metricsFor(l: Language) {
    return l.metrics.flores![getState().tokenizer];
  }

  function draw(animate: boolean): void {
    const rows = languages
      .map((l) => ({ language: l, m: metricsFor(l) }))
      .filter((d) => d.m)
      // Most-spoken first: the big circles paint underneath so the small ones
      // stay clickable, and arrow-key traversal runs from the languages served
      // best to the ones served worst, which is the argument in order.
      .sort((a, b) => b.language.speakers - a.language.speakers);

    const fertilities = rows.map((d) => d.m.fertility);
    x.domain([1, Math.max(2, Math.ceil((extent(fertilities)[1] ?? 8) * 1.05))]);
    y.domain(extent(rows, (d) => d.language.speakers) as [number, number]).nice();
    r.domain([0, extent(rows, (d) => d.language.speakers)![1] as number]);

    const narrow = media.matches;
    root.querySelector<HTMLElement>(".scatter-figure")!.hidden = narrow;
    barListEl.hidden = !narrow;
    if (narrow) {
      drawBarList(rows);
      captionEl.textContent = summaryText(rows);
      return;
    }

    drawAxes();

    const dots = gDots
      .selectAll<SVGCircleElement, (typeof rows)[number]>("circle")
      .data(rows, (d) => d.language.code);

    const entered = dots
      .enter()
      .append("circle")
      .attr("cx", (d) => x(d.m.fertility))
      .attr("cy", (d) => y(d.language.speakers))
      .attr("r", (d) => r(d.language.speakers))
      .attr("role", "listitem")
      .on("pointerenter", (event, d) => showCard(event as PointerEvent, d.language, d.m))
      .on("focus", (event, d) => showCard(event as FocusEvent, d.language, d.m))
      .on("pointerleave", hideCard)
      .on("blur", hideCard);

    const all = entered.merge(dots);
    all.attr("aria-label", (d) =>
      `${d.language.name}, ${fmt.multiplier(d.m.fertility)} English, ${fmt.speakers(d.language.speakers)} speakers`
    );

    // Roving tabindex: the cloud is one tab stop and arrow keys move within it.
    // Two hundred individually tabbable dots would strand a keyboard user
    // between the scatter and the methodology section.
    activeIndex = Math.min(activeIndex, Math.max(rows.length - 1, 0));
    all.attr("tabindex", (_d, i) => (i === activeIndex ? 0 : -1));

    const target = animate ? all.transition().duration(420) : all;
    (target as never as typeof all)
      .attr("cx", (d) => x(d.m.fertility))
      .attr("cy", (d) => y(d.language.speakers))
      .attr("r", (d) => r(d.language.speakers))
      .attr("fill", (d) => fertilityColour(d.m.fertility))
      .attr("fill-opacity", (d) => (dimmed(d) ? 0.12 : 0.72))
      .attr("stroke", (d) =>
        highlight && d.language.script === highlight ? "var(--marine-plain)" : "var(--ink)"
      )
      .attr("stroke-opacity", (d) =>
        dimmed(d) ? 0.1 : highlight && d.language.script === highlight ? 0.95 : 0.35
      )
      .attr("stroke-width", (d) =>
        highlight && d.language.script === highlight ? 2 : 1
      );

    dots.exit().remove();
    captionEl.textContent = summaryText(rows);
    svgEl.setAttribute("aria-label", summaryText(rows));
  }

  function dimmed(d: { m: { fertility: number } }): boolean {
    if (!brushRange) return false;
    return d.m.fertility < brushRange[0] || d.m.fertility > brushRange[1];
  }

  function drawAxes(): void {
    gGrid.selectAll("*").remove();
    gAxes.selectAll("*").remove();

    for (const tick of X_TICKS) {
      if (tick > x.domain()[1]) continue;
      const px = x(tick);
      gGrid
        .append("line")
        .attr("x1", px).attr("x2", px)
        .attr("y1", M.top).attr("y2", H - M.bottom)
        .attr("stroke", "var(--edge)")
        .attr("stroke-opacity", tick === 1 ? 0.95 : 0.45)
        .attr("stroke-dasharray", tick === 1 ? "none" : "2 4");
      gAxes
        .append("text")
        .attr("x", px).attr("y", H - M.bottom + 22)
        .attr("text-anchor", "middle")
        .attr("class", "axis-tick")
        .text(tick === 1 ? "1× (English)" : `${tick}×`);
    }

    for (const tick of Y_TICKS) {
      const [lo, hi] = y.domain();
      if (tick < lo || tick > hi) continue;
      const py = y(tick);
      gGrid
        .append("line")
        .attr("x1", M.left).attr("x2", W - M.right)
        .attr("y1", py).attr("y2", py)
        .attr("stroke", "var(--edge)")
        .attr("stroke-opacity", 0.45)
        .attr("stroke-dasharray", "2 4");
      gAxes
        .append("text")
        .attr("x", M.left - 12).attr("y", py + 4)
        .attr("text-anchor", "end")
        .attr("class", "axis-tick")
        .text(fmt.speakers(tick));
    }

    gAxes
      .append("text")
      .attr("x", M.left).attr("y", H - 16)
      .attr("class", "axis-title")
      .text("Tokens per sentence, relative to English — log scale");

    gAxes
      .append("text")
      .attr("transform", `translate(20 ${M.top + 8}) rotate(-90)`)
      .attr("text-anchor", "end")
      .attr("class", "axis-title")
      .text("Speakers — log scale");

    gAxes
      .append("text")
      .attr("x", W - M.right).attr("y", M.top - 8)
      .attr("text-anchor", "end")
      .attr("class", "axis-title")
      .text(`Tokenizer family: ${familyName()}`);
  }

  function familyName(): string {
    const key = getState().tokenizer;
    return data.languages.tokenizers.find((t) => t.key === key)?.family ?? key;
  }

  function drawBarList(rows: Array<{ language: Language; m: { fertility: number } }>): void {
    const sorted = [...rows].sort((a, b) => b.m.fertility - a.m.fertility).slice(0, 60);
    const max = sorted[0]?.m.fertility ?? 1;
    barListEl.innerHTML = `
      <p class="caption">Sorted by cost, highest first. Showing the 60 most expensive of ${rows.length} languages on ${familyName()}.</p>
      <ol class="bars">
        ${sorted
          .map(
            (d) => `
          <li>
            <span class="bar-name">${d.language.name}</span>
            <span class="bar-track">
              <span class="bar-fill" style="width:${(d.m.fertility / max) * 100}%;background:${fertilityColour(d.m.fertility)}"></span>
            </span>
            <span class="bar-value tabular">${fmt.multiplier(d.m.fertility)}</span>
          </li>`
          )
          .join("")}
      </ol>`;
  }

  function summaryText(rows: Array<{ language: Language; m: { fertility: number } }>): string {
    const over2 = rows.filter((d) => d.m.fertility > 2).length;
    const worst = rows.reduce((a, b) => (b.m.fertility > a.m.fertility ? b : a));
    return (
      `Scatter of ${rows.length} languages on the ${familyName()} tokenizer. ` +
      `${over2} of them cost more than twice what English costs for the same sentence. ` +
      `The most expensive is ${worst.language.name} at ${fmt.multiplier(worst.m.fertility)} English.`
    );
  }

  function updateReadout(): void {
    if (!brushRange) {
      readoutEl.textContent = "";
      return;
    }
    const n = languages.filter((l) => {
      const m = metricsFor(l);
      return m && m.fertility >= brushRange![0] && m.fertility <= brushRange![1];
    }).length;
    readoutEl.textContent =
      `${n} languages between ${fmt.multiplier(brushRange[0])} and ${fmt.multiplier(brushRange[1])} English`;
  }

  function showCard(
    event: PointerEvent | FocusEvent,
    language: Language,
    m: LanguageMetrics
  ): void {
    cardEl.hidden = false;
    cardEl.innerHTML = `
      <h3>${language.name}</h3>
      <p class="card-sub">${language.script} script · ${language.family} · ${language.region}</p>
      <dl>
        <div><dt>Cost</dt><dd class="tabular">${fmt.multiplierVsEnglish(m.fertility)}</dd></div>
        <div><dt>Tail (p90)</dt><dd class="tabular">${fmt.multiplier(m.p90)}</dd></div>
        <div><dt>Tokens per sentence</dt><dd class="tabular">${fmt.tokens(m.tokens)}</dd></div>
        <div><dt>Characters per token</dt><dd class="tabular">${m.cpt.toFixed(2)}</dd></div>
        <div><dt>Above the floor</dt><dd class="tabular">${fmt.neglect(m.neglect)}</dd></div>
        <div><dt>Speakers</dt><dd class="tabular">${fmt.speakers(language.speakers)}</dd></div>
      </dl>`;

    const bounds = root.getBoundingClientRect();
    const target = event.target as Element;
    const dot = target.getBoundingClientRect();
    const left = Math.min(
      Math.max(dot.left - bounds.left + dot.width / 2 - 130, 8),
      bounds.width - 268
    );
    cardEl.style.left = `${left}px`;
    cardEl.style.top = `${dot.bottom - bounds.top + 12}px`;
  }

  function hideCard(): void {
    cardEl.hidden = true;
  }
}
