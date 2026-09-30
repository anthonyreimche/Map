import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Not `new URL("../dist/index.js", import.meta.url)`: Vite statically
// recognises that exact literal pattern as an asset-URL import and rewrites it
// against the test environment's mocked http://localhost location instead of
// the real file, which fails every check below with "must be of scheme file".
const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

describe("built bundle (run `npm run build` first)", () => {
  it("exists", () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it("never reads import.meta — it is undefined in an installed plugin bundle", () => {
    expect(readFileSync(BUNDLE, "utf8").includes("import.meta")).toBe(false);
  });

  it("never imports React — the host injects it", () => {
    const src = readFileSync(BUNDLE, "utf8");
    expect(/from\s*["']react(-dom)?(\/[^"']*)?["']/.test(src)).toBe(false);
    expect(src.includes("jsx-runtime")).toBe(false);
  });
});
