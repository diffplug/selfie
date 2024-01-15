import clsx from "clsx";
import {
  buttonClasses,
  FOOTER_IMG_HEIGHT,
  FOOTER_IMG_WIDTH,
} from "./constants";

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
        onClick={handleClick}
        role="button"
        className={clsx([
          buttonClasses,
          "absolute",
          "top-16",
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
