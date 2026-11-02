// Making a run its commit's goldens: what stops it, in plain words, and what it would drop.
import { ArrowLeftIcon } from "@primer/octicons-react";
import { Banner, Button, Checkbox, FormControl, Heading, Stack, Text } from "@primer/react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { AcceptRefusal, RunView } from "../shared/api.ts";
import { showQuery } from "./filter.ts";
import { useTitle, type RunState } from "./hooks.ts";
import { AppLink, runPath } from "./router.tsx";
import { ActionFailure, RunNotes } from "./RunNotes.tsx";
import { StoryLinks } from "./StoryLinks.tsx";
import { plural, ReusedPixels, shortSha } from "./words.tsx";

function Refusal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <Text as="p" weight="semibold">
        {title}
      </Text>
      {children}
    </li>
  );
}

/** Removal refusals are handled by the acknowledgment, unless the count someone gave was wrong. */
function refusalWords(refusal: AcceptRefusal, runId: string): ReactNode {
  switch (refusal.reason) {
    case "recorded-on-dirty-tree":
      return (
        <Refusal title="It was recorded on a dirty tree">
          <Text as="p">
            The tree had uncommitted changes while it rendered, so its images don't describe <code>{shortSha(refusal.gitSha)}</code>, even if the tree is clean now. Commit, run{" "}
            <code>selfie review</code>, and accept that run. Your approvals carry over.
          </Text>
        </Refusal>
      );
    case "run-has-failures":
      return (
        <Refusal title={`${plural(refusal.stories.length, "story", "stories")} failed to render`}>
          <Text as="p">A run with failures can't become goldens. Fix them, and run <code>selfie review</code> again.</Text>
          <StoryLinks runId={runId} stories={refusal.stories.map((story) => ({ story }))} show="failed" />
        </Refusal>
      );
    case "unapproved": {
      const rejected = refusal.stories.filter(({ decision }) => decision === "rejected").length;
      const undecided = refusal.stories.length - rejected;
      const parts = [undecided > 0 ? `${undecided} undecided` : null, rejected > 0 ? `${rejected} rejected` : null].filter(Boolean);
      return (
        <Refusal title={`${plural(refusal.stories.length, "image")} not approved: ${parts.join(", ")}`}>
          <Text as="p">Every changed or new image must be approved before this run can become goldens.</Text>
          <StoryLinks runId={runId} stories={refusal.stories} show={rejected > 0 && undecided === 0 ? "rejected" : "all"} />
        </Refusal>
      );
    }
    case "wrong-removed-count":
      return (
        <Refusal title="The number of removals changed">
          <Text as="p">
            You acknowledged {refusal.seen}, and there are {refusal.stories.length} now. Look at the list again.
          </Text>
        </Refusal>
      );
    case "removed-unacknowledged":
      return null;
  }
}

function Removals({ view, acknowledged, setAcknowledged }: { view: RunView; acknowledged: boolean; setAcknowledged: (value: boolean) => void }) {
  const { stories, outsideFilter } = view.removals;
  return (
    <Stack as="section" aria-labelledby="removals-heading" gap="condensed">
      <Heading as="h3" id="removals-heading" variant="small">
        Goldens this would drop: {stories.length}
      </Heading>
      <Text as="p">
        The baseline has {stories.length === 1 ? "this story" : "these stories"}, and this run doesn't. Accepting means {stories.length === 1 ? "its golden is" : "their goldens are"} gone from this commit on.
      </Text>
      {outsideFilter > 0 && (
        <Banner
          variant="warning"
          title={`${outsideFilter} of these are only outside this run's --story filter`}
          description="They weren't removed from the Storybook. A run without a filter may be what you want."
        />
      )}
      <StoryLinks runId={view.run.id} stories={stories.map((story) => ({ story }))} show="removed" />
      <FormControl>
        <Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        <FormControl.Label>
          I've looked at {stories.length === 1 ? "this removal" : `these ${stories.length} removals`}, and {stories.length === 1 ? "it's" : "they're"} right
        </FormControl.Label>
      </FormControl>
    </Stack>
  );
}

export function AcceptScreen({ state, view }: { state: RunState; view: RunView }) {
  const { run, refusals, removals, acceptedRunId, advisories } = view;
  const removedCount = removals.stories.length;
  const [acknowledged, setAcknowledged] = useState(false);
  const [lastRefusals, setLastRefusals] = useState<readonly AcceptRefusal[]>([]);
  // Whatever was acknowledged was a different list if the count has moved.
  useEffect(() => setAcknowledged(false), [removedCount]);

  useTitle(`Accept the run at ${shortSha(run.gitSha)}`);
  const isAccepted = acceptedRunId === run.id;
  const blocking = refusals.filter(({ reason }) => reason !== "removed-unacknowledged");
  const wrongCount = lastRefusals.filter(({ reason }) => reason === "wrong-removed-count");
  const shownRefusals = [...blocking, ...wrongCount];
  const needsAcknowledgment = removedCount > 0;
  const canAccept = blocking.length === 0 && (!needsAcknowledgment || acknowledged) && !isAccepted;

  const submit = async () => {
    const outcome = await state.accept(needsAcknowledgment ? removedCount : undefined);
    setLastRefusals(outcome?.accepted === false ? outcome.refusals : []);
  };

  return (
    <Stack gap="normal">
      <AppLink href={runPath(run.id)}>
        <ArrowLeftIcon /> Back to the run
      </AppLink>
      <Heading as="h2" variant="medium">
        Accept the run at <code title={run.gitSha}>{shortSha(run.gitSha)}</code>
      </Heading>
      <Text as="p">
        Accepting makes this run's images the goldens of <code>{shortSha(run.gitSha)}</code> in <code>{run.environment}</code>, for later reviews to compare with.
      </Text>
      {run.reusedFromRun !== null && (
        <Banner
          variant="info"
          title="This run didn't render"
          description={
            <>
              <ReusedPixels from={run.reusedFromRun} /> The build hadn't changed, so nothing rendered at <code>{shortSha(run.gitSha)}</code>.
            </>
          }
        />
      )}
      <ActionFailure state={state} />
      <RunNotes view={view} />
      {isAccepted ? (
        <Banner variant="success" title="Accepted" description={`These images are the goldens of ${shortSha(run.gitSha)}.`} />
      ) : (
        <>
          {acceptedRunId !== null && (
            <Banner
              variant="info"
              title="Another run is this commit's goldens"
              description={
                <>
                  Accepting this one replaces them with this run's images.{" "}
                  <AppLink inline href={runPath(acceptedRunId)}>
                    See that run
                  </AppLink>
                  .
                </>
              }
            />
          )}
          {shownRefusals.length > 0 ? (
            <Stack as="section" aria-labelledby="refusals-heading" gap="condensed">
              <Heading as="h3" id="refusals-heading" variant="small">
                Why this can't be accepted yet
              </Heading>
              <ul className="selfie-attention">
                {shownRefusals.map((refusal) => (
                  <Fragment key={refusal.reason}>{refusalWords(refusal, run.id)}</Fragment>
                ))}
              </ul>
            </Stack>
          ) : (
            <Banner
              variant="success"
              title="Nothing stops this run"
              description={needsAcknowledgment ? "Once you've acknowledged the removals below, it can be accepted." : "It can be accepted."}
            />
          )}
          {needsAcknowledgment && <Removals view={view} acknowledged={acknowledged} setAcknowledged={setAcknowledged} />}
          {advisories.length > 0 && (
            <Text as="p" className="selfie-muted">
              {plural(advisories.length, "advisory", "advisories")} on this run {advisories.length === 1 ? "doesn't" : "don't"} stop it, and {advisories.length === 1 ? "is" : "are"} listed on{" "}
              <AppLink inline href={runPath(run.id, showQuery("advisory"))}>
                the run's page
              </AppLink>
              .
            </Text>
          )}
          <Stack direction="horizontal">
            <Button variant="primary" disabled={!canAccept || state.busy} onClick={() => void submit()} loading={state.busy}>
              {needsAcknowledgment ? `Accept, dropping ${plural(removedCount, "golden")}` : "Accept this run"}
            </Button>
          </Stack>
        </>
      )}
    </Stack>
  );
}
