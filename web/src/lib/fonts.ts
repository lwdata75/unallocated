/**
 * Per-script font loading.
 *
 * Correct script rendering is a functional requirement — a Telugu column in a
 * fallback font is a broken hero, and on a machine with no Ethiopic font
 * installed it is a row of boxes. But the study covers thirty writing systems,
 * and shipping every `@font-face` up front is ~390 KB of rules a given visitor
 * will never use. So each script gets its own stylesheet, requested the first
 * time a language using it appears on screen.
 */

const requested = new Set<string>();

/** Latin is carried by the UI and data faces; there is no `Script Latn`. */
const BUILT_IN = new Set(["Latn"]);

export function ensureScriptFont(script: string): void {
  if (!script || BUILT_IN.has(script) || requested.has(script)) return;
  requested.add(script);

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `fonts/script-${script}.css`;
  // A missing stylesheet must not be silent: it means a language renders as
  // tofu, which is the one failure mode this whole mechanism exists to prevent.
  link.addEventListener("error", () => {
    console.error(`[fonts] no stylesheet for script ${script}; text will fall back`);
  });
  document.head.append(link);
}

/** Resolves once the face for a script has actually loaded, for measurement. */
export async function scriptFontReady(script: string): Promise<void> {
  if (BUILT_IN.has(script)) return;
  ensureScriptFont(script);
  try {
    await document.fonts.load(`12px "Script ${script}"`);
  } catch {
    /* the error listener above already reported it */
  }
}
