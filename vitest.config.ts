import { defineConfig } from "vitest/config";

// environment: "node" is deliberate. The engine is DOM-free and must stay that
// way; anything that needs a document belongs in src/ui/ and is verified in a
// browser, not here. See CLAUDE.md.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
