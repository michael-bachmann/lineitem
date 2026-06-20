import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";

// Static multi-page site for Cloudflare — `vite build` emits to dist/. svgr lets
// the shared <Mark> import mark.svg?react (same setup as the extension). Two HTML
// entries: the landing page (/) and the privacy policy (/privacy).
export default defineConfig({
  plugins: [react(), tailwindcss(), svgr()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy/index.html", import.meta.url)),
      },
    },
  },
});
