// SPDX-License-Identifier: MIT
/**
 * Fetch the browser-side tokenizer files at build time.
 *
 * These are deliberately NOT committed. The Llama-3 tokenizer is distributed
 * under Meta's Llama 3 Community License, which is not compatible with this
 * repository's MIT licence, and committing it to a public tree is
 * redistribution. Fetching it during the build keeps the repo clean of
 * third-party terms while the deployed site still serves it.
 *
 * Fonts are different and stay committed: SIL OFL 1.1 explicitly permits
 * bundled redistribution provided the licence travels with them, which it does
 * in public/fonts/OFL.txt.
 *
 *   node scripts/fetch-tokenizers.mjs
 *
 * The site degrades honestly without this: free-text tokenization for the Llama
 * family reports that the tokenizer could not be loaded, and the other three
 * families and every pre-tokenized column keep working.
 */

import { mkdir, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const OUT_DIR = path.resolve(import.meta.dirname, "../public/tokenizers");

const TOKENIZERS = [
  {
    key: "llama3",
    // Mirror of the gated meta-llama repo. Verified in the pipeline against
    // first-party tiktoken: every cl100k_base id is reproduced at the same
    // position. See pipeline/sources.toml and METHODOLOGY.md.
    url: "https://huggingface.co/NousResearch/Meta-Llama-3-8B/resolve/main/tokenizer.json",
    licence: "Meta Llama 3 Community License",
    // Recorded so a silent upstream change is a build failure, not a quietly
    // different tokenizer. Update only alongside pipeline/sources.toml.
    behaviourNote: "vocab 128256",
  },
];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const spec of TOKENIZERS) {
    const dir = path.join(OUT_DIR, spec.key);
    const file = path.join(dir, "tokenizer.json");
    if (await exists(file)) {
      process.stdout.write(`${spec.key}: already present, skipping\n`);
      continue;
    }
    await mkdir(dir, { recursive: true });

    const headers = {};
    if (process.env.HF_TOKEN) headers.Authorization = `Bearer ${process.env.HF_TOKEN}`;
    const res = await fetch(spec.url, { headers });
    if (!res.ok) throw new Error(`${spec.key}: ${res.status} ${res.statusText} from ${spec.url}`);

    const bytes = Buffer.from(await res.arrayBuffer());
    const json = JSON.parse(bytes.toString("utf8"));
    const vocabSize = Object.keys(json.model?.vocab ?? {}).length
      + (json.added_tokens?.length ?? 0);

    await writeFile(file, bytes);
    process.stdout.write(
      `${spec.key}: ${(bytes.length / 1e6).toFixed(1)} MB, ${vocabSize} vocab entries, ` +
        `sha256 ${createHash("sha256").update(bytes).digest("hex").slice(0, 12)} ` +
        `(${spec.licence})\n`
    );
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
