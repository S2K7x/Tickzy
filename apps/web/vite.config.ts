/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { WEB_SECURITY_HEADERS } from "./security-headers.ts";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ws: true forwards the realtime WebSocket (/v1/realtime); `vite preview` reuses this proxy.
  server: { port: 5173, proxy: { "/v1": { target: "http://localhost:3000", ws: true } } },
  // The production build is previewed with the production security headers (T-110); the dev server is not (HMR
  // needs inline scripts).
  preview: { headers: WEB_SECURITY_HEADERS },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], css: false },
});
