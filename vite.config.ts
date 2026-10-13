import { hostname } from "node:os";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  plugins: [react()],
  server: {
    port: 4813,
    strictPort: true,
    allowedHosts: [hostname(), ".ts.net"],
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
