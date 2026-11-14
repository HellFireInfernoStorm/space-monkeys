import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the browser talks to Vite on port 5173, and Vite passes /api to the back end.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
