import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoadFailure, Loading, NoRuns, NotFound } from "./Status.tsx";
import { BASELINE_SHA, failure, SHA } from "./stories/fixtures.ts";

const meta = { title: "Screens/Status" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReadingARun: Story = { render: () => <Loading label="Reading the run" /> };
export const NoSuchPage: Story = { render: () => <NotFound /> };
export const NoSuchRun: Story = {
  render: () => <LoadFailure error={failure("unknown-run", "No run 4f8c2a10 in this project's local store.")} />,
};
export const ServerGone: Story = {
  render: () => <LoadFailure error={failure("unreachable", "Can't reach the Selfie server. Is selfie ui still running?")} />,
};
export const OtherFailure: Story = {
  render: () => <LoadFailure error={failure("bad-response", "The server answered 500.")} />,
};
export const NoCommits: Story = {
  render: () => <NoRuns current={{ head: null, runId: null, hasUnfinishedRun: false, baseline: null }} />,
};
export const NoRunsAtHead: Story = {
  render: () => (
    <NoRuns
      current={{
        head: SHA,
        runId: null,
        hasUnfinishedRun: false,
        baseline: { sha: BASELINE_SHA, message: null },
      }}
    />
  ),
};
export const OnlyAnUnfinishedRun: Story = {
  render: () => <NoRuns current={{ head: SHA, runId: null, hasUnfinishedRun: true, baseline: null }} />,
};
