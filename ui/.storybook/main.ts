import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  // Screens ask for images at the server's own paths, so these answer them with no change to a screen.
  staticDirs: ["../storybook-fixtures"],
  core: { disableTelemetry: true },
};

export default config;
