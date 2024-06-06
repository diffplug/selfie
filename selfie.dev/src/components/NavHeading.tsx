import { LanguageSlug, getPathParts } from "@/lib/languageFromPath";
import clsx from "clsx";
import { useRouter } from "next/router";
import { useState } from "react";
import { HeadingAnchor } from "./HeadingAnchor";
import { HeadingLanguageSelect } from "./HeadingLanguageSelect";
import { HeadingPopout } from "./HeadingPopout";
import { Selfie } from "./Selfie";

type NavHeadingProps = {
  text: string;
  popout: string;
};

export function NavHeading({ text, popout }: NavHeadingProps) {
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
        <h2 id={text} className={clsx(["group", "flex", "items-end"])}>
          <span>
            <Selfie /> is {text.replace(/\-/g, " ")}
          </span>
          {"\u00a0"}
          <HeadingPopout destinationUrl={popout} />
          <HeadingAnchor slug={text} />
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
