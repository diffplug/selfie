import { CSSProperties } from "react";

export function Logo() {
  let style: CSSProperties = {
    // fontSize: "148px", // Desktop
    // filter: "drop-shadow(5px 5px 2px #000)", // Desktop
    fontSize: "72px",
    filter: "drop-shadow(3px 3px 2px #000)",
  };

  return (
    <h1 className="inline bg-gradient-to-r from-blue via-green to-red bg-clip-text font-logo text-[72px] text-transparent drop-shadow-logo">
      Selfie
    </h1>
  );
}
