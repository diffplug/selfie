import clsx from "clsx/lite";
import Link from "next/link";
import { Button } from "./Button";
import { useRouter } from "next/router";
import { getPathParts } from "@/lib/languageFromPath";

export function ButtonList() {
  const router = useRouter();
  const selectedLanguage = getPathParts(router.pathname).language;
  return (
    <div
      className={clsx(
        "align-center",
        "flex",
        "flex-row",
        "justify-between",
        "wide-phone:w-[220px]",
        "tablet:w-[328px]",
        "desktop:w-[490px]"
      )}
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
      <Link href="/py">
        <Button
          className={
            selectedLanguage === "py" ? pressedClasses : unPressedClasses
          }
        >
          py
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
      <Link href="/js">
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

const sharedClasses = clsx(
  "w-[34px]",
  "h-[23px]",
  "rounded-[4px]",
  "text-[12px]",
  "wide-phone:w-[44px]",
  "tablet:w-[73px]",
  "desktop:w-[110px]",
  "hover:text-white",
  "hover:bg-blue"
);

const pressedClasses = clsx(
  "mt-[1px]",
  "text-white",
  "bg-blue",
  "shadow-none",
  "tablet:mt-[3px]",
  sharedClasses
);

const unPressedClasses = clsx(
  "text-black",
  "bg-white",
  "shadow-button",
  "tablet:shadow-button-tablet",
  sharedClasses
);
