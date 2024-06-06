import { Popout } from "./Icons/Popout";

type HeadingPopoutProps = {
  destinationUrl: string;
};

export function HeadingPopout({ destinationUrl }: HeadingPopoutProps) {
  return (
    <a href={destinationUrl}>
      <Popout />
    </a>
  );
}
