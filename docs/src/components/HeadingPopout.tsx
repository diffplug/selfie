import { PathParts } from "@/lib/languageFromPath";
import clsx from "clsx";
import { Button } from "./Button";
import { Popout } from "./Icons/Popout";

type HeadingPopoutProps = {
  pathParts: PathParts;
  currentHeading: string;
};

export function HeadingPopout({
  currentHeading,
  pathParts,
}: HeadingPopoutProps) {
  function handleClick() {
    window.history.pushState({}, "", `#${currentHeading}`);
    window.location.href = `/${pathParts.language}/get-started#quickstart`;
  }
  return (
    <Button
      className={clsx([
        "text-white",
        "bg-blue",
        "w-[70px]",
        "rounded-[4px]",
        "h-[30px]",
        "z-20",
        "relative",
        "desktop:w-[94px]",
        "mb-[7px]",
      ])}
      onClick={handleClick}
    >
      <Popout width={36} height={36} />
    </Button>
  );
}