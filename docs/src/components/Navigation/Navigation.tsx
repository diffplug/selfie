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
    <div
      className={clsx([
        "flex",
        "flex-col",
        "justify-between",
        "wide-phone:flex-row",
        "gap-[10px]",
      ])}
    >
      <div className={clsx(["flex", "items-end", "gap-[10px]"])}>
        <Link href={"/"}>
          <Selfie
            className={clsx(["desktop:text-[93px]", "relative", "top-[7px]"])}
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
            <Link href={`/${pathParts.language}#literal`}>
              <Button
                className={
                  pathParts.subpath === "" ? pressedClasses : unPressedClasses
                }
              >
                why
              </Button>
            </Link>
            <Link href={`/${pathParts.language}/get-started`}>
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
            <Link href={`/${pathParts.language}/advanced`}>
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

const sharedClasses = clsx([
  "h-[23px]",
  "rounded-[4px]",
  "text-[18px]",
  "px-2",
  "hover:text-white",
  "hover:bg-blue",
]);

const pressedClasses = clsx([
  "mt-[1px]",
  "text-white",
  "bg-blue",
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
