import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Itemize",
    description: "Match YNAB transactions to Amazon orders and categorize line items",
    permissions: ["storage", "sidePanel", "tabs"],
    host_permissions: [
      "https://*.amazon.com/*",
      "https://api.ynab.com/*",
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
