import { PathParts } from "@/lib/languageFromPath";
import clsx from "clsx";
import Link from "next/link";
import { Button } from "../Button";
import { Octocat } from "../Icons/Octocat";

type SubNavButton = {
  text: string;
  hrefSubpath: string;
  isPressed(subpathName: PathParts["subpath"]): boolean;
};

const subNavButtonList: SubNavButton[] = [
  {
    text: "why",
    hrefSubpath: "#literal",
    isPressed: (subpathName) => subpathName === "",
  },
  {
    text: "get started",
    hrefSubpath: "/get-started",
    isPressed: (subpathName) => subpathName === "get-started",
  },
  {
    text: "advanced",
    hrefSubpath: "/advanced",
    isPressed: (subpathName) => subpathName === "advanced",
  },
];

type SubNavigationProps = {
  pathParts: PathParts;
  selectIsOpen: boolean;
};

export function SubNavigation({ pathParts, selectIsOpen }: SubNavigationProps) {
  return (
    <nav
      className={clsx([
        "flex",
        "items-end",
        "justify-end",
        "transition-all",
        "duration-500",
        selectIsOpen ? "translate-x-[290px]" : "translate-x-0",
        selectIsOpen ? "desktop:translate-x-[417px]" : "translate-x-0",
        "pr-[2px]",
        "tablet:pr-[5px]",
      ])}
    >
      <ul role="list">
        <li className={clsx(["flex", "gap-[10px]"])}>
          {subNavButtonList.map((subNavButton) => {
            return (
              <Link
                href={`/${pathParts.language}${subNavButton.hrefSubpath}`}
                className={clsx([
                  subNavButton.isPressed(pathParts.subpath) && "pt-[2px]",
                ])}
                key={subNavButton.hrefSubpath}
              >
                <Button
                  className={
                    subNavButton.isPressed(pathParts.subpath)
                      ? pressedClasses
                      : unPressedClasses
                  }
                >
                  {subNavButton.text}
                </Button>
              </Link>
            );
          })}
          <Link href="https://github.com/diffplug/selfie">
            <Button
              className={clsx([
                unPressedClasses,
                "fill-black",
                "hover:fill-white",
              ])}
            >
              <Octocat
                className={clsx([
                  "w-[16px]",
                  "h-[16px]",
                  "wide-phone:w-[22px]",
                  "wide-phone:h-[22px]",
                  "desktop:w-[32px]",
                  "desktop:h-[32px]",
                ])}
              />
            </Button>
          </Link>
        </li>
      </ul>
    </nav>
  );
}

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
