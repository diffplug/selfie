import clsx from "clsx/lite";
import { useEffect, useRef, useState } from "react";
import { Horse } from "./Horse";
import { Car } from "./Car";

export function FooterCTA() {
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageHeight, setImageHeight] = useState(0);

  function setImageHeightFromRef() {
    setImageHeight(imageRef.current!.height);
  }

  function handleScroll() {
    if (!imageHeight) {
      setImageHeightFromRef();
    }
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
    window.addEventListener("resize", setImageHeightFromRef, false);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", setImageHeightFromRef);
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
        className={clsx(
          "w-full", // spacer under the images to allow for more scrolling
          "relative",
          "z-0"
        )}
      ></div>
      <div
        style={{ height: imageHeight }}
        className={clsx(
          "max-w-full", // sticky image container
          "sticky",
          "bottom-0",
          "z-10"
        )}
      >
        <div
          style={{ height: imageHeight, maxHeight: imageHeight }}
          className={clsx(
            "animate-shrink-with-scroll",
            "overflow-hidden",
            "absolute",
            "top-0",
            "z-20",
            "left-0",
            "right-0",
            "mx-[-0.5rem]",
            "wide-phone:mx-[-1rem]"
          )}
        >
          <Horse imageRef={imageRef} setImageHeight={setImageHeight} />
        </div>
        <Car imageHeight={imageHeight} />
      </div>
    </div>
  );
}
