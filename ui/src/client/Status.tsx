// The screens for when there's nothing to show.
import { AlertIcon, QuestionIcon, ServerIcon, type Icon } from "@primer/octicons-react";
import { Button, Spinner, Stack, Text } from "@primer/react";
import { Blankslate } from "@primer/react/experimental";
import type { ReactNode } from "react";
import type { RequestError } from "./api.ts";
import { AppLinkButton } from "./router.tsx";

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

function Blank({ icon: Visual, title, action, children }: { icon: Icon; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Blankslate border>
      <Blankslate.Visual>
        <Visual size="medium" />
      </Blankslate.Visual>
      <Blankslate.Heading as="h2">{title}</Blankslate.Heading>
      <Blankslate.Description>{children}</Blankslate.Description>
      {action !== undefined && (
        <Stack direction="horizontal" justify="center" className="selfie-blank-action">
          {action}
        </Stack>
      )}
    </Blankslate>
  );
}

const TO_EVERY_STORY = (
  <AppLinkButton variant="primary" href="/">
    Go to every story
  </AppLinkButton>
);

const reload = () => window.location.reload();

export function NotFound() {
  return (
    <Blank icon={QuestionIcon} title="There's nothing at this address" action={TO_EVERY_STORY}>
      It isn't a page of the review UI.
    </Blank>
  );
}

export function LoadFailure({ error }: { readonly error: RequestError }) {
  if (error.code === "unknown-run" || error.code === "bad-run-id") {
    return (
      <Blank icon={QuestionIcon} title="This project has no such run" action={TO_EVERY_STORY}>
        A review's JSON gives its run ID as <code>runId</code>. Runs are local to this repository's store until they're pushed.
      </Blank>
    );
  }
  if (error.code === "run-not-finished") {
    return (
      <Blank icon={AlertIcon} title="This run never finished" action={TO_EVERY_STORY}>
        A review is still recording it, or crashed part way through. A run that didn't finish can't be compared, so run{" "}
        <code>selfie review</code> again if nothing is recording now.
      </Blank>
    );
  }
  return (
    <Blank icon={ServerIcon} title="That didn't load" action={<Button onClick={reload}>Try again</Button>}>
      {error.message}
    </Blank>
  );
}
