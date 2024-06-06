import clsx from "clsx/lite";
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
      <picture>
        <source media="(max-width: 604px)" srcSet="/horse-1536w.webp" />
        <source
          media="(min-width: 605px) and (max-width: 1299px)"
          srcSet="/horse-3072w.webp"
        />
        <source media="(min-width: 1300px)" srcSet="/horse_feathered.webp" />
        <img
          src="/horse_feathered.webp"
          ref={(el) => {
            if (el) {
              setImageHeight(el.height);
            }
            imageRef.current = el;
          }}
          className={clsx("m-auto")}
        />
      </picture>
      <span
        className={clsx(
          "absolute",
          "w-full",
          "top-1",
          "text-base",
          "tablet:text-lg",
          "tablet:top-2",
          "desktop:top-4",
          "text-center"
        )}
      >
        are you still writing assertions
      </span>
      <Link
        href="https://thecontextwindow.ai/p/temporarily-embarrassed-snapshots"
        className={clsx(
          buttonClasses,
          "absolute",
          "top-10",
          "w-[130px]",
          "wide-phone:w-[150px]",
          "wide-phone:left-[300px]",
          "tablet:top-14",
          "tablet:w-[210px]",
          "tablet:left-[300px]",
          "tablet:left-[400px]",
          "desktop:top-16",
          "right-6",
          "m-auto"
        )}
      >
        by hand?
      </Link>
    </div>
  );
}
