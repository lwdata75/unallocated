import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    // The tokenizer chunks are deliberately large and deliberately lazy; the
    // warning would only train us to ignore it.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Only d3 is grouped. The tokenizer rank files must stay in the
          // separate chunks their dynamic imports create — grouping them would
          // mean loading all three OpenAI vocabularies to tokenize with one.
          if (id.includes("node_modules/d3")) return "d3";
          return undefined;
        },
      },
    },
  },
  // onnxruntime ships Node-only entry points that the browser build never
  // reaches; excluding them keeps the dev server from trying to pre-bundle them.
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
});
