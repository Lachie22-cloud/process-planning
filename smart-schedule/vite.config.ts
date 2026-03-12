import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.VITE_BASE_PATH || "/",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Only split out large, self-contained libraries to avoid circular deps
          if (id.includes("xlsx")) return "vendor-xlsx";
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("@tanstack")) return "vendor-tanstack";
          if (id.includes("react-router")) return "vendor-router";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/rest/v1": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rest\/v1/, ""),
      },
      "/auth/v1": {
        target: "http://localhost:9999",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/auth\/v1/, ""),
      },
      "/realtime/v1": {
        target: "http://localhost:4000",
        changeOrigin: true,
        ws: true,
        rewrite: (path) =>
          path.replace(/^\/realtime\/v1/, "").replace(/^\/websocket/, "/socket/websocket"),
      },
    },
  },
});
