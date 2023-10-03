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
      <Button href="/jvm" text="jvm" isDepressed={true} />
      <Button href="/js" text="js" />
      <Button href="/other-platforms" text="go" />
      <Button href="/other-platforms" text="..." />
    </div>
  );
}
