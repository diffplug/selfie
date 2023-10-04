import clsx from "clsx";
import { ReactNode } from "react";

type ButtonProps = {
  children: ReactNode;
  className?: string;
};

export function Button({ children, className }: ButtonProps) {
  return (
    <span
      className={clsx([
        "flex",
        "justify-center",
        "items-center",
        "border",
        "border-2",
        "border-black",
        "cursor-pointer",
        "tablet:h-[35px]",
        "tablet:text-[22px]",
        "tablet:border-[3px]",
        "tablet:rounded-[10px]",
        "desktop:h-[53px]",
        "desktop:text-[34px]",
        "desktop:border-[4px]",
        "desktop:rounded-[16px]",
        className,
      ])}
    >
      {children}
    </span>
  );
}
