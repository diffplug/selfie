import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Shell } from "./Shell.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell colorMode="auto">
      <App />
    </Shell>
  </StrictMode>,
);
