import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

const IMG_HEIGHT = 615; // 568 works for all screen sizes
export function FooterCTA() {
  const horseRef = useRef<HTMLElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);

  function handleScroll() {
    if (!horseRef.current || !footerRef.current || !spacerRef.current) return;
    // 0 at the current scroll position, 1 at the bottom of the page

    const topOfHorseFromBottomOfScreen =
      window.innerHeight - spacerRef.current.getBoundingClientRect().top;

    let horseHeightScale: number;
    if (topOfHorseFromBottomOfScreen < IMG_HEIGHT) {
      horseHeightScale = 0;
    } else if (topOfHorseFromBottomOfScreen > IMG_HEIGHT * 2) {
      horseHeightScale = 1;
    } else {
      horseHeightScale =
        (topOfHorseFromBottomOfScreen - IMG_HEIGHT) / IMG_HEIGHT;
    }
    footerRef.current!.style.setProperty(
      "--horse-height-scale",
      "" + horseHeightScale
    );
  }

  function addScrollListener() {
    window.addEventListener("scroll", handleScroll, false);
  }
  function removeScrollListener() {
    window.removeEventListener("scroll", handleScroll, false);
  }

  function onIntersect(entries: IntersectionObserverEntry[]) {
    if (entries[0].isIntersecting) {
      // Horse image is stuck to the bottom of the viewport
      addScrollListener();
    } else {
      // ScrollY is too low and the horse is out of view
      removeScrollListener();
    }
  }
  function createIntersectionObserver(horse: HTMLElement) {
    let options = {
      root: null,
      rootMargin: "0px",
      threshold: 1.0,
    };
    const observer = new IntersectionObserver(onIntersect, options);
    // Trigger an event when the horse image is 100% in view
    // observer.observe(horse);
    addScrollListener();
  }

  return (
    <div ref={footerRef}>
      <div
        ref={spacerRef}
        className={clsx([
          `h-[${IMG_HEIGHT}px]`, // spacer under the images to allow for more scrolling
          "w-full",
          "opacity-50",
          "relative",
          "z-0",
        ])}
      ></div>
      <div
        className={clsx([
          "max-w-full", // sticky image container
          "sticky",
          "bottom-0",
          `h-[${IMG_HEIGHT}px]`,
          "z-10",
          "relative",
        ])}
      >
        <div
          ref={(node) => {
            if (node) {
              createIntersectionObserver(node);
            }
            horseRef.current = node;
          }}
          className={clsx([
            `h-[${IMG_HEIGHT}px]`, // animate this to zero
            "animate-shrink-with-scroll",
            "overflow-hidden", // horse container
            "absolute",
            "top-0",
            "z-20",
          ])}
        >
          <img
            src="/horse.webp"
            className={clsx([`h-[${IMG_HEIGHT}px]`, `min-h-[${IMG_HEIGHT}px]`])}
          />
        </div>
        <img
          src="/car.webp"
          className={clsx([
            `h-[${IMG_HEIGHT}px]`,
            "w-full",
            "z-10",
            "absolute",
            "top-0", // car
          ])}
        />
      </div>
    </div>
  );
}
