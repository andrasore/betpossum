import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Component-level tests run in jsdom against the same `@/` alias the app uses
// (mirrored from tsconfig `paths`). The heavy full-stack flows live in `/e2e`;
// this layer is for pure render/state logic only.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
