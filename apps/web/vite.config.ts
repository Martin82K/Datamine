import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: mode === "connected" ? {
      "/v2": { target: "http://127.0.0.1:8000", changeOrigin: false },
    } : undefined,
  },
}));
