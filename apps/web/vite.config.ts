/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ws: true forwards the realtime WebSocket (/v1/realtime); `vite preview` reuses this proxy.
  server: { port: 5173, proxy: { "/v1": { target: "http://localhost:3000", ws: true } } },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], css: false },
});
