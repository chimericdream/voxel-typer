import { fileURLToPath } from "node:url";
import { preact } from "@preact/preset-vite";
import { defineConfig } from "vite";

/**
 * `vite build` makes the production build in `dist/`.
 * `vite build --mode test` makes the e2e build in `dist-test/`: same code, but
 * `import.meta.env.MODE === "test"`, so dev/test hooks (contracts.md §13) stay in.
 * `vite preview --mode test` serves that folder (Playwright's webServer does this).
 */
export default defineConfig(({ mode }) => ({
  plugins: [preact()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: mode === "test" ? "dist-test" : "dist",
    manifest: true,
    target: "es2023",
    sourcemap: mode === "test",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
}));
