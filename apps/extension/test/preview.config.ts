import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@channelpilot/shared": fileURLToPath(
        new URL("../../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
