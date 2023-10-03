import clsx from "clsx";
import Link from "next/link";
import { Button } from "./Button";
import { useRouter } from "next/dist/client/router";
import { languageFromPath } from "@/lib/languageFromPath";

export function ButtonList() {
  const router = useRouter();
  const selectedLanguage = languageFromPath(router.pathname);
  return (
    <div
      className={clsx([
        "align-center",
        "flex",
        "w-[187px]",
        "flex-row",
        "justify-between",
        "wide-phone:w-[220px]",
        "tablet:w-[328px]",
        "desktop:w-[490px]",
      ])}
    >
      <Link href="/jvm">
        <Button
          className={
            ["jvm", ""].includes(selectedLanguage)
              ? pressedClasses
              : unPressedClasses
          }
        >
          jvm
        </Button>
      </Link>
      <Link href="/js">
        <Button
          className={
            selectedLanguage === "js" ? pressedClasses : unPressedClasses
          }
        >
          js
        </Button>
      </Link>
      <Link href="/other-platforms">
        <Button
          className={
            selectedLanguage === "go" ? pressedClasses : unPressedClasses
          }
        >
          go
        </Button>
      </Link>
      <Link href="/other-platforms">
        <Button
          className={
            selectedLanguage === "other-platforms"
              ? pressedClasses
              : unPressedClasses
          }
        >
          ...
        </Button>
      </Link>
    </div>
  );
}

const sharedClasses = clsx([
  "w-[44px]",
  "h-[23px]",
  "rounded-[4px]",
  "text-[14px]",
  "tablet:w-[73px]",
  "desktop:w-[110px]",
]);

const pressedClasses = clsx([
  "mt-[1px]",
  "text-white",
  "bg-blue",
  "shadow-none",
  "tablet:mt-[2px]",
  "shadow-none",
  "tablet:mt-[3px]",
  sharedClasses,
]);

const unPressedClasses = clsx([
  "text-black",
  "bg-white",
  "shadow-button",
  "tablet:shadow-button-tablet",
  sharedClasses,
]);
