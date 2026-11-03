// What stands between someone and a story saved at the commit they're on, on the page they land on.
import { CheckCircleFillIcon, CircleIcon } from "@primer/octicons-react";
import { Banner, Button, Heading, Stack, Text } from "@primer/react";
import { useEffect, type ReactNode } from "react";
import type { ListedStory, StoriesView, StorySetup } from "../shared/api.ts";
import type { CaptureState } from "./hooks.ts";
import { plural } from "./plural.ts";
import { anyStoryPath, navigate } from "./router.tsx";
import { shortSha } from "./words.tsx";

const STAGES = ["commit", "build", "stories", "save"] as const;
type Stage = (typeof STAGES)[number];

/** How far from a saved story this commit is, or null if it has one, or this server hosts no Storybook to say of. */
export function setupStage(view: StoriesView): Stage | null {
  if (view.setup === null || view.stories.some(({ capture }) => capture !== null)) return null;
  if (view.head === null) return "commit";
  if (view.storybookUrl === null) return "build";
  return view.stories.length === 0 ? "stories" : "save";
}

/** Whether the list goes under these steps, which is once there's something in it to save. */
export const listsStories = (stage: Stage | null) => stage === null || stage === "save";

const RECHECK_MS = 2000;
const UNCOMMITTED_NAMED = 3;

const MOVES_ON = "this page moves on by itself";

function NoBuild({ setup: { storybookDir, buildCommand } }: { setup: StorySetup }) {
  const config = JSON.stringify({ storybookDir, buildCommand: "npx storybook build" }, null, 2);
  return (
    <Stack gap="condensed">
      <Text as="p">
        Selfie shows and saves stories from a built Storybook, and there isn't one at <code>{storybookDir}</code>.
      </Text>
      {buildCommand !== null ? (
        <>
          <Text as="p">
            This project builds it with <code>{buildCommand}</code>. Run that, and {MOVES_ON}.
          </Text>
          <Text as="p" className="selfie-muted">
            If it builds somewhere else, set <code>storybookDir</code> in <code>selfie.config.json</code>, and start <code>selfie</code> again.
          </Text>
        </>
      ) : (
        <>
          <Text as="p">
            Build it with <code>npx storybook build</code>, and {MOVES_ON}.
          </Text>
          <Text as="p">
            To have <code>selfie</code> build it each time it starts, or if it builds somewhere else, put this in <code>selfie.config.json</code> at the top of your repository, and start <code>selfie</code> again:
          </Text>
          <pre className="selfie-setup-file">{config}</pre>
          <Text as="p" className="selfie-muted">
            No Storybook in this project yet? <code>npm create storybook@latest</code> sets one up.
          </Text>
        </>
      )}
    </Stack>
  );
}

/** Git shows an untracked directory as `dir/`, and a tracked file in it by its own path. */
const isInside = (file: string, dir: string) => file === `${dir}/` || file.startsWith(`${dir}/`);

function Uncommitted({ head, setup: { uncommitted, storybookDir } }: { head: string; setup: StorySetup }) {
  if (uncommitted.length === 0) return null;
  const named = uncommitted.slice(0, UNCOMMITTED_NAMED);
  const others = uncommitted.length - named.length;
  return (
    <Banner
      variant="warning"
      title="There are uncommitted changes"
      description={
        <>
          {named.map((file, at) => (
            <span key={file}>
              {at > 0 && ", "}
              <code>{file}</code>
            </span>
          ))}
          {others > 0 && ` and ${others.toLocaleString()} more`}. A story saved now is marked as from uncommitted changes, since it may not show what <code>{shortSha(head)}</code> does, and it can't become a golden.
          {uncommitted.some((file) => isInside(file, storybookDir)) && (
            <>
              {" "}
              Your build is one of them: add <code>{storybookDir}</code> to <code>.gitignore</code>.
            </>
          )}
        </>
      }
    />
  );
}

const fullName = ({ title, name }: ListedStory) => [...(title === "" ? [] : title.split("/")), name].join(" / ");

function SaveAStory({ view, setup, capture }: { view: StoriesView; setup: StorySetup; capture: CaptureState }) {
  const first = view.stories[0]!;
  const saveFirst = async () => {
    if (await capture.capture([first.story])) navigate(anyStoryPath(first.story));
  };
  return (
    <Stack gap="condensed">
      <Text as="p">
        Saving a story renders it and keeps the image with this commit, so there's something to write a note on, and to compare your next change with. Saving approves nothing.{" "}
        {setup.usesDocker ? "It renders in a pinned browser in Docker, and the first save downloads that, which can take a few minutes." : "It renders in this machine's browser."}
      </Text>
      <Uncommitted head={view.head!} setup={setup} />
      {capture.can ? (
        <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
          <Button variant="primary" disabled={capture.capturing > 0} onClick={() => void saveFirst()}>
            Save {fullName(first)}
          </Button>
          <Button disabled={capture.capturing > 0} onClick={() => void capture.capture(view.stories.map(({ story }) => story))}>
            Save all {view.stories.length.toLocaleString()}
          </Button>
          <Text className="selfie-muted">Or pick one below, and look at it running first.</Text>
        </Stack>
      ) : (
        <Text as="p">
          <code>selfie record</code> saves them all.
        </Text>
      )}
    </Stack>
  );
}

function Step({ stage, at, done, children }: { stage: Stage; at: Stage; done: ReactNode; children: ReactNode }) {
  const order = STAGES.indexOf(stage) - STAGES.indexOf(at);
  return (
    <li className="selfie-setup-step">
      {order < 0 ? <CheckCircleFillIcon className="selfie-setup-done" /> : <CircleIcon className={order > 0 ? "selfie-muted" : undefined} />}
      <Stack gap="condensed">
        <Text className={order > 0 ? "selfie-muted" : undefined} weight={order === 0 ? "semibold" : "normal"}>
          {order < 0 ? done : TITLES[stage]}
        </Text>
        {order === 0 && children}
      </Stack>
    </li>
  );
}

const TITLES: Readonly<Record<Stage, string>> = {
  commit: "Make a commit",
  build: "Build your Storybook",
  stories: "Write a story",
  save: "Save a story",
};

export function Setup({ view, stage, capture, recheck }: { view: StoriesView; stage: Stage; capture: CaptureState; recheck: () => void }) {
  const setup = view.setup!;
  // What's next, or a fix to what it warns of, happens in a terminal or an editor.
  useEffect(() => {
    const timer = setInterval(recheck, RECHECK_MS);
    return () => clearInterval(timer);
  }, [recheck]);
  return (
    <section className="selfie-setup" aria-labelledby="selfie-setup-heading">
      <Heading as="h3" variant="small" id="selfie-setup-heading">
        Nothing saved {view.head === null ? "yet" : <>at <code>{shortSha(view.head)}</code> yet</>}
      </Heading>
      <ol className="selfie-setup-steps">
        <Step stage="commit" at={stage} done={view.head === null ? null : <>At commit <code>{shortSha(view.head)}</code></>}>
          <Text as="p">A saved story is kept with the commit it came from, and this repository has no commits yet. Make one, and {MOVES_ON}.</Text>
        </Step>
        <Step stage="build" at={stage} done={<>A built Storybook at <code>{setup.storybookDir}</code></>}>
          <NoBuild setup={setup} />
        </Step>
        <Step stage="stories" at={stage} done={plural(view.stories.length, "story", "stories")}>
          <Text as="p">
            The Storybook at <code>{setup.storybookDir}</code> has no stories. Write one in a <code>.stories</code> file and build it again{setup.buildCommand === null ? "" : <> with <code>{setup.buildCommand}</code></>}, and {MOVES_ON}.
          </Text>
        </Step>
        <Step stage="save" at={stage} done={null}>
          {stage === "save" && <SaveAStory view={view} setup={setup} capture={capture} />}
        </Step>
      </ol>
    </section>
  );
}
