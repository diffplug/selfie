import clsx from "clsx";
export default function Custom404() {
  return (
    <div
      className={clsx([
        "fixed",
        "top-0",
        "bottom-0",
        "left-0",
        "right-0",
        "h-screen",
        "max-w-screen",
      ])}
    >
      <div
        className={clsx([
          "h-[100vh]",
          "absolute",
          "bottom-0",
          "left-0",
          "right-0",
          "max-w-screen",
        ])}
      >
        <div
          className={clsx([
            "h-full",
            "overflow-hidden",
            "bg-[url('/fumble.webp')]",
            "bg-cover",
            "bg-no-repeat",
            "bg-top",
          ])}
        ></div>
      </div>
    </div>
  );
}
