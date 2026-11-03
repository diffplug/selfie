import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageFactsLine, type PageFacts } from "./PageFacts.tsx";
import { BASELINE_SHA, SHA } from "./stories/fixtures.ts";

const SETUP = { storybookDir: "storybook-static", buildCommand: null, uncommitted: [], builtFrom: "clean" as const, usesDocker: true };
const VIEW = { head: SHA, branch: "ui-selfie", storybookUrl: "http://127.0.0.1:1/", setup: SETUP };
const CONTEXT = { head: SHA, branch: "ui-selfie", mergeBase: BASELINE_SHA, defaultBranch: "main" };
const RUN = { gitSha: SHA, dirty: false, baselineSha: BASELINE_SHA };
const diff = (overrides: Partial<Extract<PageFacts, { kind: "diff" }>> = {}): PageFacts => ({ kind: "diff", run: RUN, branchGoldens: null, context: CONTEXT, ...overrides });

const SAYINGS: readonly PageFacts[] = [
  { kind: "view", view: VIEW },
  { kind: "view", view: { ...VIEW, branch: null } },
  { kind: "view", view: { ...VIEW, setup: { ...SETUP, builtFrom: "uncommitted" } } },
  { kind: "view", view: { ...VIEW, setup: { ...SETUP, builtFrom: "before-head" } } },
  { kind: "view", view: { ...VIEW, storybookUrl: null, setup: { ...SETUP, builtFrom: null } } },
  { kind: "view", view: { ...VIEW, head: null, storybookUrl: null } },
  diff(),
  diff({ context: { ...CONTEXT, mergeBase: "1".repeat(40) } }),
  diff({ context: { ...CONTEXT, head: "2".repeat(40) } }),
  diff({ run: { ...RUN, dirty: true } }),
  diff({ run: { ...RUN, baselineSha: null }, branchGoldens: BASELINE_SHA }),
  diff({ run: { ...RUN, baselineSha: null } }),
  diff({ context: null }),
];

const meta = { title: "Screens/Top bar" } satisfies Meta;
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
