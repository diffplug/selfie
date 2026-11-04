import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoadFailure, Loading, NotFound } from "./Status.tsx";
import { failure } from "./stories/fixtures.ts";

const meta = { title: "Pages/Status" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReadingARun: Story = { render: () => <Loading label="Reading the batch" /> };
export const NoSuchPage: Story = { render: () => <NotFound /> };
export const NoSuchBatch: Story = {
  render: () => <LoadFailure error={failure("unknown-batch", "No batch 4f8c2a10 in this project's local store.")} />,
};
export const ServerGone: Story = {
  render: () => <LoadFailure error={failure("unreachable", "Can't reach the Selfie server. Is selfie ui still running?")} />,
};
export const Dark: Story = { render: () => <NotFound />, parameters: { colorMode: "night" } };
export const OtherFailure: Story = {
  render: () => <LoadFailure error={failure("bad-response", "The server answered 500.")} />,
};
