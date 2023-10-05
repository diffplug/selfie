import clsx from "clsx";
import { useEffect, useRef } from "react";

export function Mascot() {
  const literalOffsetTop = useRef(0);

  useEffect(() => {
    const literalSection = document.getElementById("literal")!;
    literalOffsetTop.current = literalSection.offsetTop;

    if (window.scrollY > 1000) {
      setScrollPositionVariables();
    }

    function setScrollPositionVariables() {
      // 0 at the stop of the page, 1 at the bottom of the page
      const pageScrollOffset =
        window.scrollY / (document.body.offsetHeight - window.innerHeight);
      document.body.style.setProperty("--page-scroll", "" + pageScrollOffset);

      // 0 at the top of the page, 1 when the literal section comes into view. Don't exceed 1.
      document.body.style.setProperty(
        "--literal-scroll",
        "" + Math.min(window.scrollY / literalOffsetTop.current, 1)
      );
    }

    function setViewportVariables() {
      document.body.style.setProperty(
        "--innerHeight",
        "-" + window.innerHeight + "px"
      );
      literalOffsetTop.current = literalSection.offsetTop;
    }

    setViewportVariables();

    window.addEventListener("scroll", setScrollPositionVariables, false);
    window.addEventListener("resize", setViewportVariables, false);
    return () => {
      window.removeEventListener("scroll", setScrollPositionVariables);
      window.removeEventListener("resize", setViewportVariables);
    };
  }, []);

  return (
    <img
      src="/mascot.webp"
      alt="Selfie mascot"
      className={clsx([
        "max-w-[830px]",
        "h-[1745px]",
        "fixed",
        "top-[80px]",
        "left-[-200px]",
        "object-cover",
        "object-left",
        "animate-slide-and-fade",
        "block",
        "z-[-1]",
        "opacity-100",
        "wide-phone:top-[145px]",
        "tablet:top-[30px]",
        "desktop:max-w-[1245px]",
        "desktop:h-[2616px]",
        "desktop:left-[-250px]",
        "xl:absolute",
        "xl:left-[-250px]",
      ])}
    />
  );
}
