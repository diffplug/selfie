import { useEffect, useState } from "react";

export function useResizing() {
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    function doneResizing() {
      setResizing(false);
    }
    function handleResize() {
      setResizing(true);
      clearTimeout(timer);

      timer = setTimeout(doneResizing, 100);
    }
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return resizing;
}
