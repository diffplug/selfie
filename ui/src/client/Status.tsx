// The screens for when there's no run to show, and shared pieces of what a run's screens say.
import { AlertIcon, GitCommitIcon, QuestionIcon, ServerIcon } from "@primer/octicons-react";
import { Button, Spinner, Stack, Text } from "@primer/react";
import { Blankslate } from "@primer/react/experimental";
import type { CurrentView } from "../shared/api.ts";
import type { RequestError } from "./api.ts";
import { shortSha } from "./words.tsx";

export function Loading({ label }: { readonly label: string }) {
  return (
    <div className="selfie-center" role="status">
      <Stack direction="horizontal" align="center" gap="condensed">
        <Spinner size="small" srText={null} />
        <Text>{label}…</Text>
      </Stack>
    </div>
  );
}

export function NotFound() {
  return (
    <Blankslate border>
      <Blankslate.Visual>
        <QuestionIcon size="medium" />
      </Blankslate.Visual>
      <Blankslate.Heading as="h2">There's nothing at this address</Blankslate.Heading>
      <Blankslate.Description>It isn't a page of the review UI.</Blankslate.Description>
      <Blankslate.PrimaryAction href="/">
        Go to the newest run
      </Blankslate.PrimaryAction>
    </Blankslate>
  );
}

export function LoadFailure({ error }: { readonly error: RequestError }) {
  if (error.code === "unknown-run" || error.code === "bad-run-id") {
    return (
      <Blankslate border>
        <Blankslate.Visual>
          <QuestionIcon size="medium" />
        </Blankslate.Visual>
        <Blankslate.Heading as="h2">This project has no such run</Blankslate.Heading>
        <Blankslate.Description>
          A review's JSON gives its run ID as <code>runId</code>. Runs are local to this repository's store until they're pushed.
        </Blankslate.Description>
        <Blankslate.PrimaryAction href="/">
          Go to the newest run
        </Blankslate.PrimaryAction>
      </Blankslate>
    );
  }
  if (error.code === "run-not-finished") {
    return (
      <Blankslate border>
        <Blankslate.Visual>
          <AlertIcon size="medium" />
        </Blankslate.Visual>
        <Blankslate.Heading as="h2">This run never finished</Blankslate.Heading>
        <Blankslate.Description>
          A review is still recording it, or crashed part way through. A run that didn't finish can't be compared, so run{" "}
          <code>selfie review</code> again if nothing is recording now.
        </Blankslate.Description>
        <Blankslate.PrimaryAction href="/">
          Go to the newest run
        </Blankslate.PrimaryAction>
      </Blankslate>
    );
  }
  return (
    <Blankslate border>
      <Blankslate.Visual>
        <ServerIcon size="medium" />
      </Blankslate.Visual>
      <Blankslate.Heading as="h2">That didn't load</Blankslate.Heading>
      <Blankslate.Description>{error.message}</Blankslate.Description>
      <Stack direction="horizontal" justify="center">
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </Stack>
    </Blankslate>
  );
}

export function NoRuns({ current }: { readonly current: CurrentView }) {
  const { head, runs, baseline } = current;
  if (head === null) {
    return (
      <Blankslate border>
        <Blankslate.Visual>
          <GitCommitIcon size="medium" />
        </Blankslate.Visual>
        <Blankslate.Heading as="h2">This repository has no commits</Blankslate.Heading>
        <Blankslate.Description>A run is recorded against a Git SHA. Make a commit, then run selfie review.</Blankslate.Description>
      </Blankslate>
    );
  }
  return (
    <Blankslate border>
      <Blankslate.Visual>
        <GitCommitIcon size="medium" />
      </Blankslate.Visual>
      <Blankslate.Heading as="h2">No runs yet for {shortSha(head)}</Blankslate.Heading>
      <Blankslate.Description>
        {runs.length > 0
          ? "A review started here but hasn't finished. It's still recording, or it crashed. "
          : "Run selfie review to record one, then come back: this page doesn't render anything itself. "}
        {baseline.sha !== null
          ? `Its baseline will be ${shortSha(baseline.sha)}.`
          : (baseline.message ?? "There's no baseline yet, so every story will read as new.")}
      </Blankslate.Description>
      <Stack direction="horizontal" justify="center">
        <Button onClick={() => window.location.reload()}>Look again</Button>
      </Stack>
    </Blankslate>
  );
}
