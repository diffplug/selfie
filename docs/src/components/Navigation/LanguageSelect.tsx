import {
  LanguageSlug,
  PathParts,
  languageSlugsToLabels,
} from "@/lib/languageFromPath";
import clsx from "clsx";
import Link from "next/link";
import { Dispatch, SetStateAction } from "react";
import { Button } from "../Button";
import { CaretBottom } from "../Icons/CaretBottom";
import { Selfie } from "../Selfie";

type LanguageSelectProps = {
  pathParts: PathParts;
  setSelectIsOpen: Dispatch<SetStateAction<boolean>>;
  isOpen: boolean;
  handleChange(value: LanguageSlug): void;
};

export function LanguageSelect({
  pathParts,
  setSelectIsOpen,
  isOpen,
  handleChange,
}: LanguageSelectProps) {
  return (
    <>
      <ShadowHider />
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
        <div className={clsx(["relative", "hidden", "wide-phone:block"])}>
          <Button
            className={clsx([
              "text-white",
              "bg-blue",
              "w-[70px]",
              "rounded-[4px]",
              "wide-phone:h-[30px]",
              "desktop:w-[94px]",
            ])}
            onClick={() => setSelectIsOpen((prevIsOpen) => !prevIsOpen)}
          >
            {languageSlugsToLabels[pathParts.language]}
            <CaretBottom
              className={clsx([
                "h-5",
                "w-5",
                isOpen && "rotate-180",
                isOpen && "tablet:rotate-[270deg]",
              ])}
              fill="#FFFFFF"
            />
          </Button>
        </div>
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
          isOpen ? "translate-x-[230px]" : "translate-x-[-20px]",
          isOpen ? "desktop:translate-x-[337px]" : "translate-x-[-20px]",
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
                "desktop:w-[94px]",
              ])}
              onClick={() => handleChange(slug as LanguageSlug)}
              key={slug}
            >
              {languageSlugsToLabels[slug as LanguageSlug]}
            </Button>
          ))}
      </div>
    </>
  );
}

function ShadowHider() {
  return (
    <div
      className={clsx([
        "hidden",
        "wide-phone:block",
        "absolute",
        "bg-white",
        "w-[220px]",
        "desktop:w-[330px]",
        "h-full",
        "bottom-[-4px]",
        "z-10",
      ])}
    ></div>
  );
}
