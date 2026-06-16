import type { StorybookConfig } from "@storybook/react-vite";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(tsx|ts)"],
  addons: ["@storybook/addon-a11y"],
  framework: { name: "@storybook/react-vite", options: {} },
  async viteFinal(cfg) {
    cfg.plugins = cfg.plugins ?? [];
    cfg.plugins.push(tailwindcss());
    cfg.plugins.push(svgr()); // shared <Mark> imports mark.svg?react
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.alias = {
      ...(cfg.resolve.alias ?? {}),
      "@": fileURLToPath(new URL("../src", import.meta.url)),
    };
    return cfg;
  },
};

export default config;
