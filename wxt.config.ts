import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Absolute path to the installed transformers dist dir (direct dependency, so
// it's hoisted to the project-root node_modules).
const ORT_DIST = fileURLToPath(
  new URL("node_modules/@huggingface/transformers/dist/", import.meta.url),
);
const ORT_FILES = [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

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
  // Copy the ONNX runtime files into the build at /ort/ for BOTH browsers. The
  // embedder points env.backends.onnx.wasm.wasmPaths here so Firefox (MV2
  // classic background script) stops falling back to the jsDelivr CDN, which the
  // extension CSP `script-src 'self'` blocks.
  hooks: {
    "build:publicAssets"(_wxt, assets) {
      for (const f of ORT_FILES) {
        assets.push({ absoluteSrc: ORT_DIST + f, relativeDest: `ort/${f}` });
      }
    },
  },
  vite: () => ({
    plugins: [
      tailwindcss(),
      // De-inline the 21 MB ORT wasm. The glue locates its binary with
      // `new URL("...jsep.wasm", import.meta.url)`, which Vite resolves and
      // inlines as a ~28.8 MB data: URI. We load the wasm from /ort/ via
      // wasmPaths instead, so neutralize the pattern (enforce:"pre", before
      // Vite's asset plugin) so the binary is never inlined.
      {
        name: "ort-no-inline-wasm",
        enforce: "pre" as const,
        transform(code: string, id: string) {
          if (
            !id.includes("ort-wasm-simd-threaded.jsep.mjs") &&
            !id.includes("ort.bundle.min.mjs")
          )
            return null;
          return code.replaceAll(
            'new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url)',
            'new URL("ort-wasm-simd-threaded.jsep.wasm",globalThis.location?.href??"https://invalid.invalid/")',
          );
        },
      },
    ],
  }),
});
