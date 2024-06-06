import clsx from "clsx/lite";
export function Logo() {
  return (
    <h1
      className={clsx(
        "inline",
        "bg-gradient-to-r",
        "from-blue",
        "via-green",
        "to-red",
        "bg-clip-text",
        "font-logo",
        "text-[72px]",
        "tablet:text-[99px]",
        "leading-none",
        "text-transparent",
        "drop-shadow-logo",
        "wide-phone:drop-shadow-logo-wide-phone",
        "tablet:drop-shadow-logo-tablet",
        "desktop:text-[148px]",
        "desktop:drop-shadow-logo-desktop"
      )}
    >
      selfie
    </h1>
  );
}
