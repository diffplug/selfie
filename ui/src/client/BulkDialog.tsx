// The confirmation every decision on many images goes through.
import { ConfirmationDialog, Stack, Text } from "@primer/react";
import { ScrollableRegion } from "@primer/react/experimental";
import type { ReactNode } from "react";
import type { DecisionKind, RenderRow } from "../shared/api.ts";
import { plural } from "../shared/plural.ts";

export function BulkDialog({
  decision,
  rows,
  why,
  onClose,
}: {
  decision: DecisionKind;
  /** Each decidable, as they were when the dialog opened, which is exactly what gets sent. */
  rows: readonly RenderRow[];
  /** What's being decided on, and how it came to be these. */
  why: ReactNode;
  onClose: (confirmed: boolean) => void;
}) {
  const verb = decision === "approved" ? "Approve" : "Reject";
  const count = (test: (row: RenderRow) => boolean) => rows.filter(test).length;
  const facts = [
    [count(({ state }) => state === "changed"), "changed"],
    [count(({ state }) => state === "added"), "added"],
    [count(({ decision: made }) => made?.decision === "approved"), "already approved"],
    [count(({ decision: made }) => made?.decision === "rejected"), "already rejected"],
  ] as const;
  return (
    <ConfirmationDialog
      title={`${verb} ${plural(rows.length, "image")}?`}
      confirmButtonContent={`${verb} ${plural(rows.length, "image")}`}
      cancelButtonContent="Cancel"
      confirmButtonType="danger"
      width="large"
      onClose={(gesture) => onClose(gesture === "confirm")}
    >
      <Stack gap="condensed">
        <Text as="p">
          {why}{" "}
          A decision on an image holds in later batches too, until it's replaced.
        </Text>
        <ul className="selfie-bulk-facts">
          {facts
            .filter(([value]) => value > 0)
            .map(([value, words]) => (
              <li key={words}>
                {value.toLocaleString()} {words}
              </li>
            ))}
        </ul>
        <ScrollableRegion className="selfie-bulk-sample" aria-label="The images this decides on">
          {rows.slice(0, 200).map(({ story }) => (
            <div key={story}>{story}</div>
          ))}
          {rows.length > 200 && <div className="selfie-muted">and {rows.length - 200} more</div>}
        </ScrollableRegion>
      </Stack>
    </ConfirmationDialog>
  );
}
