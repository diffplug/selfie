import { getPathParts } from "@/lib/languageFromPath";
import clsx from "clsx";
import { useRouter } from "next/router";
import { HeadingPopout } from "./HeadingPopout";
import { Selfie } from "./Selfie";

type NavHeadingProps = {
  text: string;
};

export function NavHeading({ text }: NavHeadingProps) {
  const router = useRouter();
  const pathParts = getPathParts(router.pathname);
  if (!pathParts.language) {
    pathParts.language = "jvm";
  }

  return (
    <>
      <br />
      <div className={clsx(["flex", "items-end", "justify-between"])}>
        <h2 id={text}>
          <Selfie /> is {text.replace(/\-/g, ' ')}{" "}
        </h2>
        <HeadingPopout
          currentHeading={text}
          pathParts={pathParts}
        />
      </div>
    </>
  );
}
