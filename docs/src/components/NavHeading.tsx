import clsx from "clsx";
import { Selfie } from "./Selfie";

type NavHeadingProps = {
  text: string;
};

export function NavHeading({ text }: NavHeadingProps) {
  return (
    <>
      <br />
      <h2 id={text}>
        <Selfie /> is {text}
      </h2>
    </>
  );
}
