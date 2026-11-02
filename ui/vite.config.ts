import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Primer alone is past Vite's warning size, and this bundle is only ever read from loopback.
    chunkSizeWarningLimit: 2000,
  },
});
