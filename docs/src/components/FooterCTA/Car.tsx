import clsx from "clsx";
import {
  buttonClasses,
  FOOTER_IMG_HEIGHT,
  FOOTER_IMG_WIDTH,
} from "./constants";

export function Car() {
  function handleClick() {
    console.log("clicked");
  }
  return (
    <div className={clsx(["relative", "z-10", "h-full"])}>
      <img
        src="/car.webp"
        className={clsx([
          `h-[${FOOTER_IMG_HEIGHT}px]`,
          `w-[${FOOTER_IMG_WIDTH}px]`,
          "left-0",
          "right-0",
          "absolute",
          "top-0",
          "m-auto",
        ])}
      />
      <span
        className={clsx([
          "absolute",
          "bottom-4",
          "right-0",
          "text-lg",
          "text-center",
          "right-[10px]",
          "tablet:right-[50px]",
          "desktop:right-[110px]",
        ])}
      >
        let your codebase take its own selfies
      </span>
      <span
        onClick={handleClick}
        role="button"
        className={clsx([
          buttonClasses,
          "absolute",
          "bottom-[150px]",
          "w-[210px]",
          "left-0",
          "right-0",
          "m-auto",
        ])}
      >
        get started
      </span>
    </div>
  );
}
