// SPDX-License-Identifier: MIT
/**
 * Client-side tokenization, for free text only.
 *
 * First paint needs none of this: samples.json ships pre-tokenized boundaries
 * for every showcase language against all eight families, so the hero renders
 * with zero tokenizer JS. A tokenizer is fetched only when someone types, only
 * for the family currently selected, and never more than once.
 *
 * Four families run in the browser. The three OpenAI encodings come from
 * js-tiktoken as small rank files; Llama-3 is read from the same bare
 * tokenizer.json the pipeline used, through a tokenizers-only fork of
 * transformers.js. The full transformers.js package would have dragged in a
 * 21 MB ONNX runtime to do inference we never ask for.
 *
 * These functions return the *same* representation samples.json uses —
 * cumulative code-point end offsets, one per token — so free text and the
 * pre-tokenized columns render through one code path and cannot drift apart.
 */

export const FREE_TEXT_FAMILIES = new Set(["gpt2", "cl100k", "o200k", "llama3"]);

/** Served from this site, not from a third-party CDN. */
const LLAMA3_TOKENIZER_URL = "tokenizers/llama3/tokenizer.json";

/** text -> cumulative code-point end offsets, one entry per token. */
export type Tokenizer = (text: string) => number[];

const cache = new Map<string, Promise<Tokenizer>>();

export function supportsFreeText(key: string): boolean {
  return FREE_TEXT_FAMILIES.has(key);
}

export function getTokenizer(key: string): Promise<Tokenizer> {
  let pending = cache.get(key);
  if (!pending) {
    pending = load(key).catch((err: unknown) => {
      // Do not cache a rejection: a transient network failure should not
      // permanently disable the input.
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return pending;
}

/**
 * Walk the token ids, decoding each prefix and counting how many characters are
 * *complete* at that point.
 *
 * Byte-level BPE regularly splits a multi-byte character across two tokens, so
 * decoding a single token in isolation returns a replacement character rather
 * than a glyph. Decoding prefixes instead attributes the character to the token
 * that completes it and leaves the earlier token with an empty span — exactly
 * what the Python pipeline does by walking byte offsets, and exactly what the
 * tile field needs in order to draw continuation tiles honestly.
 */
function cumulativeEnds(ids: number[], decode: (slice: number[]) => string): number[] {
  const ends: number[] = [];
  let previous = 0;
  for (let k = 1; k <= ids.length; k += 1) {
    const complete = countComplete(decode(ids.slice(0, k)));
    previous = Math.max(complete, previous);
    ends.push(previous);
  }
  return ends;
}

/** Code points, ignoring a trailing replacement char left by a partial decode. */
function countComplete(text: string): number {
  const chars = Array.from(text);
  let n = chars.length;
  while (n > 0 && chars[n - 1] === "�") n -= 1;
  return n;
}

async function load(key: string): Promise<Tokenizer> {
  if (key === "llama3") return loadLlama3();
  return loadTiktoken(key);
}

async function loadTiktoken(key: string): Promise<Tokenizer> {
  const { Tiktoken } = await import("js-tiktoken/lite");
  // Static specifiers: a templated import cannot be analysed by the bundler and
  // silently falls back to a runtime resolution that does not exist.
  const ranks = await (key === "gpt2"
    ? import("js-tiktoken/ranks/r50k_base")
    : key === "cl100k"
      ? import("js-tiktoken/ranks/cl100k_base")
      : import("js-tiktoken/ranks/o200k_base"));
  const enc = new Tiktoken(ranks.default);
  return (text: string) => cumulativeEnds(enc.encode(text), (slice) => enc.decode(slice));
}

async function loadLlama3(): Promise<Tokenizer> {
  const { TokenizerLoader } = await import("@lenml/tokenizers");
  const res = await fetch(LLAMA3_TOKENIZER_URL);
  if (!res.ok) throw new Error(`llama3 tokenizer: ${res.status}`);
  const tokenizerJSON = await res.json();
  const tok = TokenizerLoader.fromPreTrained({ tokenizerJSON, tokenizerConfig: {} });
  return (text: string) => {
    const ids = tok.encode(text, { add_special_tokens: false }) as number[];
    return cumulativeEnds(ids, (slice) => tok.decode(slice, { skip_special_tokens: true }));
  };
}
