import { PathParts } from "@/lib/languageFromPath";
import clsx from "clsx";
import { Button } from "./Button";
import { Popout } from "./Icons/Popout";

type HeadingPopoutProps = {
  destinationUrl: string;
  currentHeading: string;
};

export function HeadingPopout({
  currentHeading,
  destinationUrl,
}: HeadingPopoutProps) {
  function handleClick() {
    window.location.href = destinationUrl;
  }
  return (
    <Button
      className={clsx([
        "bg-white",
        "fill:black",
        "hover:bg-blue",
        "hover:fill-white",
        "shadow-button",
        "tablet:shadow-button-tablet",
        "w-[70px]",
        "rounded-[10px]",
        "h-[30px]",
        "z-20",
        "relative",
        "desktop:w-[94px]",
        "mb-[7px]",
      ])}
      onClick={handleClick}
    >
      <Popout />
    </Button>
  );
}
