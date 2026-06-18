import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5000",
      "/auth": "http://127.0.0.1:5000",
      "/logout": "http://127.0.0.1:5000",
      "/logo.svg": "http://127.0.0.1:5000",
      "/favicon.svg": "http://127.0.0.1:5000"
    }
  },
  build: {
    outDir: "static/react-app",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/main.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "assets/main.css";
          }
          return "assets/[name][extname]";
        }
      }
    }
  }
});
