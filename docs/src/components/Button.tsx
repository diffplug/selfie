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
  // Can't apply TW classes with JS. Custom stuff has to use the old fashioned approach.
  let style: CSSProperties = {};
  if (isDepressed) {
    style = {
      color: "#FFF",
      backgroundColor: "#63B9E3",
    };
  } else {
    style = {
      //   boxShadow: "2px 2px 1px #4D4D4D", // mobile
      //   boxShadow: "4px 4px 2px #4D4D4D", // tablet
      boxShadow: "4px 4px 2px #4D4D4D", // desktop
      color: "#4D4D4D",
      backgroundColor: "#FFF",
    };
  }
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
        "hover:!text-white",
        "hover:!bg-blue",
        "cursor-pointer",
        isWide ? "text-[22px]" : "text-[14px]",
        isWide ? "tablet:w-[154px]" : "tablet:w-[73px]",
        "tablet:text-[22px]",
        "tablet:border-[3px]",
        "tablet:rounded-lg",
        isWide ? "desktop:w-[232px]" : "desktop:w-[110px]",
        "desktop:text-[34px]",
        "desktop:border-[4px]",
        "desktop:rounded-xl",
      ])}
      style={style}
    >
      {text}
    </div>
  );
}
