// SPDX-License-Identifier: MIT
/**
 * The tile tooltip.
 *
 * Every tile already carried a `title`, which the browser shows after about a
 * second, in a system font, at the pointer, with no way to style it and no way
 * to say what index the token is. On a grid whose whole subject is "what is
 * inside one token", a one-second wait to find out is the wrong latency.
 *
 * So: one element for the whole page, delegated listeners on a single root, and
 * position driven by a CSS transition rather than by a rAF loop — the lag the
 * brief asks for is what a 90ms transition on `translate` gives you for free,
 * and it costs nothing on the scroll path.
 *
 * The `title` attributes stay. They are the fallback for touch, for anyone who
 * reaches a tile by keyboard, and for the case where this module never loads.
 */

const OFFSET_X = 14;
const OFFSET_Y = 18;

export function mountTileTip(root: HTMLElement): void {
  // Coarse pointers get the native behaviour: there is no hover to track, and a
  // tooltip that appears under a fingertip covers the thing it describes.
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const tip = document.createElement("div");
  tip.className = "tile-tip";
  tip.hidden = true;
  tip.setAttribute("aria-hidden", "true");
  document.body.append(tip);

  let current: HTMLElement | null = null;

  root.addEventListener(
    "pointerover",
    (event) => {
      const tile = (event.target as HTMLElement | null)?.closest<HTMLElement>(".tile");
      if (!tile || tile === current) return;
      current = tile;

      const index = indexOf(tile);
      const empty = tile.dataset.empty === "true";
      const label = empty
        ? "no character — a byte fragment of a character split across tokens"
        : tile.title || tile.textContent || "";

      tip.innerHTML =
        `<span class="tile-tip-index">token ${index}</span>` +
        `<span class="tile-tip-body${empty ? " is-empty" : ""}">${escapeHtml(label)}</span>`;
      tip.hidden = false;
      // Jump to the new tile rather than sliding across the grid from the last
      // one: the lag is meant to feel like weight, not like a cursor chase.
      tip.dataset.settled = "false";
      place(tip, event);
      requestAnimationFrame(() => {
        tip.dataset.settled = "true";
      });
    },
    { passive: true }
  );

  root.addEventListener(
    "pointermove",
    (event) => {
      if (!current) return;
      place(tip, event);
    },
    { passive: true }
  );

  root.addEventListener(
    "pointerout",
    (event) => {
      const to = (event as PointerEvent).relatedTarget as HTMLElement | null;
      if (to?.closest?.(".tile")) return;
      current = null;
      tip.hidden = true;
    },
    { passive: true }
  );

  // A tooltip pinned to a pointer that has left the page is a stuck artefact.
  window.addEventListener("blur", () => {
    current = null;
    tip.hidden = true;
  });
}

/**
 * Position in viewport coordinates, flipped near the right and bottom edges so
 * the tooltip never forces a scroll or falls off screen. `position: fixed` on
 * the tooltip means these are the right coordinates without any scroll maths.
 */
function place(tip: HTMLElement, event: PointerEvent): void {
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const x =
    event.clientX + OFFSET_X + w > window.innerWidth
      ? event.clientX - OFFSET_X - w
      : event.clientX + OFFSET_X;
  const y =
    event.clientY + OFFSET_Y + h > window.innerHeight
      ? event.clientY - OFFSET_Y - h
      : event.clientY + OFFSET_Y;
  tip.style.translate = `${Math.max(4, x)}px ${Math.max(4, y)}px`;
}

/** 1-based position of a tile within its own grid, which is what a reader
    counting tokens down a column is actually asking for. */
function indexOf(tile: HTMLElement): number {
  const siblings = tile.parentElement?.querySelectorAll(".tile");
  if (!siblings) return 1;
  return [...siblings].indexOf(tile) + 1;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
