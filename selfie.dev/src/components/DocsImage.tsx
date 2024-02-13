import clsx from "clsx";

const BASE_URL = "https://selfie.dev"

interface DocsImageProps {
    imgAbsoluteUrl: string;
}

export function DocsImage(props: DocsImageProps) {
  if (!props.imgAbsoluteUrl.startsWith(BASE_URL)) {
   throw new Error("imgAbsoluteUrl must start with " + BASE_URL);
  }
  return (
    <img
      src={props.imgAbsoluteUrl.substring(BASE_URL.length)}
      className={clsx(["wide-phone:w-2/4", "wide-phone:float-left"])}
    />
  );
}
