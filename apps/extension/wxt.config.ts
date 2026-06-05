import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Absolute path to the installed transformers dist dir. Resolved relative to
// this config (apps/extension/) — pnpm symlinks the direct dependency into the
// app's own node_modules, so this URL points at apps/extension/node_modules/...
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
    // Each browser has its own stable-extension-ID mechanism, and each warns on
    // the other's — so they're mutually exclusive here:
    //  - Firefox: browser_specific_settings.gecko.id, which also pins the OAuth
    //    redirect URI (https://<id>.extensions.allizom.org/).
    //  - Chrome: the pinned public `key` (public half of the keypair, safe to
    //    commit), which derives a stable extension ID so the YNAB redirect-URI
    //    registration doesn't change across machines or fresh installs.
    ...(browser === "firefox"
      ? { browser_specific_settings: { gecko: { id: "lineitem@lineitem.dev" } } }
      : {
          key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtkJGQ2J6/qiSlDdRHLrauLgKxTeGx2W68jpk+0TPcebtbtdS7OaHxaN+CKTY8a5EUfFdpv/8LDfQC+L7xAjwsKihbagaWiOpe/dKsdzUYi3dUllzIJlDLlEhz9jEqumG6JyQVP6fq1S22+5bXLNCXRNM0vNDDTiq/2m8sytxCN9D5ufv0556uklIBJ/wQvqcCnp107gdYGs3x0ooVwxXZu035YJBLDoIriB/zmwsDoim1koahf9TKV1VqgzdlIt7Jx+sHIUvNA9IA1KGyvwE6Zp2eE6voT3haO2iInwj8QuEvDYmovW7piun5kXPICGXWqNQcjv3HPKhZxXSt3G+8wIDAQAB",
        }),
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
  // Copy the ONNX runtime files into the build at /ort/ for BOTH browsers.
  // Firefox loads them via env.backends.onnx.wasm.wasmPaths (set in the
  // embedder); Chrome's bundled glue fetches the .wasm from here via the
  // de-inline base below. Either way ORT loads locally instead of from the
  // jsDelivr CDN, which the extension CSP `script-src 'self'` blocks.
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
      // inlines as a ~28.8 MB data: URI. Neutralize the pattern (enforce:"pre",
      // before Vite's asset plugin) so the binary is never inlined, and point
      // the lookup at the /ort/ files copied above. This base is what Chrome's
      // statically-bundled glue uses to FETCH the wasm (Chrome can't set
      // wasmPaths — that would force a service-worker-illegal dynamic import).
      // Firefox doesn't reach this line at runtime (it sets wasmPaths and loads
      // the standalone /ort/ .mjs instead), but the expression stays valid there.
      {
        name: "ort-no-inline-wasm",
        enforce: "pre" as const,
        transform(code: string, id: string) {
          if (
            !id.includes("ort-wasm-simd-threaded.jsep.mjs") &&
            !id.includes("ort.bundle.min.mjs")
          )
            return null;
          const PATTERN = 'new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url)';
          const out = code.replaceAll(
            PATTERN,
            'new URL("ort-wasm-simd-threaded.jsep.wasm",(globalThis.chrome??globalThis.browser).runtime.getURL("ort/"))',
          );
          // Fail loudly if the upstream string drifts (e.g. an onnxruntime-web
          // bump changes whitespace/quoting): a silent no-op here re-inlines the
          // 21 MB wasm as a data: URI and balloons background.js back to ~56 MB
          // with no build error. Better a broken build than a 60x bundle.
          if (out === code) {
            throw new Error(
              `[ort-no-inline-wasm] expected ORT wasm-URL pattern not found in ${id}; ` +
                `onnxruntime-web likely changed — update PATTERN or the wasm will be re-inlined.`,
            );
          }
          return out;
        },
      },
    ],
  }),
});
