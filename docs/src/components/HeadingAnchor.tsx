import { LinkIcon } from "./Icons/LinkIcon";

interface HeadingAnchorProps {
  slug: string;
}

/**
 * Must add the `group` tailwind class to the parent element
 */
export function HeadingAnchor({ slug }: HeadingAnchorProps) {
  function handleLinkClick() {
    history.pushState({}, "", window.location.href.split("#")[0] + `#${slug}}`);
  }
  return (
    <LinkIcon
      onClick={handleLinkClick}
      className="ml-2 hidden h-6 w-6 cursor-pointer stroke-black stroke-2 group-hover:block"
    />
  );
}
