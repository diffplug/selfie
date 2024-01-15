import clsx from "clsx";
import { FOOTER_IMG_HEIGHT, FOOTER_IMG_WIDTH } from "./constants";
import { Button } from "../Button";

export function Horse() {
  function handleClick() {
    console.log("clicked");
  }
  return (
    <div className="relative">
      <img
        src="/horse.webp"
        className={clsx([
          `h-[${FOOTER_IMG_HEIGHT}px]`,
          `min-h-[${FOOTER_IMG_HEIGHT}px]`,
          `w-[${FOOTER_IMG_WIDTH}px]`,
          "m-auto",
        ])}
      />
      <span
        className={clsx([
          "absolute",
          "w-full",
          "top-4",
          "text-lg",
          "text-center",
        ])}
      >
        are you still writing assertions
      </span>
      <span
        className={clsx([
          "flex",
          "justify-center",
          "items-center",
          "border",
          "border-2",
          "border-black",
          "cursor-pointer",
          "absolute",
          "top-16",
          "border-[4px]",
          "h-[53px]",
          "rounded-[16px]",
          "text-lg",
          "hover:text-white",
          "hover:bg-blue",
          "text-black",
          "bg-white",
          "shadow-button",
          "tablet:shadow-button-tablet",
          "w-[210px]",
          "left-[300px]",
          "tablet:left-[400px]",
          "right-0",
          "m-auto",
        ])}
      >
        by hand?
      </span>
    </div>
  );
}
