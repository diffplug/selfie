import clsx from "clsx";
export default function Custom404() {
  return (
    <>
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
              "max-w-[1300px]",
              "overflow-hidden",
              "bg-[url('/fumble.webp')]",
              "bg-cover",
              "bg-no-repeat",
              "bg-top",
              "flex",
              "items-center",
              "justify-center",
              "m-auto",
            ])}
          >
            <h1 className="relative text-center text-xl text-white backdrop-blur-sm wide-phone:text-2xl">
              404 - Page not found
            </h1>
          </div>
        </div>
      </div>
    </>
  );
}
