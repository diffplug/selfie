import clsx from "clsx";
import { Selfie } from "./Selfie";
import { useRouter } from "next/router";
import { LanguageSlug, getPathParts } from "@/lib/languageFromPath";
import { useState } from "react";
import { HeadingLanguageSelect } from "./HeadingLanguageSelect";

type NavHeadingProps = {
  text: string;
};

export function NavHeading({ text }: NavHeadingProps) {
  const router = useRouter();
  const pathParts = getPathParts(router.pathname);
  if (!pathParts.language) {
    pathParts.language = "jvm";
  }

  function handleChange(value: LanguageSlug) {
    let nextRoute = "/" + value;
    if (pathParts.subpath) {
      nextRoute += "/" + pathParts.subpath;
    }
    router.push(nextRoute + `#${text}`);
    setSelectIsOpen(false);
  }

  const [selectIsOpen, setSelectIsOpen] = useState<boolean>(false);

  return (
    <>
      <br />
      <div className={clsx(["flex", "items-end", "justify-between"])}>
        <h2 id={text}>
          <Selfie /> is {text}{" "}
        </h2>
        <HeadingLanguageSelect
          pathParts={pathParts}
          isOpen={selectIsOpen}
          setSelectIsOpen={setSelectIsOpen}
          handleChange={handleChange}
        />
      </div>
    </>
  );
}
