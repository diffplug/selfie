import clsx from "clsx";
import Link from "next/link";
import { Button } from "./Button";
import { useRouter } from "next/dist/client/router";
import { languageFromPath } from "@/lib/languageFromPath";

export function ButtonList() {
  const router = useRouter();
  const selectedLanguage = languageFromPath(router.pathname);
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
      <Link href="/jvm">
        <Button isDepressed={["jvm", ""].includes(selectedLanguage)}>
          jvm
        </Button>
      </Link>
      <Link href="/js">
        <Button isDepressed={selectedLanguage === "js"}>js</Button>
      </Link>
      <Link href="/other-platforms">
        <Button isDepressed={selectedLanguage === "go"}>go</Button>
      </Link>
      <Link href="/other-platforms">
        <Button isDepressed={selectedLanguage === "other-platforms"}>
          ...
        </Button>
      </Link>
    </div>
  );
}
