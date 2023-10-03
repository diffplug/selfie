import { LanguageSlug, languageSlugsToLabels } from "@/lib/languageFromPath";
import { Listbox } from "@headlessui/react";
import clsx from "clsx";
import { Dispatch, SetStateAction } from "react";
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
          <Button>
            {languageSlugsToLabels[selectedLanguage]}
            <CaretBottom className={clsx(["h-5 w-5"])} />
          </Button>
        </Listbox.Button>
        <Listbox.Options className={clsx(["absolute"])}>
          <Listbox.Option value={"jvm"}>jvm</Listbox.Option>
          <Listbox.Option value={"js"}>js</Listbox.Option>
          <Listbox.Option value={"go"}>go</Listbox.Option>
          <Listbox.Option value={"other-platforms"}>...</Listbox.Option>
        </Listbox.Options>
      </Listbox>
    </div>
  );
}
