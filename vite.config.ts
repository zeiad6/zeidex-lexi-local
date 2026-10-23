/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// WebLLM 0.2.86 (apache/tvm#18871) encodes a whole forward pass into one GPU command buffer. On phones
// that starves the system compositor, so the screen freezes during prefill and the GPU watchdog can kill
// the device mid-readback ("mapAsync ... unmapped before mapping was resolved"). Submit every few
// dispatches instead, as the pending upstream fix apache/tvm#19418 does.
const DISPATCHES_PER_SUBMIT = 8;
const DISPATCH_END = /compute\.dispatchWorkgroups\(workDim\[0\], workDim\[1\], workDim\[2\]\);\s*compute\.end\(\);/g;

function webLlmFlushPatch(): Plugin {
  return {
    name: "webllm-flush-patch",
    transform(code, id) {
      if (!id.includes("@mlc-ai/web-llm/lib/index.js")) return;
      const hits = code.match(DISPATCH_END)?.length ?? 0;
      // A WebLLM upgrade that moves this code must fail the build, not silently bring the freeze back.
      if (hits !== 1) throw new Error(`webllm-flush-patch: expected 1 dispatch site, found ${hits}; re-check apache/tvm#19418`);
      return {
        code: code.replace(DISPATCH_END, (m) => `${m} if (this.pendingDispatchCount >= ${DISPATCHES_PER_SUBMIT}) this.flushCommands();`),
        map: null,
      };
    },
  };
}

export default defineConfig({
  // Relative base: the same build works on GitHub Pages sub-paths, Vercel and Netlify.
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss(), webLlmFlushPatch()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Pre-bundled deps skip plugin transforms; keep WebLLM out so `npm run dev` gets the flush patch too.
  optimizeDeps: { exclude: ["@mlc-ai/web-llm"] },
  // ES workers so the LLM worker can lazy-load WebLLM / Transformers.js as separate chunks.
  worker: { format: "es", plugins: () => [webLlmFlushPatch()] },
  build: { target: "es2022", chunkSizeWarningLimit: 8000 },
  // server/*.test.mjs use node:test and run via `node --test`.
  test: { include: ["src/**/*.test.ts"] },
});
