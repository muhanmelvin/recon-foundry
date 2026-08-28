import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// BASE_PATH lets the same build serve from a sub-path or from the root.
//   - Serving at https://<app>.<domain>/          → leave unset (defaults to "/")
//   - Serving at https://<user>.github.io/<repo>/ → BASE_PATH=/<repo>/
// The CI workflow sets it; see .github/workflows/ci.yml.
//
// SINGLE_FILE=1 inlines everything into one index.html — the "download it and
// open it offline" distribution.
const single = process.env.SINGLE_FILE === "1";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: single ? [viteSingleFile()] : [],
  build: {
    outDir: single ? "dist-single" : "dist",
    target: "es2020",
    sourcemap: false,
    assetsInlineLimit: single ? 100_000_000 : 4096,
  },
  server: { port: 5173 },
});
