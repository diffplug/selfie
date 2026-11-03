// Where this commit and its Storybook stand, on the way to a render, on the page people land on.
import { AlertFillIcon, CheckCircleFillIcon, CircleIcon } from "@primer/octicons-react";
import { Banner, Button, Stack, Text } from "@primer/react";
import { useEffect, type ReactNode } from "react";
import type { ListedStory, StoriesView, StorySetup } from "../shared/api.ts";
import type { RenderState } from "./hooks.ts";
import { plural } from "./plural.ts";
import { anyStoryPath, AppLink, navigate, runPath } from "./router.tsx";
import { Sha, shortSha } from "./words.tsx";

const RECHECK_MS = 2000;
const UNCOMMITTED_NAMED = 3;
const MOVES_ON = "this page moves on by itself";
const DEFAULT_BUILD = "npx storybook build";

type Mark = "done" | "warn" | "todo" | "later";

function Item({ mark, title, children }: { mark: Mark; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="selfie-checklist-item">
      {mark === "done" && <CheckCircleFillIcon className="selfie-checklist-done" aria-label="Done" />}
      {mark === "warn" && <AlertFillIcon className="selfie-checklist-warn" aria-label="Look at this" />}
      {(mark === "todo" || mark === "later") && <CircleIcon className={mark === "later" ? "selfie-muted" : undefined} aria-label="Not yet" />}
      <Stack gap="condensed">
        <Text className={mark === "later" ? "selfie-muted" : undefined} weight={mark === "todo" || mark === "warn" ? "semibold" : "normal"}>
          {title}
        </Text>
        {children}
      </Stack>
    </li>
  );
}

function NoBuiltStorybook({ setup: { storybookDir, buildCommand } }: { setup: StorySetup }) {
  const config = JSON.stringify({ storybookDir, buildCommand: DEFAULT_BUILD }, null, 2);
  return (
    <Stack gap="condensed">
      <Text as="p">
        Selfie shows and renders stories from a built Storybook, and there isn't one at <code>{storybookDir}</code>.
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
            Build it with <code>{DEFAULT_BUILD}</code>, and {MOVES_ON}.
          </Text>
          <Text as="p">
            To have <code>selfie</code> build it each time it starts, or if it builds somewhere else, put this in <code>selfie.config.json</code> at the top of your repository, and start <code>selfie</code> again:
          </Text>
          <pre className="selfie-checklist-file">{config}</pre>
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
          {others > 0 && ` and ${others.toLocaleString()} more`}. A render now is marked as from uncommitted changes, since it may not show what <code>{shortSha(head)}</code> does, and it can't become a golden.
          {uncommitted.some((file) => isInside(file, storybookDir)) && (
            <>
              {" "}
              Your built Storybook is one of them: add <code>{storybookDir}</code> to <code>.gitignore</code>.
            </>
          )}
        </>
      }
    />
  );
}

function StorybookItem({ view, setup }: { view: StoriesView; setup: StorySetup | null }) {
  const count = plural(view.stories.length, "story", "stories");
  if (view.storybookUrl === null) return <Item mark="todo" title="No built Storybook">{setup !== null && <NoBuiltStorybook setup={setup} />}</Item>;
  if (view.stories.length === 0) {
    return (
      <Item mark="todo" title="Built Storybook with no stories">
        {setup !== null && (
          <Text as="p">
            Write a story in a <code>.stories</code> file and build it again{setup.buildCommand === null ? "" : <> with <code>{setup.buildCommand}</code></>}, and {MOVES_ON}.
          </Text>
        )}
      </Item>
    );
  }
  if (setup === null || view.head === null) return <Item mark="done" title={`Built Storybook with ${count}`} />;
  const { builtBeforeHead, uncommitted } = setup;
  if (!builtBeforeHead && uncommitted.length === 0) return <Item mark="done" title={`Built Storybook on a clean checkout with ${count}`} />;
  const whatsOff = [builtBeforeHead && "from before this commit", uncommitted.length > 0 && "on a checkout with uncommitted changes"].filter(Boolean).join(", ");
  return (
    <Item mark="warn" title={`Built Storybook ${whatsOff}, with ${count}`}>
      {builtBeforeHead && (
        <Text as="p">
          Build it again with <code>{setup.buildCommand ?? DEFAULT_BUILD}</code>, and {MOVES_ON}. A render now would show the older build.
        </Text>
      )}
      {uncommitted.length > 0 && <Uncommitted head={view.head} setup={setup} />}
    </Item>
  );
}

/** Whether a render is missing or known to be out of date, which is what's left to fan out to. */
const needsRender = ({ render }: ListedStory) => render === null || render.fromHostedStorybook === false;

const fullName = ({ title, name }: ListedStory) => [...(title === "" ? [] : title.split("/")), name].join(" / ");

function RendersItem({ view, setup, renders }: { view: StoriesView; setup: StorySetup | null; renders: RenderState }) {
  const rendered = view.stories.filter((entry) => entry.render !== null).length;
  const rest = view.stories.filter(needsRender);
  const first = view.stories[0];
  const stale = view.stories.filter(({ render }) => render?.fromHostedStorybook === false).length;
  if (first === undefined || view.head === null) return <Item mark="later" title="No renders yet" />;
  const renderFirst = async () => {
    if (await renders.render([first.story])) navigate(anyStoryPath(first.story));
  };
  if (rendered === 0) {
    return (
      <Item mark="todo" title="No renders yet">
        <Text as="p">
          Rendering a story keeps its image with this commit, so there's something to write a note on, and to compare your next change with. It approves nothing.{" "}
          {setup?.usesDocker === false ? "It renders in this machine's browser." : "It renders in a pinned browser in Docker, and the first render downloads that, which can take a few minutes."}
        </Text>
        {renders.can ? (
          <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
            <Button variant="primary" disabled={renders.rendering > 0} onClick={() => void renderFirst()}>
              Render {fullName(first)}
            </Button>
            <Button disabled={renders.rendering > 0} onClick={() => void renders.render(rest.map(({ story }) => story))}>
              Render all {view.stories.length.toLocaleString()}
            </Button>
            <Text className="selfie-muted">Or pick a story, and look at it running first.</Text>
          </Stack>
        ) : (
          <Text as="p">
            <code>selfie record</code> renders them all.
          </Text>
        )}
      </Item>
    );
  }
  return (
    <Item
      mark={rest.length === 0 ? "done" : "todo"}
      title={`${rendered.toLocaleString()} of ${plural(view.stories.length, "story", "stories")} rendered${stale > 0 ? `, ${stale.toLocaleString()} from another built Storybook` : ""}`}
    >
      <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
        {renders.can && rest.length > 0 && (
          <Button variant="primary" disabled={renders.rendering > 0} onClick={() => void renders.render(rest.map(({ story }) => story))}>
            {`Render the rest (${rest.length.toLocaleString()})`}
          </Button>
        )}
        {view.newestRunId !== null && <AppLink href={runPath(view.newestRunId)}>Review the newest run</AppLink>}
      </Stack>
    </Item>
  );
}

export function Checklist({ view, renders, recheck }: { view: StoriesView; renders: RenderState; recheck: () => void }) {
  const { head, branch, setup } = view;
  // What's next, or a fix to what it warns of, happens in a terminal or an editor.
  const waiting = setup !== null && (head === null || view.storybookUrl === null || view.stories.length === 0 || setup.builtBeforeHead || setup.uncommitted.length > 0);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(recheck, RECHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, recheck]);
  return (
    <ul className="selfie-checklist" aria-label="Where this commit stands">
      {head === null ? (
        <Item mark="todo" title={branch === null ? "No commits yet" : <>No commits yet on branch <code>{branch}</code></>}>
          <Text as="p">A render is kept with the commit it came from. Make one, and {MOVES_ON}.</Text>
        </Item>
      ) : (
        <Item
          mark="done"
          title={
            <>
              At commit <Sha sha={head} />
              {branch !== null && <> on branch <code>{branch}</code></>}
            </>
          }
        />
      )}
      <StorybookItem view={view} setup={setup} />
      <RendersItem view={view} setup={setup} renders={renders} />
    </ul>
  );
}
