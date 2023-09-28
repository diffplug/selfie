import { CSSProperties } from "react";

export function ButtonList() {
  return (
    <div className="align-center flex w-[187px] flex-row justify-between">
      <Button text="jvm" isDepressed={true} />
      <Button text="js" />
      <Button text="go" />
      <Button text="..." />
    </div>
  );
}

type ButtonProps = {
  text: string;
  isDepressed?: boolean;
};

function Button({ text, isDepressed = false }: ButtonProps) {
  // Can't apply TW classes with JS. Custom stuff has to use the old fashioned approach.
  let style: CSSProperties;
  if (isDepressed) {
    style = {
      color: "#FFF",
      backgroundColor: "#63B9E3",
    };
  } else {
    style = {
      boxShadow: "2px 2px 1px #000",
      color: "#000",
    };
  }
  return (
    <div
      className="flex w-[44px] justify-center rounded-md border border-2 border-black"
      style={style}
    >
      {text}
    </div>
  );
}
