import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// Note: `manifest.key` will be pinned in a follow-up so the Chrome extension
// ID stays stable across machines (required so YNAB's OAuth redirect URI
// registration doesn't need updating). Until pinned, the ID depends on the
// install location's path hash.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "lineitem",
    description: "Match YNAB transactions to Amazon orders and categorize line items",
    permissions: ["storage", "sidePanel", "tabs", "identity"],
    host_permissions: [
      "https://*.amazon.com/*",
      "https://api.ynab.com/*",
      "https://app.ynab.com/oauth/*",
      "https://auth.lineitem.dev/*",
      "https://huggingface.co/*",       // model metadata
      "https://*.huggingface.co/*",     // model file CDN (cdn-lfs.huggingface.co)
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
