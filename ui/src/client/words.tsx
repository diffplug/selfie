// How states and refusals read on screen. A state always has words and an icon, never color alone.
import {
  AlertIcon,
  ArrowSwitchIcon,
  CheckIcon,
  ClockIcon,
  CommentIcon,
  DiffAddedIcon,
  DiffModifiedIcon,
  DiffRemovedIcon,
  DotIcon,
  PaperAirplaneIcon,
  PencilIcon,
  StopIcon,
  UnfoldIcon,
  XIcon,
} from "@primer/octicons-react";
import { Label, Stack, VisuallyHidden, type LabelProps } from "@primer/react";
import type { ReactNode } from "react";
import { isDecidable } from "selfie-store";
import type { BlockerReason, NoteState, PixelDiff, HunkKind, RenderRow, RenderState } from "../shared/api.ts";
import { isLayoutOnly } from "../shared/hunks.ts";
import { plural } from "../shared/plural.ts";
import { AppLink, batchPath } from "./router.tsx";

export const shortSha = (sha: string) => sha.slice(0, 10);

/** A commit, short, with the whole of it on hover. */
export const Sha = ({ sha }: { readonly sha: string }) => <code title={sha}>{shortSha(sha)}</code>;

/** A batch that didn't render: where its pixels came from, which every place that offers a decision on them must say. */
export function ReusedPixels({ from }: { readonly from: string }) {
  return (
    <>
      These pixels were rendered earlier, by batch{" "}
      <AppLink inline href={batchPath(from)}>
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

const STATE_LABELS: Readonly<Record<RenderState, { variant: LabelProps["variant"]; icon: ReactNode; words: string }>> = {
  changed: { variant: "attention", icon: <DiffModifiedIcon size={12} />, words: "Changed" },
  added: { variant: "accent", icon: <DiffAddedIcon size={12} />, words: "Added" },
  removed: { variant: "severe", icon: <DiffRemovedIcon size={12} />, words: "Removed" },
  failed: { variant: "danger", icon: <StopIcon size={12} />, words: "Failed" },
  unchanged: { variant: "secondary", icon: <DotIcon size={12} />, words: "Unchanged" },
};

export const renamedWords = (from: string) => `Renamed from ${from}`;

/** A state's icon and words, small enough for a list's row. */
export function StateMark({ state, renamedFrom }: { readonly state: RenderState; readonly renamedFrom?: string | undefined }) {
  const { icon, words } = renamedFrom === undefined ? STATE_LABELS[state] : { icon: <ArrowSwitchIcon size={12} />, words: renamedWords(renamedFrom) };
  return (
    <span className="selfie-state-mark" data-state={renamedFrom === undefined ? state : "renamed"} title={words}>
      {icon}
      <VisuallyHidden>{words}</VisuallyHidden>
    </span>
  );
}

const KIND_LABELS: Readonly<Record<HunkKind, { variant: LabelProps["variant"]; icon: ReactNode; words: string }>> = {
  changed: { variant: "danger", icon: <DiffModifiedIcon size={12} />, words: "Changed" },
  moved: { variant: "accent", icon: <ArrowSwitchIcon size={12} />, words: "Moved" },
  spacing: { variant: "attention", icon: <UnfoldIcon size={12} />, words: "Spacing" },
};

const NOTE_LABELS: Readonly<Record<NoteState, { variant: LabelProps["variant"]; icon: ReactNode; words: string }>> = {
  draft: { variant: "secondary", icon: <PencilIcon size={12} />, words: "Draft" },
  sent: { variant: "accent", icon: <PaperAirplaneIcon size={12} />, words: "Sent" },
  replied: { variant: "attention", icon: <CommentIcon size={12} />, words: "Agent replied" },
  resolved: { variant: "success", icon: <CheckIcon size={12} />, words: "Resolved" },
};

export function NoteLabel({ state }: { readonly state: NoteState }) {
  const { variant, icon, words } = NOTE_LABELS[state];
  return (
    <IconLabel variant={variant} icon={icon}>
      {words}
    </IconLabel>
  );
}

export function KindLabel({ kind }: { readonly kind: HunkKind }) {
  const { variant, icon, words } = KIND_LABELS[kind];
  return (
    <IconLabel variant={variant} icon={icon}>
      {words}
    </IconLabel>
  );
}

export function StateLabel({ state }: { readonly state: RenderState }) {
  const { variant, icon, words } = STATE_LABELS[state];
  return (
    <IconLabel variant={variant} icon={icon}>
      {words}
    </IconLabel>
  );
}

export function DecisionLabel({ row }: { readonly row: Pick<RenderRow, "state" | "decision"> }) {
  if (row.state === "failed") return <span className="selfie-muted">Can't be approved until it's fixed</span>;
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

type Size = { readonly width: number; readonly height: number };

export const sizeChanged = ({ current, golden }: PixelDiff) => current.width !== golden.width || current.height !== golden.height;

export const sizeChangeWords = (from: Size, to: Size) => `${from.width}×${from.height} to ${to.width}×${to.height}`;

export function describePixels(diff: PixelDiff | null): string {
  if (diff === null) return "";
  if (diff.hunks.length === 0) return "Nothing left to look at";
  const size = sizeChanged(diff) ? `, ${sizeChangeWords(diff.golden, diff.current)}` : "";
  if (isLayoutOnly(diff)) return `Moved and spacing only${size}`;
  const percent = (diff.changedPixels / diff.totalPixels) * 100;
  return `${plural(diff.changedPixels, "pixel")} (${percent < 0.01 ? "<0.01" : percent.toFixed(2)}%)${size}`;
}

export const BLOCKER_WORDS: Readonly<Record<BlockerReason, (count: number) => string>> = {
  failed: (count) => `${plural(count, "story", "stories")} failed`,
  "changed-unapproved": (count) => `${plural(count, "changed image")} with no decision`,
  "added-unapproved": (count) => `${plural(count, "added image")} with no decision`,
  rejected: (count) => `${plural(count, "image")} rejected`,
  removed: (count) => `${plural(count, "approved story", "approved stories")} this batch doesn't have, with no decision`,
  "pattern-unmatched": (count) => `${plural(count, "--story pattern")} that matched nothing`,
};
