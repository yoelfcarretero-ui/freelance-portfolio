import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Tests must never reach a paid API: force demo mode regardless of the shell env.
    env: { DEMO_MODE: "true" },
  },
});
