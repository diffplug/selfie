import clsx from "clsx";
import { ReactNode } from "react";

type ButtonProps = {
  children: ReactNode;
  isDepressed?: boolean;
  isWide?: boolean;
};

export function Button({
  children,
  isDepressed = false,
  isWide = false,
}: ButtonProps) {
  return (
    <span
      className={clsx([
        "flex",
        isWide ? "w-[154px]" : "w-[44px]",
        isWide ? "h-[35px]" : "h-[23px]",
        "justify-center",
        "items-center",
        isWide ? "rounded-[10px]" : "rounded-[4px]",
        "border",
        "border-2",
        "border-black",
        "hover:text-white",
        "hover:bg-blue",
        "cursor-pointer",
        isDepressed && "mt-[1px]",
        isDepressed ? "text-white" : "text-black",
        isDepressed ? "bg-blue" : "bg-white",
        isDepressed ? "shadow-none" : "shadow-button",
        isWide ? "text-[22px]" : "text-[14px]",
        isWide ? "tablet:w-[154px]" : "tablet:w-[73px]",
        "tablet:h-[35px]",
        "tablet:text-[22px]",
        "tablet:border-[3px]",
        "tablet:rounded-[10px]",
        isDepressed && "tablet:mt-[2px]",
        isDepressed ? "shadow-none" : "tablet:shadow-button-tablet",
        isWide ? "desktop:w-[232px]" : "desktop:w-[110px]",
        "desktop:h-[53px]",
        "desktop:text-[34px]",
        "desktop:border-[4px]",
        "desktop:rounded-[16px]",
        isDepressed && "tablet:mt-[3px]",
      ])}
    >
      {children}
    </span>
  );
}
