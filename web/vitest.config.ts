/// <reference types="vitest" />
import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["src/**/*.stories.{ts,tsx}", "node_modules"],
  },
})
