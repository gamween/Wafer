import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  define: {
    global: "globalThis",
  },
  server: {
    fs: {
      // Allow importing the repo-root deployments/testnet.json (one level above web/).
      allow: [".."],
    },
  },
});
