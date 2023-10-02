import clsx from "clsx";
import { Button } from "./Button";

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
