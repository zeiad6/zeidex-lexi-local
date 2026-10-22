/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Relative base: the same build works on GitHub Pages sub-paths, Vercel and Netlify.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // ES workers so the LLM worker can lazy-load WebLLM / Transformers.js as separate chunks.
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 8000 },
  // server/*.test.mjs use node:test and run via `node --test`.
  test: { include: ["src/**/*.test.ts"] },
});
