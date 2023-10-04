import { LanguageSlug, getPathParts } from "@/lib/languageFromPath";
import clsx from "clsx";
import { useRouter } from "next/dist/client/router";
import Link from "next/link";
import { Button } from "../Button";
import { Selfie } from "../Selfie";
import { LanguageSelect } from "./LanguageSelect";

export function Navigation() {
  const router = useRouter();
  const pathParts = getPathParts(router.pathname);

  function handleChange(value: LanguageSlug) {
    let nextRoute = "/" + value;
    if (pathParts.subpath) {
      nextRoute += "/" + pathParts.subpath;
    }
    router.push(nextRoute);
  }

  return (
    <div className={clsx(["flex", "justify-between", "gap-[10px]"])}>
      <div className={clsx(["flex", "items-end", "gap-[10px]"])}>
        <Link href={"/"}>
          <Selfie
            className={clsx([
              "relative",
              "text-[45px]",
              "top-[6px]",
              "desktop:text-[93px]",
              "wide-phone:text-[58px]",
            ])}
          />
        </Link>
        <LanguageSelect
          selectedLanguage={pathParts.language}
          handleChange={handleChange}
        />
      </div>
      <nav className={clsx(["flex", "items-end", "justify-end"])}>
        <ul role="list">
          <li className={clsx(["flex", "gap-[10px]"])}>
            <Link
              href={`/${pathParts.language}#literal`}
              className={
                pathParts.subpath === ""
                  ? pressedContainerClasses
                  : unPressedContainerClasses
              }
            >
              <Button
                className={
                  pathParts.subpath === "" ? pressedClasses : unPressedClasses
                }
              >
                why
              </Button>
            </Link>
            <Link
              href={`/${pathParts.language}/get-started`}
              className={
                pathParts.subpath === "get-started"
                  ? pressedContainerClasses
                  : unPressedContainerClasses
              }
            >
              <Button
                className={
                  pathParts.subpath === "get-started"
                    ? pressedClasses
                    : unPressedClasses
                }
              >
                get started
              </Button>
            </Link>
            <Link
              href={`/${pathParts.language}/advanced`}
              className={
                pathParts.subpath === "advanced"
                  ? pressedContainerClasses
                  : unPressedContainerClasses
              }
            >
              <Button
                className={
                  pathParts.subpath === "advanced"
                    ? pressedClasses
                    : unPressedClasses
                }
              >
                advanced
              </Button>
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}

const pressedContainerClasses = clsx(["pl-[4px]", "pt-[2px]"]);

const unPressedContainerClasses = clsx(["pr-[4px]"]);

const sharedClasses = clsx([
  "px-1",
  "flex",
  "justify-center",
  "items-center",
  "cursor-pointer",
  "h-[23px]",
  "text-[16px]",
  "border",
  "border-black",
  "border-2",
  "rounded-[4px]",
  "hover:text-white",
  "hover:bg-blue",
  "tablet:h-[35px]",
  "tablet:text-[22px]",
  "tablet:border-[3px]",
  "tablet:rounded-[10px]",
  "desktop:h-[53px]",
  "desktop:text-[34px]",
  "desktop:border-[4px]",
  "desktop:rounded-[16px]",
]);

const pressedClasses = clsx([
  "text-white",
  "bg-blue",
  "shadow-none",
  sharedClasses,
]);

const unPressedClasses = clsx([
  "text-black",
  "bg-white",
  "shadow-button",
  "tablet:shadow-button-tablet",
  sharedClasses,
]);
