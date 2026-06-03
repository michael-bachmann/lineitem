import type { Preview } from "@storybook/react-vite";
import "@fontsource-variable/hanken-grotesk";
import "../entrypoints/sidepanel/style.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
  },
  // Wrap every story in the warm page canvas so tokens render in context.
  // (Done via a decorator rather than the version-churny `backgrounds` API.)
  decorators: [
    (Story) => (
      <div style={{ background: "var(--bg)", padding: 24, minHeight: "100vh" }}>
        <Story />
      </div>
    ),
  ],
};

export default preview;
