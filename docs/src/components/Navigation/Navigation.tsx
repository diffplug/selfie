import {
  LanguageSlug,
  getPathParts,
  languageSlugsToLabels,
} from "@/lib/languageFromPath";
import clsx from "clsx";
import { useRouter } from "next/dist/client/router";
import Link from "next/link";
import { Button } from "../Button";
import { Selfie } from "../Selfie";
import { LanguageSelect } from "./LanguageSelect";
import { useState } from "react";

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

  const [selectIsOpen, setSelectIsOpen] = useState<boolean>(false);

  return (
    <div
      className={clsx([
        "relative",
        "flex",
        "justify-between",
        "gap-[10px]",
        "z-10",
        "overflow-hidden",
        "mb-[-4px]",
        "pb-[4px]",
      ])}
    >
      <div
        className={clsx([
          "absolute",
          "bg-white",
          "w-[220px]",
          "h-full",
          "bottom-[-4px]",
          "z-10",
        ])}
      ></div>
      <div
        className={clsx([
          "flex",
          "items-end",
          "gap-[10px]",
          "z-20",
          "bg-white",
        ])}
      >
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
          setSelectIsOpen={setSelectIsOpen}
          isOpen={selectIsOpen}
        />
      </div>
      <div
        className={clsx([
          "hidden",
          "absolute",
          "bg-white",
          "bottom-[4px]",
          "wide-phone:flex",
          "wide-phone:gap-[10px]",
          "transition-all",
          "duration-500",
          selectIsOpen ? "translate-x-[230px]" : "translate-x-[-20px]",
        ])}
      >
        {Object.keys(languageSlugsToLabels)
          .filter((slug) => slug !== pathParts.language)
          .map((slug) => (
            <Button
              className={clsx([
                "w-[70px]",
                "shadow-button",
                "tablet:shadow-button-tablet",
                "rounded-[4px]",
                "hover:text-white",
                "hover:bg-blue",
              ])}
              onClick={() => handleChange(slug as LanguageSlug)}
              key={slug}
            >
              {languageSlugsToLabels[slug as LanguageSlug]}
            </Button>
          ))}
      </div>
      <nav
        className={clsx([
          "flex",
          "items-end",
          "justify-end",
          "transition-all",
          "duration-500",
          selectIsOpen ? "translate-x-[280px]" : "translate-x-0",
        ])}
      >
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

const pressedContainerClasses = clsx(["pt-[2px]"]);

const unPressedContainerClasses = clsx([""]);

const sharedClasses = clsx([
  "px-1",
  "flex",
  "justify-center",
  "items-center",
  "cursor-pointer",
  "text-[16px]",
  "border",
  "h-[23px]",
  "border-black",
  "border-2",
  "rounded-[4px]",
  "hover:text-white",
  "hover:bg-blue",
  "wide-phone:text-base",
  "wide-phone:h-[30px]",
  "tablet:h-[35px]",
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
