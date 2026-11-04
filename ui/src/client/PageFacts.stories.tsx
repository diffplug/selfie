import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageFactsLine, type PageFacts } from "./PageFacts.tsx";
import { BASELINE_SHA, SHA } from "./stories/fixtures.ts";

const SETUP = { storybookDir: "storybook-static", buildCommand: null, uncommitted: [], builtBeforeHead: false, usesDocker: true };
const VIEW = { head: SHA, branch: "ui-selfie", storybookUrl: "http://127.0.0.1:1/", setup: SETUP };
const CONTEXT = { head: SHA, branch: "ui-selfie", mergeBase: BASELINE_SHA, defaultBranch: "main" };
const BATCH = { gitSha: SHA, dirty: false };
const diff = (overrides: Partial<Extract<PageFacts, { kind: "diff" }>> = {}): PageFacts => ({ kind: "diff", batch: BATCH, context: CONTEXT, ...overrides });

const SAYINGS: readonly PageFacts[] = [
  { kind: "view", view: VIEW },
  { kind: "view", view: { ...VIEW, branch: null } },
  { kind: "view", view: { ...VIEW, setup: { ...SETUP, uncommitted: ["src/Button.tsx"] } } },
  { kind: "view", view: { ...VIEW, setup: { ...SETUP, builtBeforeHead: true } } },
  { kind: "view", view: { ...VIEW, storybookUrl: null, setup: SETUP } },
  { kind: "view", view: { ...VIEW, head: null, storybookUrl: null } },
  diff(),
  diff({ context: { ...CONTEXT, head: "2".repeat(40) } }),
  diff({ batch: { ...BATCH, dirty: true } }),
  diff({ context: null }),
];

const meta = { title: "Parts/Top bar" } satisfies Meta;
export default meta;

export const EverythingItSays: StoryObj<typeof meta> = {
  render: () => (
    <ul>
      {SAYINGS.map((facts, at) => (
        <li key={at}>
          <PageFactsLine facts={facts} />
        </li>
      ))}
    </ul>
  ),
};
