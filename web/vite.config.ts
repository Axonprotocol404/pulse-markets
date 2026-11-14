import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages project site: https://axonprotocol404.github.io/pulse-markets/
export default defineConfig({
  plugins: [react()],
  base: "/pulse-markets/",
  build: { chunkSizeWarningLimit: 4096 },
});
