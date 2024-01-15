import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { FOOTER_IMG_HEIGHT } from "./constants";
import { Horse } from "./Horse";
import { Car } from "./Car";

// STYLES IN COMMENTS REQUIRED FOR TAILWIND TO INCLUDE THEM
// h-[568px] w-[1136px] max-h-[568px] min-h-[568px]
// max-h-[568px] w-[1136px] max-h-[568px] min-h-[568px]

export function FooterCTA() {
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageHeight, setImageHeight] = useState(0);

  function handleResize() {}

  function handleScroll() {
    if (!footerRef.current || !spacerRef.current) return;
    // 0 at the current scroll position, 1 at the bottom of the page
    const topOfHorseFromBottomOfScreen =
      window.innerHeight - spacerRef.current.getBoundingClientRect().top;

    let horseHeightScale: number;
    if (topOfHorseFromBottomOfScreen < imageHeight) {
      horseHeightScale = 0;
    } else if (topOfHorseFromBottomOfScreen > imageHeight * 2) {
      horseHeightScale = 1;
    } else {
      horseHeightScale =
        (topOfHorseFromBottomOfScreen - imageHeight) / imageHeight;
    }
    footerRef.current!.style.setProperty(
      "--horse-height-scale",
      "" + horseHeightScale
    );
  }

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, false);
    window.addEventListener("resize", handleResize, false);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [imageHeight]);

  return (
    <div
      ref={footerRef}
      style={{ transform: "translateY(var(--footer-translate-y))" }}
    >
      <div
        ref={spacerRef}
        style={{ height: imageHeight }}
        className={clsx([
          "w-full", // spacer under the images to allow for more scrolling
          "relative",
          "z-0",
        ])}
      ></div>
      <div
        className={clsx([
          "max-w-full", // sticky image container
          "sticky",
          "bottom-0",
          `h-[${FOOTER_IMG_HEIGHT}px]`,
          "z-10",
        ])}
      >
        <div
          className={clsx([
            `h-[${FOOTER_IMG_HEIGHT}px]`,
            `max-h-[${FOOTER_IMG_HEIGHT}px]`, // animates to zero
            "animate-shrink-with-scroll",
            "overflow-hidden",
            "absolute",
            "top-0",
            "z-20",
            "left-0",
            "right-0",
          ])}
        >
          <Horse imageRef={imageRef} setImageHeight={setImageHeight} />
        </div>
        <Car />
      </div>
    </div>
  );
}
