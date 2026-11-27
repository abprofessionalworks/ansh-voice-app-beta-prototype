import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, forward API and WebSocket calls to the FastAPI backend.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8000", ws: true },
    },
  },
});
