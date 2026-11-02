import type { Preview } from "@storybook/react-vite";
import { Page } from "../src/client/App.tsx";
import { Shell } from "../src/client/Shell.tsx";

const preview: Preview = {
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story, { parameters }) => {
      const dark = parameters["colorMode"] === "night";
      // What `ui/index.html` says on these elements, since Primer's themes and link rules read them.
      const root = document.documentElement.dataset;
      root["colorMode"] = dark ? "dark" : "light";
      root["lightTheme"] = "light";
      root["darkTheme"] = "dark";
      document.body.dataset["a11yLinkUnderlines"] = "true";
      return (
        <Shell colorMode={dark ? "night" : "day"}>
          <Page>
            <Story />
          </Page>
        </Shell>
      );
    },
  ],
};

export default preview;
