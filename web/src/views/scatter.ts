// SPDX-License-Identifier: MIT
/**
 * View 2 — the scatter.
 *
 * y = speakers (log), dot area = speakers, x = fertility (log, 1.0 pinned).
 *
 * Colour encodes the **neglect share** — the fraction of a language's median
 * token count that sits above its floor — not fertility. Colouring by fertility
 * duplicated the x position, and sizing by speakers duplicates y, which spent
 * two visual channels on zero information. Neglect share is the quantity the
 * project is named for and it is genuinely independent of both axes: a language
 * can be expensive because its script is dense (high x, low neglect) or because
 * nobody spent vocabulary on it (high x, high neglect), and only the colour
 * tells those apart.
 *
 * The title is deliberately descriptive. Spearman rho between log(speakers) and
 * fertility is about -0.29 on o200k and flips sign to +0.24 on GPT-2, so "the
 * surcharge rises as the speaker population falls" claimed more than the data
 * supports. The correlation is printed on the chart so a reader can see how weak
 * it is rather than take a headline's word for it.
 */

import { scaleLog, scaleSqrt } from "d3-scale";
import { extent } from "d3-array";
import { select } from "d3-selection";
import { brushX } from "d3-brush";
import "d3-transition";

import type { Dataset, Language, LanguageMetrics } from "../lib/data";
import { getState, subscribe } from "../lib/state";
import { fertilityColour } from "../lib/ramp";
import { loess } from "../lib/loess";
import * as fmt from "../lib/format";

const W = 1200;
const H = 630;
const M = { top: 28, right: 44, bottom: 58, left: 116 };

const X_TICKS = [1, 1.5, 2, 3, 5, 8, 14];
const Y_TICKS = [1e4, 1e5, 1e6, 1e7, 1e8, 1e9];

/** How many extremes get a permanent label. */
const N_LABELS_COST = 5;
const N_LABELS_POPULATION = 3;

interface Row {
  language: Language;
  m: LanguageMetrics;
  neglectShare: number;
}

export function mountScatter(root: HTMLElement, data: Dataset): void {
  const languages = data.languages.languages.filter(
    (l) => l.speakers > 0 && l.metrics.flores
  );
  const scripts = [...new Set(languages.map((l) => l.script))].sort();

  root.innerHTML = `
    <div class="section-head">
      <p class="step-mark">Five</p>
      <h2>What each language costs, against how many people speak it</h2>
      <p class="caption">
        Five languages made the case. Here are all ${languages.length}. Every dot
        is one language: horizontal position is what it costs relative to
        English, vertical position and size are how many people speak it, and
        colour is the share of those tokens sitting above the language's floor —
        the part no writing system requires.
      </p>
      <!-- Split from the caption above: how to read the chart and how to
           operate it are different questions, and running them together made a
           seven-line paragraph that stood between the reader and the plot. -->
      <p class="caption caption-fine">
        Hover or focus a dot for detail, click to pin it, drag across the plot to
        filter. Labelled: the 5 highest-surcharge languages and the 3 largest by
        speakers. The curve is a LOESS smoother; its shaded band is the 95%
        interval, and its width is the point — the relationship is weak.
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
      <div class="lang-card" hidden role="status"></div>
    </figure>
    <ul class="ramp-legend scatter-legend">
      <li class="legend-title">Share of tokens above the floor</li>
    </ul>
    <div class="bar-list" hidden></div>
  `;

  const svgEl = root.querySelector<SVGSVGElement>("svg")!;
  const figureEl = root.querySelector<HTMLElement>(".scatter-figure")!;
  const cardEl = root.querySelector<HTMLElement>(".lang-card")!;
  const readoutEl = root.querySelector<HTMLElement>(".brush-readout")!;
  const captionEl = root.querySelector<HTMLElement>("figcaption")!;
  const barListEl = root.querySelector<HTMLElement>(".bar-list")!;
  const legendEl = root.querySelector<HTMLElement>(".scatter-legend")!;
  const scriptSelect = root.querySelector<HTMLSelectElement>(".script-select")!;

  const svg = select(svgEl);
  const x = scaleLog().range([M.left + 34, W - M.right]).clamp(true);
  const y = scaleLog().range([H - M.bottom, M.top]);
  const r = scaleSqrt().range([3, 34]);

  let brushRange: [number, number] | null = null;
  let highlight = "";
  let activeIndex = 0;
  let pinned: string | null = null;

  const media = window.matchMedia("(max-width: 720px)");
  media.addEventListener("change", () => draw(false));

  const gGrid = svg.append("g").attr("class", "grid");
  const gAxes = svg.append("g").attr("class", "axes");
  const gBrush = svg.append("g").attr("class", "brush");
  const gTrendUnder = svg.append("g").attr("class", "trend");
  const gDots = svg
    .append("g")
    .attr("class", "dots")
    .attr("role", "list")
    // Chrome makes this group focusable, which put a dead tab stop in front of
    // the dots: Tab landed on the container and the point behind it never got
    // focus, so the card never opened for keyboard users. The keydown handler
    // below still works, because keydown bubbles up from the focused circle.
    .attr("tabindex", -1)
    .attr("aria-label", "Languages by cost and speaker count");
  const gTrend = gTrendUnder;
  const gLabels = svg.append("g").attr("class", "point-labels");

  buildLegend();

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

  // Click anywhere that is not a dot releases a pinned card; Escape does too.
  figureEl.addEventListener("click", (event) => {
    if (!(event.target as Element).closest("circle")) unpin();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (pinned || !cardEl.hidden)) {
      unpin();
      hideCard();
    }
  });

  draw(false);
  subscribe((_s, changed) => {
    if (changed.has("tokenizer")) draw(true);
    else if (changed.has("themeTick")) {
      buildLegend();
      draw(false);
    }
  });

  // ------------------------------------------------------------------- data

  function rowsFor(): Row[] {
    const key = getState().tokenizer;
    return languages
      .map((l) => {
        const m = l.metrics.flores![key];
        if (!m) return null;
        const floor = l.floors?.flores ?? l.floor;
        // Share of this language's tokens that is excess over its floor. 0 means
        // the tokenizer is already as good as the best measured; 1 would mean
        // essentially all of the cost is unallocated vocabulary.
        const neglectShare = m.tokens > 0 ? Math.max(0, (m.tokens - floor) / m.tokens) : 0;
        return { language: l, m, neglectShare } satisfies Row;
      })
      .filter((d): d is Row => d !== null)
      // Most-spoken first: big circles paint underneath so small ones stay
      // clickable, and arrow-key traversal runs best-served to worst-served.
      .sort((a, b) => b.language.speakers - a.language.speakers);
  }

  /** The ramp is anchored 1.0 to 8.0; neglect share is 0 to 1, so remap. */
  function shareColour(share: number): string {
    return fertilityColour(1 + Math.min(Math.max(share, 0), 1) * 7);
  }

  function buildLegend(): void {
    const stops = [0, 0.2, 0.4, 0.6, 0.8, 1];
    legendEl.innerHTML =
      `<li class="legend-title">Share of tokens above the floor</li>` +
      stops
        .map(
          (s) =>
            `<li><span class="swatch" style="background:${shareColour(s)}"></span>` +
            `<span class="tabular">${Math.round(s * 100)}%</span></li>`
        )
        .join("");
  }

  // ------------------------------------------------------------------- draw

  function draw(animate: boolean): void {
    const rows = rowsFor();

    const fertilities = rows.map((d) => d.m.fertility);
    x.domain([1, Math.max(2, Math.ceil((extent(fertilities)[1] ?? 8) * 1.05))]);
    y.domain(extent(rows, (d) => d.language.speakers) as [number, number]).nice();
    r.domain([0, extent(rows, (d) => d.language.speakers)![1] as number]);

    const narrow = media.matches;
    figureEl.hidden = narrow;
    barListEl.hidden = !narrow;
    legendEl.hidden = narrow;
    if (narrow) {
      drawBarList(rows);
      captionEl.textContent = summaryText(rows);
      return;
    }

    drawAxes(rows);
    drawTrend(rows);

    const dots = gDots
      .selectAll<SVGCircleElement, Row>("circle")
      .data(rows, (d) => d.language.code);

    const entered = dots
      .enter()
      .append("circle")
      .attr("cx", (d) => x(d.m.fertility))
      .attr("cy", (d) => y(d.language.speakers))
      .attr("r", (d) => r(d.language.speakers))
      .attr("role", "listitem")
      .on("pointerenter", (event, d) => { if (!pinned) showCard(event as PointerEvent, d); })
      .on("pointermove", (event) => { if (!pinned) positionCard(event as PointerEvent); })
      .on("focus", (event, d) => showCard(event as FocusEvent, d))
      .on("pointerleave", () => { if (!pinned) hideCard(); })
      .on("blur", () => { if (!pinned) hideCard(); })
      .on("click", (event, d) => {
        event.stopPropagation();
        pinned = pinned === d.language.code ? null : d.language.code;
        if (pinned) showCard(event as PointerEvent, d);
        else hideCard();
      });

    const all = entered.merge(dots);
    all.attr("aria-label", (d) =>
      `${d.language.name}, ${fmt.multiplier(d.m.fertility)} English, ` +
      `${Math.round(d.neglectShare * 100)}% of tokens above its floor, ` +
      `${fmt.speakers(d.language.speakers)} speakers`
    );

    activeIndex = Math.min(activeIndex, Math.max(rows.length - 1, 0));
    all.attr("tabindex", (_d, i) => (i === activeIndex ? 0 : -1));

    const target = animate ? all.transition().duration(420) : all;
    (target as never as typeof all)
      .attr("cx", (d) => x(d.m.fertility))
      .attr("cy", (d) => y(d.language.speakers))
      .attr("r", (d) => r(d.language.speakers))
      .attr("fill", (d) => shareColour(d.neglectShare))
      .attr("fill-opacity", (d) => (dimmed(d) ? 0.12 : 0.72))
      .attr("stroke", (d) =>
        highlight && d.language.script === highlight ? "var(--accent)" : "var(--text)"
      )
      .attr("stroke-opacity", (d) =>
        dimmed(d) ? 0.1 : highlight && d.language.script === highlight ? 0.95 : 0.35
      )
      .attr("stroke-width", (d) => (highlight && d.language.script === highlight ? 2 : 1));

    dots.exit().remove();
    drawLabels(rows);
    captionEl.textContent = summaryText(rows);
    svgEl.setAttribute("aria-label", summaryText(rows));
  }

  function dimmed(d: Row): boolean {
    if (!brushRange) return false;
    return d.m.fertility < brushRange[0] || d.m.fertility > brushRange[1];
  }

  /**
   * Label the points that carry the story, by a rule stated in the caption so
   * a reader is never left wondering why these and not others.
   *
   * Placement is a short annealing pass: start beside the bubble, then relax
   * away from every other label, every bubble and the plot edges until nothing
   * overlaps. A leader line is drawn whenever the label ends up far enough from
   * its point that the pairing would otherwise be ambiguous.
   */
  function drawLabels(rows: Row[]): void {
    const visible = rows.filter((d) => !dimmed(d));
    const byCost = [...visible].sort((a, b) => b.m.fertility - a.m.fertility)
      .slice(0, N_LABELS_COST);
    const byPopulation = [...visible].sort((a, b) => b.language.speakers - a.language.speakers)
      .slice(0, N_LABELS_POPULATION);
    const chosen = [...new Set([...byCost, ...byPopulation])];

    const LH = 16;
    const items = chosen.map((d) => {
      const cx = x(d.m.fertility);
      const cy = y(d.language.speakers);
      const radius = r(d.language.speakers);
      const w = d.language.name.length * 7.1 + 6;
      const flip = cx + radius + w + 14 > W - M.right;
      return {
        d, cx, cy, radius, w, flip,
        tx: flip ? cx - radius - 8 : cx + radius + 8,
        ty: cy + 4,
      };
    });

    // Bubbles the labels must clear — the labelled ones plus every dot large
    // enough to hide a word behind it.
    const bubbles = visible
      .filter((v) => r(v.language.speakers) > 10)
      .map((v) => ({ x: x(v.m.fertility), y: y(v.language.speakers), r: r(v.language.speakers) }));

    const left = (i: typeof items[number]) => (i.flip ? i.tx - i.w : i.tx);
    const overlaps = (a: typeof items[number], b: typeof items[number]) =>
      Math.abs(a.ty - b.ty) < LH &&
      left(a) < left(b) + b.w && left(b) < left(a) + a.w;

    for (let pass = 0; pass < 60; pass += 1) {
      let moved = false;
      for (const a of items) {
        for (const b of items) {
          if (a === b) continue;
          if (!overlaps(a, b)) continue;
          const dir = a.ty <= b.ty ? -1 : 1;
          a.ty += dir * 4;
          b.ty -= dir * 4;
          moved = true;
        }
        // Push clear of any bubble it is sitting on.
        for (const bub of bubbles) {
          const lx = left(a) + a.w / 2;
          const dx = lx - bub.x;
          const dy = a.ty - 4 - bub.y;
          const dist = Math.hypot(dx, dy);
          if (dist < bub.r + 9 && dist > 0.01) {
            a.ty += (dy / dist) * 5;
            moved = true;
          }
        }
        a.ty = Math.max(M.top + 12, Math.min(H - M.bottom - 6, a.ty));
      }
      if (!moved) break;
    }

    // Deterministic finishing sweep. The relaxation above can settle just short
    // of clearing, especially against the top clamp where it has nowhere to go;
    // this walks top to bottom and pushes each label below the previous one it
    // actually overlaps horizontally, which always terminates.
    const byY = [...items].sort((a, b) => a.ty - b.ty);
    for (let i = 1; i < byY.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const above = byY[j];
        const here = byY[i];
        const horizontallyClear =
          left(here) > left(above) + above.w || left(above) > left(here) + here.w;
        if (horizontallyClear) continue;
        if (here.ty - above.ty < LH) here.ty = above.ty + LH;
      }
    }

    const labels = gLabels.selectAll<SVGGElement, typeof items[number]>("g.label")
      .data(items, (i) => i.d.language.code);
    const entered = labels.enter().append("g").attr("class", "label");
    entered.append("line").attr("class", "leader");
    entered.append("text").attr("class", "point-label");

    const merged = entered.merge(labels);
    merged.select<SVGTextElement>("text")
      .attr("x", (i) => i.tx)
      .attr("y", (i) => i.ty)
      .attr("text-anchor", (i) => (i.flip ? "end" : "start"))
      .text((i) => i.d.language.name);
    merged.select<SVGLineElement>("line")
      .attr("x1", (i) => i.cx + (i.flip ? -i.radius : i.radius))
      .attr("y1", (i) => i.cy)
      .attr("x2", (i) => i.tx + (i.flip ? 3 : -3))
      .attr("y2", (i) => i.ty - 4)
      // Only where the label has been pushed away from its own point.
      .attr("opacity", (i) => (Math.abs(i.ty - 4 - i.cy) > 7 ? 0.5 : 0));
    labels.exit().remove();
  }

  /**
   * The trend, drawn with its own uncertainty. Never the curve alone: rho is
   * weak, and a bare line would assert more than the data carries.
   */
  function drawTrend(rows: Row[]): void {
    gTrend.selectAll("*").remove();
    const pts = loess(
      rows.map((d) => Math.log10(d.m.fertility)),
      rows.map((d) => Math.log10(d.language.speakers)),
      0.6,
      60
    );
    if (pts.length === 0) return;

    const px = (lx: number) => x(10 ** lx);
    const py = (ly: number) => y(10 ** ly);
    const clampY = (v: number) => Math.max(M.top, Math.min(H - M.bottom, v));

    const band =
      pts.map((p) => `${px(p.x)},${clampY(py(p.hi))}`).join(" ") +
      " " +
      [...pts].reverse().map((p) => `${px(p.x)},${clampY(py(p.lo))}`).join(" ");
    gTrend.append("polygon").attr("class", "trend-band").attr("points", band);
    gTrend.append("path")
      .attr("class", "trend-line")
      .attr("d", "M" + pts.map((p) => `${px(p.x)},${clampY(py(p.y))}`).join("L"));
  }

  function drawAxes(rows: Row[]): void {
    gGrid.selectAll("*").remove();
    gAxes.selectAll("*").remove();

    for (const tick of X_TICKS) {
      if (tick > x.domain()[1]) continue;
      const px = x(tick);
      gGrid.append("line")
        .attr("x1", px).attr("x2", px)
        .attr("y1", M.top).attr("y2", H - M.bottom)
        .attr("stroke", "var(--hairline)")
        .attr("stroke-opacity", tick === 1 ? 0.95 : 0.45)
        .attr("stroke-dasharray", tick === 1 ? "none" : "2 4");
      gAxes.append("text")
        .attr("x", px).attr("y", H - M.bottom + 22)
        .attr("text-anchor", "middle")
        .attr("class", "axis-tick")
        .text(tick === 1 ? "1× (English)" : `${tick}×`);
    }

    for (const tick of Y_TICKS) {
      const [lo, hi] = y.domain();
      if (tick < lo || tick > hi) continue;
      const py = y(tick);
      gGrid.append("line")
        .attr("x1", M.left).attr("x2", W - M.right)
        .attr("y1", py).attr("y2", py)
        .attr("stroke", "var(--hairline)")
        .attr("stroke-opacity", 0.45)
        .attr("stroke-dasharray", "2 4");
      gAxes.append("text")
        .attr("x", M.left - 12).attr("y", py + 4)
        .attr("text-anchor", "end")
        .attr("class", "axis-tick")
        .text(fmt.speakers(tick));
    }

    gAxes.append("text")
      .attr("x", M.left).attr("y", H - 16)
      .attr("class", "axis-title")
      .text("Tokens per sentence, relative to English — log scale");

    gAxes.append("text")
      .attr("transform", `translate(20 ${M.top + 8}) rotate(-90)`)
      .attr("text-anchor", "end")
      .attr("class", "axis-title")
      .text("Speakers — log scale");

    gAxes.append("text")
      .attr("x", W - M.right).attr("y", M.top - 10)
      .attr("text-anchor", "end")
      .attr("class", "axis-title")
      .text(`Tokenizer family: ${familyName()}`);

    // The correlation, stated rather than implied by a headline.
    const rho = spearman(
      rows.map((d) => Math.log10(d.language.speakers)),
      rows.map((d) => d.m.fertility)
    );
    gAxes.append("text")
      .attr("x", W - M.right).attr("y", M.top + 8)
      .attr("text-anchor", "end")
      .attr("class", "axis-note")
      .text(`Spearman ρ (log speakers, cost) = ${rho.toFixed(2)} — weak`);
  }

  function familyName(): string {
    const key = getState().tokenizer;
    return data.languages.tokenizers.find((t) => t.key === key)?.family ?? key;
  }

  function drawBarList(rows: Row[]): void {
    const sorted = [...rows].sort((a, b) => b.m.fertility - a.m.fertility).slice(0, 60);
    const max = sorted[0]?.m.fertility ?? 1;
    barListEl.innerHTML = `
      <p class="caption">Sorted by cost, highest first. Showing the 60 most expensive of ${rows.length} languages on ${familyName()}. Bar colour is the share of tokens above the language's floor.</p>
      <ol class="bars">
        ${sorted
          .map(
            (d) => `
          <li>
            <span class="bar-name">${d.language.name}</span>
            <span class="bar-track">
              <span class="bar-fill" style="width:${(d.m.fertility / max) * 100}%;background:${shareColour(d.neglectShare)}"></span>
            </span>
            <span class="bar-value tabular">${fmt.multiplier(d.m.fertility)}</span>
          </li>`
          )
          .join("")}
      </ol>`;
  }

  function summaryText(rows: Row[]): string {
    const over2 = rows.filter((d) => d.m.fertility > 2).length;
    const worst = rows.reduce((a, b) => (b.m.fertility > a.m.fertility ? b : a));
    const rho = spearman(
      rows.map((d) => Math.log10(d.language.speakers)),
      rows.map((d) => d.m.fertility)
    );
    return (
      `Scatter of ${rows.length} languages on the ${familyName()} tokenizer. ` +
      `${over2} cost more than twice what English costs for the same sentence. ` +
      `The most expensive is ${worst.language.name} at ${fmt.multiplier(worst.m.fertility)} English, ` +
      `with ${Math.round(worst.neglectShare * 100)}% of its tokens above its floor. ` +
      `Spearman rho between log speaker count and cost is ${rho.toFixed(2)}, a weak relationship.`
    );
  }

  function updateReadout(): void {
    if (!brushRange) {
      readoutEl.textContent = "";
      return;
    }
    const n = rowsFor().filter(
      (d) => d.m.fertility >= brushRange![0] && d.m.fertility <= brushRange![1]
    ).length;
    readoutEl.textContent =
      `${n} languages between ${fmt.multiplier(brushRange[0])} and ${fmt.multiplier(brushRange[1])} English`;
  }

  // ------------------------------------------------------------------- card

  function showCard(event: PointerEvent | FocusEvent, d: Row): void {
    const floor = d.language.floors?.flores ?? d.language.floor;
    cardEl.hidden = false;
    cardEl.dataset.pinned = pinned === d.language.code ? "true" : "false";
    cardEl.innerHTML = `
      <h3>${d.language.name} <code>${d.language.code}</code></h3>
      <p class="card-sub">${d.language.script} script · ${d.language.family} · ${d.language.region}</p>
      <dl>
        <div><dt>Cost</dt><dd class="tabular">${fmt.multiplierVsEnglish(d.m.fertility)}</dd></div>
        <div><dt>Tokens per sentence</dt><dd class="tabular">${fmt.tokens(d.m.tokens)}</dd></div>
        <div><dt>Floor</dt><dd class="tabular">${fmt.tokens(floor)}</dd></div>
        <div><dt>Above the floor</dt><dd class="tabular">${fmt.tokens(Math.max(d.m.tokens - floor, 0))} (${Math.round(d.neglectShare * 100)}%)</dd></div>
        <div><dt>Speakers</dt><dd class="tabular">${fmt.speakers(d.language.speakers)}</dd></div>
      </dl>
      ${pinned === d.language.code ? '<p class="card-pin">Pinned — click anywhere to release</p>' : ""}
    `;
    positionCard(event);
  }

  /**
   * Follow the cursor, flip near the edges, and never sit on top of the dot
   * being read.
   */
  function positionCard(event: PointerEvent | FocusEvent): void {
    if (cardEl.hidden) return;
    const bounds = figureEl.getBoundingClientRect();
    const card = cardEl.getBoundingClientRect();
    const gap = 16;

    let anchorX: number;
    let anchorY: number;
    let radius = 0;
    if ("clientX" in event && event.clientX) {
      anchorX = event.clientX - bounds.left;
      anchorY = event.clientY - bounds.top;
    } else {
      const dot = (event.target as Element).getBoundingClientRect();
      anchorX = dot.left - bounds.left + dot.width / 2;
      anchorY = dot.top - bounds.top + dot.height / 2;
      radius = dot.width / 2;
    }

    let left = anchorX + gap + radius;
    if (left + card.width > bounds.width) left = anchorX - card.width - gap - radius;
    left = Math.max(4, Math.min(left, bounds.width - card.width - 4));

    let top = anchorY - card.height / 2;
    top = Math.max(4, Math.min(top, bounds.height - card.height - 4));

    cardEl.style.left = `${left}px`;
    cardEl.style.top = `${top}px`;
  }

  function hideCard(): void {
    if (pinned) return;
    cardEl.hidden = true;
  }

  function unpin(): void {
    pinned = null;
    cardEl.dataset.pinned = "false";
    cardEl.hidden = true;
  }

  // Roving tabindex: the cloud is one tab stop, arrows move within it.
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
}

/**
 * Spearman rank correlation, ties averaged.
 *
 * Computed here from the same rows the chart plots rather than exported
 * separately, so the printed figure and the dots can never disagree.
 */
function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]): number[] => {
    const order = [...v.keys()].sort((a, b) => v[a] - v[b]);
    const out = new Array<number>(v.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && v[order[j + 1]] === v[order[i]]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) out[order[k]] = avg;
      i = j + 1;
    }
    return out;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  if (n < 3) return 0;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}
