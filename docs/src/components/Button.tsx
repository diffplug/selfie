import clsx from "clsx";
import { CSSProperties } from "react";

type ButtonProps = {
  text: string;
  isDepressed?: boolean;
  isWide?: boolean;
};

export function Button({
  text,
  isDepressed = false,
  isWide = false,
}: ButtonProps) {
  return (
    <div
      className={clsx([
        "flex",
        isWide ? "w-[154px]" : "w-[44px]",
        "justify-center",
        "rounded-md",
        "border",
        "border-2",
        "border-black",
        "hover:text-white",
        "hover:bg-blue",
        "cursor-pointer",
        isDepressed ? "text-white" : "text-black",
        isDepressed ? "bg-blue" : "bg-white",
        isDepressed ? "shadow-none" : "shadow-button",
        isWide ? "text-[22px]" : "text-[14px]",
        isWide ? "tablet:w-[154px]" : "tablet:w-[73px]",
        "tablet:text-[22px]",
        "tablet:border-[3px]",
        "tablet:rounded-lg",
        isDepressed ? "shadow-none" : "tablet:shadow-button-tablet",
        isWide ? "desktop:w-[232px]" : "desktop:w-[110px]",
        "desktop:text-[34px]",
        "desktop:border-[4px]",
        "desktop:rounded-xl",
      ])}
    >
      {text}
    </div>
  );
}
