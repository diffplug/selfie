import clsx from "clsx/lite";
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
    window.location.href = window.location.href.split("#")[0] + `#${slug}`;
  }
  return (
    <span className="whitespace-nowrap">
      {"\u00a0"}
      <LinkIcon
        onClick={handleLinkClick}
        className={clsx(
          "inline",
          "wide-phone:mr-2",
          "tablet:opacity-0",
          "h-6",
          "w-6",
          "cursor-pointer",
          "stroke-black",
          "stroke-2",
          "group-hover:opacity-100",
          className
        )}
      />
    </span>
  );
}
