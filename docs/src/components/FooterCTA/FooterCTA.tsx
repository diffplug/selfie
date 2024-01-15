import clsx from "clsx";
import { useEffect, useRef } from "react";
import { FOOTER_IMG_HEIGHT, FOOTER_IMG_WIDTH } from "./constants";
import { Horse } from "./Horse";

// STYLES IN COMMENTS REQUIRED FOR TAILWIND TO INCLUDE THEM
// h-[568px] w-[1136px] max-h-[568px] min-h-[568px]

export function FooterCTA() {
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);

  function handleScroll() {
    if (!footerRef.current || !spacerRef.current) return;
    // 0 at the current scroll position, 1 at the bottom of the page
    const topOfHorseFromBottomOfScreen =
      window.innerHeight - spacerRef.current.getBoundingClientRect().top;

    let horseHeightScale: number;
    if (topOfHorseFromBottomOfScreen < FOOTER_IMG_HEIGHT) {
      horseHeightScale = 0;
    } else if (topOfHorseFromBottomOfScreen > FOOTER_IMG_HEIGHT * 2) {
      horseHeightScale = 1;
    } else {
      horseHeightScale =
        (topOfHorseFromBottomOfScreen - FOOTER_IMG_HEIGHT) / FOOTER_IMG_HEIGHT;
    }
    footerRef.current!.style.setProperty(
      "--horse-height-scale",
      "" + horseHeightScale
    );

    const bottomOfDocument = document.body.scrollHeight;
    const currentPosition = window.innerHeight + window.scrollY;

    //  Set a variable to 0 when currentPosition is 0 bottomOfDocument - FOOTER_IMG_HEIGHT
    // and -FOOTER_IMG_HEIGHT when currentPosition is bottomOfDocument
    const distanceToBottom = bottomOfDocument - currentPosition;
    let footerTranslateY = distanceToBottom - FOOTER_IMG_HEIGHT;
    if (footerTranslateY > 0) {
      footerTranslateY = 0;
    }
    footerRef.current!.style.setProperty(
      "--footer-translate-y",
      "" + footerTranslateY + "px"
    );
  }

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, false);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div
      ref={footerRef}
      style={{ transform: "translateY(var(--footer-translate-y))" }}
    >
      <div
        ref={spacerRef}
        className={clsx([
          `h-[${FOOTER_IMG_HEIGHT}px]`, // spacer under the images to allow for more scrolling
          "w-full",
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
          <Horse />
        </div>
        <img
          src="/car.webp"
          className={clsx([
            `h-[${FOOTER_IMG_HEIGHT}px]`,
            `w-[${FOOTER_IMG_WIDTH}px]`,
            "left-0",
            "right-0",
            "z-10",
            "absolute",
            "top-0",
            "m-auto",
          ])}
        />
      </div>
    </div>
  );
}
