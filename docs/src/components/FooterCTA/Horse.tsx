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
          "wide-phone:text-base",
          "wide-phone:top-1",
          "tablet:text-lg",
          "tablet:top-2",
          "desktop:top-4",
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
          "wide-phone:top-10",
          "wide-phone:w-[150px]",
          "wide-phone:left-[300px]",
          "tablet:top-14",
          "tablet:w-[210px]",
          "tablet:left-[300px]",
          "tablet:left-[400px]",
          "desktop:top-16",
          "right-6",
          "m-auto",
        ])}
      >
        by hand?
      </Link>
    </div>
  );
}
