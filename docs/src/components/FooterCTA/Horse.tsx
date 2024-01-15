import clsx from "clsx";
import { buttonClasses } from "./constants";
import Link from "next/link";
import { MutableRefObject } from "react";

interface HorseProps {
  imageRef: MutableRefObject<HTMLImageElement | null>;
  setImageHeight: (height: number) => void;
}
export function Horse({ imageRef, setImageHeight }: HorseProps) {
  return (
    <div className="relative">
      <img
        src="/horse.webp"
        ref={(el) => {
          if (el) {
            setImageHeight(el.height);
          }
          imageRef.current = el;
        }}
        className={clsx(["m-auto"])}
      />
      <span
        className={clsx([
          "absolute",
          "w-full",
          "top-0",
          "text-sm",
          "wide-phone:text-lg",
          "wide-phone:top-4",
          "text-center",
        ])}
      >
        are you still writing assertions
      </span>
      <Link
        href="https://thecontextwindow.ai/p/todo"
        className={clsx([
          buttonClasses,
          "absolute",
          "top-5",
          "w-[130px]",
          "wide-phone:top-16",
          "wide-phone:w-[210px]",
          "wide-phone:left-[300px]",
          "tablet:left-[400px]",
          "right-6",
          "m-auto",
        ])}
      >
        by hand?
      </Link>
    </div>
  );
}
