import clsx from "clsx/lite";
import slugify from "@sindresorhus/slugify";
import { Button } from "./Button";
import Link from "next/link";
import { useRouter } from "next/router";
import { getPathParts } from "@/lib/languageFromPath";

const THE_CONTEXT_WINDOW =
  "https://thecontextwindow.ai/p/temporarily-embarrassed-snapshots";

export function IntroText() {
  const router = useRouter();
  const selectedLanguage = getPathParts(router.pathname).language;

  return (
    <div
      className={clsx(
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
        "desktop:top-[345px]"
      )}
    >
      <p
        className={clsx(
          "text-[20px]",
          "leading-[1.25em]",
          "tablet:text-[30px]",
          "desktop:text-[45px]"
        )}
      >
        Which is <br className="tablet:hidden" />{" "}
        <SectionLink title="literal" />, <SectionLink title="lensable" />
        <br /> and <SectionLink title="like a filesystem" />
      </p>
      <Link href={`/${selectedLanguage}/get-started`}>
        <Button
          className={clsx(
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
            "hover:bg-blue"
          )}
        >
          get started
        </Button>
      </Link>
      <div
        className={clsx(
          "text-[18px]",
          "leading-[1.2em]",
          "grid",
          "gap-[30px]",
          "tablet:text-[22px]",
          "desktop:text-[34px]"
        )}
      >
        <p>
          Snapshot testing is the <br />{" "}
          <a
            href={THE_CONTEXT_WINDOW}
            className="text-blue hover:underline cursor-pointer"
          >
            fastest and most precise
          </a>
          <br />
          mechanism to{" "}
          <a
            href={THE_CONTEXT_WINDOW}
            className="text-red hover:underline cursor-pointer"
          >
            record <br /> and specify
          </a>{" "}
          the <br />
          <a
            href={THE_CONTEXT_WINDOW}
            className="text-green hover:underline cursor-pointer"
          >
            behavior of your <br />
            system and its <br />
            components
          </a>
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
