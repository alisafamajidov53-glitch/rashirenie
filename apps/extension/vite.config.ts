import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import manifest from "./manifest.js";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    // `CHANNELPILOT_SOURCEMAP=hidden` writes .map files without referencing
    // them from the bundle, so a production stack trace from a user report can
    // be mapped back to source. Off by default: maps must not ship in the zip.
    sourcemap: process.env.CHANNELPILOT_SOURCEMAP === "hidden" ? "hidden" : false,
    target: "chrome120",
    rollupOptions: {
      input: { mediaBridge: "src/media-bridge/index.html" },
    },
  },
});
