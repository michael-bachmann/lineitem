import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "lineitem",
    description: "Match YNAB transactions to Amazon orders and categorize line items",
    // Pinned public key — derives a stable Chrome extension ID so the YNAB
    // OAuth redirect URI registration doesn't need updating across machines
    // or fresh installs. Safe to commit; this is the public half of the keypair.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtkJGQ2J6/qiSlDdRHLrauLgKxTeGx2W68jpk+0TPcebtbtdS7OaHxaN+CKTY8a5EUfFdpv/8LDfQC+L7xAjwsKihbagaWiOpe/dKsdzUYi3dUllzIJlDLlEhz9jEqumG6JyQVP6fq1S22+5bXLNCXRNM0vNDDTiq/2m8sytxCN9D5ufv0556uklIBJ/wQvqcCnp107gdYGs3x0ooVwxXZu035YJBLDoIriB/zmwsDoim1koahf9TKV1VqgzdlIt7Jx+sHIUvNA9IA1KGyvwE6Zp2eE6voT3haO2iInwj8QuEvDYmovW7piun5kXPICGXWqNQcjv3HPKhZxXSt3G+8wIDAQAB",
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
