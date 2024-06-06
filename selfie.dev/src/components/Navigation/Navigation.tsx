import { LanguageSlug, getPathParts } from "@/lib/languageFromPath";
import clsx from "clsx/lite";
import { useRouter } from "next/router";
import { useState } from "react";
import { LanguageSelect } from "./LanguageSelect";
import { SubNavigation } from "./SubNavigation";

export function Navigation() {
  const router = useRouter();
  const pathParts = getPathParts(router.pathname);

  function handleChange(value: LanguageSlug) {
    let nextRoute = "/" + value;
    if (pathParts?.subpath) {
      nextRoute += "/" + pathParts.subpath;
    }
    router.push(nextRoute);
    setSelectIsOpen(false);
  }

  const [selectIsOpen, setSelectIsOpen] = useState<boolean>(false);

  return (
    <div
      className={clsx(
        "relative",
        "flex",
        "justify-between",
        "gap-[10px]",
        "z-10",
        "overflow-hidden",
        "mb-[-4px]",
        "pb-[4px]"
      )}
    >
      {pathParts && (
        <>
          <LanguageSelect
            pathParts={pathParts}
            isOpen={selectIsOpen}
            setSelectIsOpen={setSelectIsOpen}
            handleChange={handleChange}
          />
          {pathParts.language !== "other-platforms" && (
            <SubNavigation pathParts={pathParts} selectIsOpen={selectIsOpen} />
          )}
        </>
      )}
    </div>
  );
}
