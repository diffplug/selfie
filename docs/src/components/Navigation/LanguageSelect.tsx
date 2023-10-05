import { LanguageSlug, languageSlugsToLabels } from "@/lib/languageFromPath";
import { Listbox } from "@headlessui/react";
import clsx from "clsx";
import { Dispatch, SetStateAction } from "react";
import { Button } from "../Button";
import { CaretBottom } from "../Icons/CaretBottom";

type LanguageSelectProps = {
  selectedLanguage: LanguageSlug;
  setSelectIsOpen: Dispatch<SetStateAction<boolean>>;
  isOpen: boolean;
};

export function LanguageSelect({
  selectedLanguage,
  setSelectIsOpen,
  isOpen,
}: LanguageSelectProps) {
  return (
    <div className={clsx(["relative", "hidden", "wide-phone:block"])}>
      <Button
        className={clsx([
          "text-white",
          "bg-blue",
          "w-[70px]",
          "rounded-[4px]",
          "wide-phone:h-[30px]",
        ])}
        onClick={() => setSelectIsOpen((prevIsOpen) => !prevIsOpen)}
      >
        {languageSlugsToLabels[selectedLanguage]}
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
  );
}
