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
    // atlas.html (M1-14), scene.html (M2-01), ui-kit.html (M2-07), keyboard.html (M2-09),
    // hud.html (M2-14) and lab.html (M4-02) are developer pages: in the e2e build, never in dist/.
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        ...(mode === "test" && {
          atlas: fileURLToPath(new URL("./atlas.html", import.meta.url)),
          scene: fileURLToPath(new URL("./scene.html", import.meta.url)),
          hello: fileURLToPath(new URL("./hello.html", import.meta.url)),
          uiKit: fileURLToPath(new URL("./ui-kit.html", import.meta.url)),
          keyboard: fileURLToPath(new URL("./keyboard.html", import.meta.url)),
          hud: fileURLToPath(new URL("./hud.html", import.meta.url)),
          lab: fileURLToPath(new URL("./lab.html", import.meta.url)),
        }),
      },
    },
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
