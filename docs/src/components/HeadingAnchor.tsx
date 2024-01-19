import clsx from "clsx";
import { LinkIcon } from "./Icons/LinkIcon";

interface HeadingAnchorProps {
  className?: string;
  slug: string;
}

/**
 * Must add the `group` tailwind class to the parent element
 */
export function HeadingAnchor({ className, slug }: HeadingAnchorProps) {
  function handleLinkClick() {
    history.pushState({}, "", window.location.href.split("#")[0] + `#${slug}`);
  }
  return (
    <LinkIcon
      onClick={handleLinkClick}
      className={clsx([
        "mx-2",
        "opacity-0",
        "h-6",
        "w-6",
        "cursor-pointer",
        "stroke-black",
        "stroke-2",
        "group-hover:opacity-100",
        className,
      ])}
    />
  );
}
