import clsx from "clsx";
export function Selfie() {
  return (
    <span
      className={clsx([
        "inline",
        "bg-gradient-to-r",
        "from-blue",
        "via-green",
        "to-red",
        "bg-clip-text",
        "font-logo",
        "text-[47px]",
        "leading-none",
        "text-transparent",
        "desktop:text-[70px]",
      ])}
    >
      selfie
    </span>
  );
}
