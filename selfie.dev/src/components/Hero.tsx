import clsx from "clsx/lite";
import { ButtonList } from "./ButtonList";
import { IntroText } from "./IntroText";
import { Logo } from "./Logo";
import { Mascot } from "./Mascot";

export function Hero() {
  return (
    <div
      className={clsx(
        "relative",
        "h-[1009px]",
        "wide-phone:h-[664px]",
        "tablet:h-[825px]",
        "desktop:h-[1150px]"
      )}
    >
      <Mascot />
      <div
        className={clsx(
          "flex",
          "justify-between",
          "wide-phone:block",
          "wide-phone:text-right"
        )}
      >
        <Logo />
        <div
          className={clsx(
            "flex",
            "flex-col",
            "justify-between",
            "pt-3",
            "wide-phone:p-0",
            "wide-phone:justify-center",
            "wide-phone:items-end",
            "wide-phone:h-[70px]",
            "tablet:h-[140px]",
            "tablet:gap-[15px]"
          )}
        >
          <p
            className={clsx(
              "font-sans",
              "text-[16px]",
              "wide-phone:text-[30px]",
              "wide-phone:mb-2",
              "tablet:text-[40px]",
              "desktop:text-[60px]"
            )}
          >
            snapshot testing for
          </p>
          <ButtonList />
        </div>
      </div>
      <IntroText />
    </div>
  );
}
