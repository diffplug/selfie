import clsx from "clsx";
import { ButtonLink } from "./Button";
import { Popout } from "./Icons/Popout";

type HeadingPopoutProps = {
  destinationUrl: string;
};

export function HeadingPopout({ destinationUrl }: HeadingPopoutProps) {
  return (
    <ButtonLink
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
      href={destinationUrl}
    >
      <Popout />
    </ButtonLink>
  );
}
