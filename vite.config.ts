import { defineConfig } from "vitest/config";

// Classic JSX bound to the `React` binding each module imports from ./rt — the
// host's React instance, never a bundled one.
const JSX = { runtime: "classic", pragma: "React.createElement", pragmaFrag: "React.Fragment" } as const;

export default defineConfig({
  oxc: { jsx: JSX },
  build: {
    lib: { entry: "src/index.tsx", formats: ["es"], fileName: "index" },
    // codeSplitting: false inlines the lazy `import("maplibre-gl")` into the
    // one dist/index.js — a separate chunk couldn't be resolved from a
    // `blob:` dev-folder load. (Rolldown's option; Rollup's equivalent,
    // `output.inlineDynamicImports`, is deprecated in this Vite version.)
    rollupOptions: { external: ["react", "react-dom"], output: { codeSplitting: false } },
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    // Without this, vitest skips CSS processing and the `?inline` import in
    // index.tsx resolves to an empty string instead of maplibre-gl's CSS.
    // Unanchored: this vitest version matches against the id with its
    // `?inline` query still attached, which a trailing `/\.css$/` misses.
    css: { include: [/\.css/] },
  },
});
