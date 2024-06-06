import clsx from "clsx/lite";

type SelfieProps = {
  className?: string;
};

export function Selfie({ className }: SelfieProps) {
  return (
    <span
      className={clsx(
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
        className
      )}
    >
      selfie
    </span>
  );
}
