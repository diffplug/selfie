import { showQuery, type Show } from "./filter.ts";
import { AppLink, runPath, storyPath } from "./router.tsx";

/** A longer list is one click away, in the run's table with its filter set. */
const STORIES_LISTED = 10;

/** Stories as links, in a filter so next and previous stay among them, with any detail below each. */
export function StoryLinks({
  runId,
  stories,
  show,
}: {
  readonly runId: string;
  readonly stories: readonly { readonly story: string; readonly detail?: string | null }[];
  readonly show: Show;
}) {
  const query = showQuery(show);
  const listed = stories.slice(0, STORIES_LISTED);
  return (
    <ul className="selfie-story-list">
      {listed.map(({ story, detail }) => (
        <li key={story}>
          <AppLink href={storyPath(runId, story, query)}>{story}</AppLink>
          {detail ? <div className="selfie-detail-text">{detail}</div> : null}
        </li>
      ))}
      {stories.length > listed.length && (
        <li>
          <AppLink href={runPath(runId, query)}>and {stories.length - listed.length} more</AppLink>
        </li>
      )}
    </ul>
  );
}
