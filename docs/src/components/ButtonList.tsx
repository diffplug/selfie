import clsx from "clsx";
import { CSSProperties } from "react";

export function ButtonList() {
  return (
    <div
      className={clsx([
        "align-center",
        "flex",
        "w-[187px]",
        "flex-row",
        "justify-between",
        "wide-phone:w-[220px]",
        "tablet:w-[328px]",
        "desktop:w-[490px]",
      ])}
    >
      <Button text="jvm" isDepressed={true} />
      <Button text="js" />
      <Button text="go" />
      <Button text="..." />
    </div>
  );
}

type ButtonProps = {
  text: string;
  isDepressed?: boolean;
};

function Button({ text, isDepressed = false }: ButtonProps) {
  // Can't apply TW classes with JS. Custom stuff has to use the old fashioned approach.
  let style: CSSProperties;
  if (isDepressed) {
    style = {
      color: "#FFF",
      backgroundColor: "#63B9E3",
    };
  } else {
    style = {
      //   boxShadow: "2px 2px 1px #000", // mobile
      //   boxShadow: "4px 4px 2px #000", // tablet
      boxShadow: "4px 4px 2px #000", // desktop
      color: "#000",
    };
  }
  return (
    <div
      className={clsx([
        "flex",
        "w-[44px]",
        "justify-center",
        "rounded-md",
        "border",
        "border-2",
        "border-black",
        "hover:!text-white",
        "hover:bg-blue",
        "cursor-pointer",
        "text-[14px]",
        "tablet:w-[73px]",
        "tablet:text-[22px]",
        "tablet:border-[3px]",
        "tablet:rounded-lg",
        "desktop:w-[110px]",
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
