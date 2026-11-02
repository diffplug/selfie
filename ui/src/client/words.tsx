// How states and refusals read on screen. A state always has words and an icon, never color alone.
import {
  AlertIcon,
  ArrowSwitchIcon,
  CheckIcon,
  ClockIcon,
  DiffAddedIcon,
  DiffModifiedIcon,
  DiffRemovedIcon,
  DotIcon,
  StopIcon,
  UnfoldIcon,
  XIcon,
} from "@primer/octicons-react";
import { Label, Stack, type LabelProps } from "@primer/react";
import type { ReactNode } from "react";
import { isDecidable } from "selfie-store";
import type { BlockerReason, PixelDiff, RegionKind, SnapshotRow, SnapshotState } from "../shared/api.ts";
import { isLayoutOnly } from "../shared/regions.ts";
import { plural } from "./plural.ts";
import { AppLink, runPath } from "./router.tsx";

export const shortSha = (sha: string) => sha.slice(0, 10);

/** A run that didn't render: where its pixels came from, which every place that offers a decision on them must say. */
export function ReusedPixels({ from }: { readonly from: string }) {
  return (
    <>
      These pixels were rendered earlier, by run{" "}
      <AppLink inline href={runPath(from)}>
        <code>{from}</code>
      </AppLink>
      .
    </>
  );
}

function IconLabel({ variant, icon, children }: { variant: LabelProps["variant"]; icon: ReactNode; children: ReactNode }) {
  return (
    <Label variant={variant}>
      <Stack as="span" direction="horizontal" gap="condensed" align="center">
        {icon}
        <span>{children}</span>
      </Stack>
    </Label>
  );
}

const STATE_LABELS: Readonly<Record<SnapshotState, { variant: LabelProps["variant"]; icon: ReactNode; words: string }>> = {
  changed: { variant: "attention", icon: <DiffModifiedIcon size={12} />, words: "Changed" },
  new: { variant: "accent", icon: <DiffAddedIcon size={12} />, words: "New" },
  removed: { variant: "severe", icon: <DiffRemovedIcon size={12} />, words: "Removed" },
  failed: { variant: "danger", icon: <StopIcon size={12} />, words: "Failed" },
  unchanged: { variant: "secondary", icon: <DotIcon size={12} />, words: "Unchanged" },
};

const KIND_LABELS: Readonly<Record<RegionKind, { variant: LabelProps["variant"]; icon: ReactNode; words: string }>> = {
  changed: { variant: "danger", icon: <DiffModifiedIcon size={12} />, words: "Changed" },
  moved: { variant: "accent", icon: <ArrowSwitchIcon size={12} />, words: "Moved" },
  spacing: { variant: "attention", icon: <UnfoldIcon size={12} />, words: "Spacing" },
};

export function KindLabel({ kind }: { readonly kind: RegionKind }) {
  const { variant, icon, words } = KIND_LABELS[kind];
  return (
    <IconLabel variant={variant} icon={icon}>
      {words}
    </IconLabel>
  );
}

export function StateLabel({ state }: { readonly state: SnapshotState }) {
  const { variant, icon, words } = STATE_LABELS[state];
  return (
    <IconLabel variant={variant} icon={icon}>
      {words}
    </IconLabel>
  );
}

export function DecisionLabel({ row }: { readonly row: SnapshotRow }) {
  if (!isDecidable(row.state)) return <span className="selfie-muted">No decision needed</span>;
  if (row.decision?.decision === "approved") {
    return (
      <IconLabel variant="success" icon={<CheckIcon size={12} />}>
        Approved
      </IconLabel>
    );
  }
  if (row.decision?.decision === "rejected") {
    return (
      <IconLabel variant="danger" icon={<XIcon size={12} />}>
        Rejected
      </IconLabel>
    );
  }
  return (
    <IconLabel variant="secondary" icon={<ClockIcon size={12} />}>
      Undecided
    </IconLabel>
  );
}

export function AdvisoryLabels({ row }: { readonly row: SnapshotRow }) {
  return (
    <>
      {row.playError !== null && (
        <IconLabel variant="attention" icon={<AlertIcon size={12} />}>
          Play error
        </IconLabel>
      )}
    </>
  );
}

export const sizeChanged = ({ current, golden }: PixelDiff) => current.width !== golden.width || current.height !== golden.height;

export function describePixels(diff: PixelDiff | null): string {
  if (diff === null) return "";
  const size = sizeChanged(diff) ? `, ${diff.golden.width}×${diff.golden.height} to ${diff.current.width}×${diff.current.height}` : "";
  if (isLayoutOnly(diff)) return `Moved and spacing only${size}`;
  const percent = (diff.changedPixels / diff.totalPixels) * 100;
  return `${plural(diff.changedPixels, "pixel")} (${percent < 0.01 ? "<0.01" : percent.toFixed(2)}%)${size}`;
}

export const BLOCKER_WORDS: Readonly<Record<BlockerReason, (count: number) => string>> = {
  failed: (count) => `${plural(count, "story", "stories")} failed to render`,
  "changed-unapproved": (count) => `${plural(count, "changed image")} with no decision`,
  "new-unapproved": (count) => `${plural(count, "new image")} with no decision`,
  rejected: (count) => `${plural(count, "image")} rejected`,
  removed: (count) => `${plural(count, "golden")} this run doesn't have, which must be acknowledged to accept`,
  "pattern-unmatched": (count) => `${plural(count, "--story pattern")} that matched nothing`,
};
