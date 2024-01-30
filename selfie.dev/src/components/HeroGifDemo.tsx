import clsx from "clsx";
import { Logo } from "./Logo";
import { Mascot } from "./Mascot";
import slugify from "@sindresorhus/slugify";
import { Button } from "./Button";
import Link from "next/link";

export function HeroGifDemo() {
  return (
    <div
      className={clsx([
        "relative",
        "h-[1009px]",
        "wide-phone:h-[664px]",
        "tablet:h-[825px]",
        "desktop:h-[1150px]",
      ])}
    >
      <Mascot />
      <div
        className={clsx([
          "flex",
          "justify-between",
          "wide-phone:block",
          "wide-phone:text-right",
        ])}
      >
        <Logo />
        <div
          className={clsx([
            "flex",
            "flex-col",
            "justify-between",
            "pt-3",
            "wide-phone:p-0",
            "wide-phone:justify-center",
            "wide-phone:items-end",
            "wide-phone:h-[70px]",
            "tablet:h-[140px]",
            "tablet:gap-[15px]",
          ])}
        >
          <p
            className={clsx([
              "font-sans",
              "text-[16px]",
              "wide-phone:text-[30px]",
              "wide-phone:mb-2",
              "tablet:text-[40px]",
              "desktop:text-[60px]",
            ])}
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


export function ButtonList() {
  return (
    <div
      className={clsx([
        "align-center",
        "flex",
        "flex-row",
        "justify-between",
        "wide-phone:w-[220px]",
        "tablet:w-[328px]",
        "desktop:w-[490px]",
      ])}
    >
      <Link href="/jvm">
        <Button
          className={unPressedClasses}
        >
          jvm
        </Button>
      </Link>
      <Link href="/js">
        <Button
          className={unPressedClasses}
        >
          js
        </Button>
      </Link>
      <Link href="/other-platforms">
        <Button
          className={unPressedClasses}
        >
          py
        </Button>
      </Link>
      <Link href="/other-platforms">
        <Button
          className={unPressedClasses}
        >
          ...
        </Button>
      </Link>
    </div>
  );
}

const sharedClasses = clsx([
  "w-[34px]",
  "h-[23px]",
  "rounded-[4px]",
  "text-[12px]",
  "wide-phone:w-[44px]",
  "tablet:w-[73px]",
  "desktop:w-[110px]",
  "hover:text-white",
  "hover:bg-blue",
]);

const unPressedClasses = clsx([
  "text-black",
  "bg-white",
  "shadow-button",
  "tablet:shadow-button-tablet",
  sharedClasses,
]);

export function IntroText() {
  return (
    <div
      className={clsx([
        "w-full",
        "flex",
        "flex-col",
        "absolute",
        "top-[529px]",
        "gap-[30px]",
        "wide-phone:top-[184px]",
        "wide-phone:items-end",
        "wide-phone:text-right",
        "tablet:top-[262px]",
        "tablet:gap-[40px]",
        "desktop:top-[345px]",
      ])}
    >
      <p
        className={clsx([
          "text-[20px]",
          "leading-[1.25em]",
          "tablet:text-[30px]",
          "desktop:text-[45px]",
        ])}
      >
        Which is <br className="tablet:hidden" />{" "}
        literal, lensable
        <br /> and like a filesystem
      </p>
      <Link href="/jvm/get-started">
        <Button
          className={clsx([
            "w-[154px]",
            "h-[35px]",
            "rounded-[10px]",
            "text-[22px]",
            "tablet:w-[154px]",
            "desktop:w-[232px]",
            "text-black",
            "bg-white",
            "shadow-button",
            "tablet:shadow-button-tablet",
            "hover:text-white",
            "hover:bg-blue",
          ])}
        >
          get started
        </Button>
      </Link>
      <div
        className={clsx([
          "text-[18px]",
          "leading-[1.2em]",
          "grid",
          "gap-[30px]",
          "tablet:text-[22px]",
          "desktop:text-[34px]",
        ])}
      >
        <p>
          Snapshot testing is the <br />{" "}
          <span className="text-blue">fastest and most precise</span>
          <br />
          mechanism to{" "}
          <span className="text-red">
            record <br /> and specify
          </span>{" "}
          the <br />
          <span className="text-green">
            behavior of your <br />
            system and its <br />
            components
          </span>
          .
        </p>
        <p>
          Robots are <br /> writing their <br />
          own code. Are
          <br /> you still writing
          <br />
          assertions by <br />
          hand?
        </p>
      </div>
    </div>
  );
}

type SectionLinkProps = {
  title: string;
};
function SectionLink({ title }: SectionLinkProps) {
  return (
    <Link
      href={`#${slugify(title)}`}
      scroll={false}
      className="cursor-pointer underline hover:text-blue"
    >
      {title}
    </Link>
  );
}
