import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser }) => ({
    name: "lineitem",
    description: "Match YNAB transactions to Amazon orders and categorize line items",
    // Pinned Firefox extension ID — derives a stable Firefox OAuth redirect URI
    // (https://<uuid>.extensions.allizom.org/) so the YNAB redirect-URI
    // registration doesn't change across machines or reinstalls. Mirrors the
    // role the `key` field plays for Chrome.
    ...(browser === "firefox"
      ? { browser_specific_settings: { gecko: { id: "lineitem@lineitem.dev" } } }
      : {}),
    // Pinned public key — derives a stable Chrome extension ID so the YNAB
    // OAuth redirect URI registration doesn't need updating across machines
    // or fresh installs. Safe to commit; this is the public half of the keypair.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtkJGQ2J6/qiSlDdRHLrauLgKxTeGx2W68jpk+0TPcebtbtdS7OaHxaN+CKTY8a5EUfFdpv/8LDfQC+L7xAjwsKihbagaWiOpe/dKsdzUYi3dUllzIJlDLlEhz9jEqumG6JyQVP6fq1S22+5bXLNCXRNM0vNDDTiq/2m8sytxCN9D5ufv0556uklIBJ/wQvqcCnp107gdYGs3x0ooVwxXZu035YJBLDoIriB/zmwsDoim1koahf9TKV1VqgzdlIt7Jx+sHIUvNA9IA1KGyvwE6Zp2eE6voT3haO2iInwj8QuEvDYmovW7piun5kXPICGXWqNQcjv3HPKhZxXSt3G+8wIDAQAB",
    // `sidePanel` is Chrome-only; including it on Firefox triggers an "Unknown
    // permission" load warning and an AMO review flag. Firefox uses
    // sidebar_action (auto-generated from the sidepanel entrypoint) instead.
    permissions: [
      "storage",
      "tabs",
      "identity",
      ...(browser === "firefox" ? [] : ["sidePanel"]),
    ],
    // transformers.js runs the embedding model via WebAssembly, which Chrome
    // MV3 blocks unless we explicitly opt in. `wasm-unsafe-eval` allows WASM
    // compilation only — it does NOT re-enable arbitrary eval().
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    host_permissions: [
      "https://*.amazon.com/*",
      "https://api.ynab.com/*",
      "https://app.ynab.com/oauth/*",
      "https://auth.lineitem.dev/*",
      "https://huggingface.co/*",       // model metadata
      "https://*.huggingface.co/*",     // model file CDN (cdn-lfs.huggingface.co)
    ],
  }),
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
