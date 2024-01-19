import clsx from "clsx";
import { HeadingPopout } from "./HeadingPopout";
import { Selfie } from "./Selfie";
import { HeadingAnchor } from "./HeadingAnchor";

type NavHeadingProps = {
  text: string;
  popout: string;
};

export function NavHeading({ text, popout }: NavHeadingProps) {
  return (
    <>
      <br />
      <div className={clsx(["flex", "items-end", "justify-between"])}>
        <h2 id={text} className="group flex items-end">
          <Selfie /> is {text.replace(/\-/g, " ")}{" "}
          <HeadingAnchor className="translate-y-[-10px]" slug={text} />
        </h2>
        <HeadingPopout currentHeading={text} destinationUrl={popout} />
      </div>
    </>
  );
}
