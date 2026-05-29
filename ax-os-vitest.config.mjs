import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["ax-os-tests/**/*.test.mjs"],
    exclude: ["node_modules", "ax-os-dist", "Desktop", "Library", "Documents"],
    watch: false,
    pool: "forks",
    testTimeout: 10000,
  },
});
