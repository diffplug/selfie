import clsx from "clsx";
import { buttonClasses } from "./constants";
import Link from "next/link";
import { useRouter } from "next/router";
import { getPathParts } from "@/lib/languageFromPath";

interface CarProps {
  imageHeight: number;
}
export function Car({ imageHeight }: CarProps) {
  const router = useRouter();
  const pathParts = getPathParts(router.pathname);
  return (
    <div
      style={{ height: imageHeight }}
      className={clsx([
        "relative",
        "z-10",
        "mx-[-0.5rem]",
        "wide-phone:mx-[-1rem]",
      ])}
    >
      <picture>
        <source media="(max-width: 604px)" srcSet="/car-1536w.webp" />
        <source
          media="(min-width: 605px) and (max-width: 1299px)"
          srcSet="/car-3072w.webp"
        />
        <source media="(min-width: 1300px)" srcSet="/car_feathered.webp" />
        <img
          src="/car_feathered.webp"
          className={clsx(["left-0", "right-0", "absolute", "top-0", "m-auto"])}
        />
      </picture>
      <span
        className={clsx([
          "absolute",
          "bottom-0",
          "wide-phone:bottom-1",
          "tablet:bottom-1",
          "desktop:bottom-4",
          "right-0",
          "text-base",
          "text-right",
          "tablet:text-lg",
          "right-[10px]",
          "tablet:right-[20px]",
          "desktop:right-[110px]",
          "text-white",
        ])}
      >
        let your codebase take&nbsp;its&nbsp;own&nbsp;selfies
      </span>
      <Link
        href={`/${pathParts.language}/get-started`}
        className={clsx([
          buttonClasses,
          "absolute",
          "bottom-[80px]",
          "wide-phone:bottom-[60px]",
          "tablet:bottom-[75px]",
          "desktop:bottom-[150px]",
          "w-[130px]",
          "wide-phone:w-[180px]",
          "tablet:w-[210px]",
          "left-0",
          "right-0",
          "m-auto",
        ])}
      >
        get started
      </Link>
    </div>
  );
}
