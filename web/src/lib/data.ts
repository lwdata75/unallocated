// SPDX-License-Identifier: MIT
/** Shapes of the pre-aggregated JSON the pipeline exports, plus the loader. */

export type CorpusKey = "flores" | "massive";

export interface TokenizerInfo {
  key: string;
  family: string;
  vocab: number;
  note: string;
}

export interface LanguageMetrics {
  tokens: number;
  fertility: number;
  p90: number;
  cpt: number;
  neglect: number;
}

export interface Language {
  code: string;
  name: string;
  script: string;
  family: string;
  region: string;
  speakers: number;
  floor: number;
  floors: Record<CorpusKey, number>;
  metrics: Partial<Record<CorpusKey, Record<string, LanguageMetrics>>>;
}

export interface LanguagesFile {
  meta: {
    generated: string;
    corpora: string[];
    n_sentences: Record<string, number>;
    pivot: string;
    note: string;
  };
  tokenizers: TokenizerInfo[];
  languages: Language[];
}

export interface SampleSentence {
  id: number;
  texts: Record<string, string>;
  /** tokens[lang][tokenizer] = cumulative character end-offsets, one per token. */
  tokens: Record<string, Record<string, number[]>>;
}

export interface SamplesFile {
  meta: { generated: string; source: string; encoding: string };
  languages: Array<{ code: string; name: string; script: string }>;
  sentences: SampleSentence[];
}

/** One generated figure, with the referent that makes it checkable. */
export interface Figure {
  key: string;
  text: string;
  claim: string;
  statistic: string;
  referent: Record<string, unknown>;
  value: number | null;
  values: Record<string, number>;
}

export interface HeadlineFile {
  generated: string;
  note: string;
  figures: Record<string, Figure>;
}

export interface SourceRow {
  key: string;
  kind: "corpus" | "tokenizer" | "font";
  canonical: string;
  resolved: string;
  revision: string;
  licence: string;
  spdx: string;
  retrieved: string;
  substituted: boolean;
  reason: string;
  verified_against: string;
  notes: string;
}

export interface SourcesFile {
  generated: string;
  note: string;
  sources: SourceRow[];
}

export interface Dataset {
  languages: LanguagesFile;
  samples: SamplesFile;
  headline: HeadlineFile;
  sources: SourcesFile;
  byCode: Map<string, Language>;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as T;
}

export async function loadDataset(): Promise<Dataset> {
  const [languages, samples, headline, sources] = await Promise.all([
    getJson<LanguagesFile>("data/languages.json"),
    getJson<SamplesFile>("data/samples.json"),
    getJson<HeadlineFile>("data/headline.json"),
    getJson<SourcesFile>("data/sources.json"),
  ]);
  const byCode = new Map(languages.languages.map((l) => [l.code, l]));
  return { languages, samples, headline, sources, byCode };
}

/**
 * Turn cumulative end-offsets back into token strings.
 *
 * Token k spans text[ends[k-1] .. ends[k]], with ends[-1] treated as 0. A span
 * can be empty: byte-level BPE splits multi-byte characters, and the pipeline
 * attributes the character to the token that completes it. Empty spans are real
 * tokens that carry no glyph, and the UI has to show them as such.
 */
export function slicePieces(text: string, ends: number[]): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  let prev = 0;
  for (const end of ends) {
    out.push(chars.slice(prev, end).join(""));
    prev = end;
  }
  return out;
}

/** ISO 15924 code from a FLORES code: `tel_Telu` -> `Telu`. Drives font stacks. */
export function scriptCode(languageCode: string): string {
  const parts = languageCode.split("_");
  return parts.length > 1 ? parts[1] : "Latn";
}
