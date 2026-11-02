import "@primer/primitives/dist/css/primitives.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import { BaseStyles, ThemeProvider, type ThemeProviderProps } from "@primer/react";
import type { ReactNode } from "react";
import "./styles.css";

/** What the app and its stories both need around everything: Primer's theme, and our styles. */
export function Shell({ colorMode, children }: { readonly colorMode: ThemeProviderProps["colorMode"]; readonly children: ReactNode }) {
  return (
    <ThemeProvider colorMode={colorMode}>
      <BaseStyles>{children}</BaseStyles>
    </ThemeProvider>
  );
}
