import {
  LanguageSlug,
  PathParts,
  languageSlugsToLabels,
} from "@/lib/languageFromPath";
import { useResizing } from "@/lib/useResizing";
import clsx from "clsx/lite";
import { Dispatch, SetStateAction, useState } from "react";
import { Button } from "./Button";
import { CaretBottom } from "./Icons/CaretBottom";
import { Close } from "./Icons/Close";

type HeadingLanguageSelectProps = {
  pathParts: PathParts;
  setSelectIsOpen: Dispatch<SetStateAction<boolean>>;
  isOpen: boolean;
  handleChange(value: LanguageSlug): void;
};

export function HeadingLanguageSelect({
  pathParts,
  setSelectIsOpen,
  isOpen,
  handleChange,
}: HeadingLanguageSelectProps) {
  const resizing = useResizing();
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  return (
    <div className={clsx("relative", "mb-[7px]")}>
      <Button
        className={clsx(
          "text-white",
          "bg-blue",
          "w-[70px]",
          "rounded-[4px]",
          "h-[30px]",
          "z-20",
          "relative",
          "desktop:w-[94px]"
        )}
        onClick={() => setSelectIsOpen((prevIsOpen) => !prevIsOpen)}
        onMouseEnter={() => {
          if (!isTouchDevice) {
            setSelectIsOpen(true);
          }
        }}
        onMouseLeave={() => {
          if (!isTouchDevice) {
            setSelectIsOpen(false);
          }
        }}
        onTouchStart={() => {
          setIsTouchDevice(true);
        }}
      >
        {languageSlugsToLabels[pathParts.language]}
        {isOpen ? (
          <Close className={clsx("h-[12px]", "w-[12px]")} />
        ) : (
          <CaretBottom className={clsx("h-[12px]", "w-[12px]")} />
        )}
      </Button>
      <div className={clsx("absolute", "top-0", "z-10", "flex", "flex-col")}>
        {Object.keys(languageSlugsToLabels)
          .filter((slug) => slug !== pathParts.language)
          .map((slug, idx) => (
            <Button
              className={clsx(
                "w-[70px]",
                "rounded-[4px]",
                "h-[30px]",
                "bg-white",
                "hover:text-white",
                "hover:bg-blue",
                !resizing && "transition-transform",
                "desktop:w-[94px]",
                isOpen
                  ? `translate-y-[${30 + (idx + 1) * 10}px]`
                  : `translate-y-[-${idx * 30}px]`,
                isOpen
                  ? `tablet:translate-y-[${35 + (idx + 1) * 10}px]`
                  : `tablet:translate-y-[-${idx * 35}px]`,
                isOpen
                  ? `desktop:translate-y-[${53 + (idx + 1) * 10}px]`
                  : `desktop:translate-y-[-${idx * 53}px]`
              )}
              onClick={() => handleChange(slug as LanguageSlug)}
              key={slug}
            >
              {languageSlugsToLabels[slug as LanguageSlug]}
            </Button>
          ))}
      </div>
    </div>
  );
}

/**
 * **DO NOT DELETE** These are all possible outcomes of the math
 * inside the string interpolation above. Tailwind magic isn't
 * smart enough to do the math and it needs this list at build
 * time in order to include these styles in the output.
 *
 * translate-y-[40px] translate-y-[50px] translate-y-[60px]
 * translate-y-[-0px] translate-y-[-30px] translate-y-[-60px]
 * tablet:translate-y-[45px] tablet:translate-y-[55px] tablet:translate-y-[65px]
 * tablet:translate-y-[-0px] tablet:translate-y-[-35px] tablet:translate-y-[-70px]
 * desktop:translate-y-[63px] desktop:translate-y-[73px] desktop:translate-y-[83px]
 * desktop:translate-y-[-0px] desktop:translate-y-[-53px] desktop:translate-y-[-106px]
 */
