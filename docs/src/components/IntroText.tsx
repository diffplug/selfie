import clsx from "clsx";
import { Button } from "./Button";

export function IntroText() {
  return (
    <div
      className={clsx([
        "w-full",
        "flex",
        "flex-col",
        "absolute",
        "top-[529px]",
        "px-2",
        "gap-[30px]",
        "wide-phone:top-[184px]",
        "wide-phone:items-end",
        "wide-phone:text-right",
      ])}
    >
      <p className={clsx(["text-[20px]", "leading-[1.25em]"])}>
        Which is <br /> <Link href="#literal">literal</Link>,{" "}
        <Link href="#lensable">lensable</Link>
        <br /> and <Link href="#like-a-filesytem">like a filesystem</Link>
      </p>
      <Button text="get started" isWide={true} />
      <div
        className={clsx([
          "text-[18px]",
          "leading-[1.2em]",
          "grid",
          "gap-[30px]",
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

type LinkProps = {
  href: string;
  children: React.ReactNode;
};
function Link({ href, children }: LinkProps) {
  return (
    <a href={href} className="cursor-pointer underline">
      {children}
    </a>
  );
}
