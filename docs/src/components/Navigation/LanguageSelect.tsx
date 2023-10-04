import { LanguageSlug, languageSlugsToLabels } from "@/lib/languageFromPath";
import { Listbox } from "@headlessui/react";
import clsx from "clsx";
import { Button } from "../Button";
import { CaretBottom } from "../Icons/CaretBottom";

type LanguageSelectProps = {
  selectedLanguage: LanguageSlug;
  handleChange(value: LanguageSlug): void;
};

export function LanguageSelect({
  selectedLanguage,
  handleChange,
}: LanguageSelectProps) {
  return (
    <div className={clsx(["relative"])}>
      <Listbox value={selectedLanguage} onChange={handleChange}>
        <Listbox.Button>
          {({ open }) => {
            return (
              <Button
                className={clsx([
                  "text-white",
                  "bg-blue",
                  "w-[110px]",
                  "rounded-[4px]",
                ])}
              >
                {languageSlugsToLabels[selectedLanguage]}
                <CaretBottom
                  className={clsx(["h-5", "w-5", open && "rotate-180"])}
                  fill="#FFFFFF"
                />
              </Button>
            );
          }}
        </Listbox.Button>
        <Listbox.Options
          className={clsx([
            "absolute",
            "bg-white",
            "shadow-xl",
            "flex",
            "flex-col",
            "mt-[5px]",
            "gap-[5px]",
          ])}
        >
          {Object.keys(languageSlugsToLabels)
            .filter((slug) => slug !== selectedLanguage)
            .map((slug) => (
              <Listbox.Option value={slug} key={slug}>
                <Button
                  className={clsx([
                    "w-[110px]",
                    "shadow-button",
                    "tablet:shadow-button-tablet",
                    "rounded-[4px]",
                    "hover:text-white",
                    "hover:bg-blue",
                  ])}
                >
                  {languageSlugsToLabels[slug as LanguageSlug]}
                </Button>
              </Listbox.Option>
            ))}
        </Listbox.Options>
      </Listbox>
    </div>
  );
}
