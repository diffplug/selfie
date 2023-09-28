import { ButtonList } from "./ButtonList";
import { Logo } from "./Logo";

export function Hero() {
  return (
    <div className="flex justify-between px-2">
      <Logo />
      <div className="flex flex-col justify-center">
        <p className="font-sans text-[22px]">snapshot testing for</p>
        <ButtonList />
      </div>
    </div>
  );
}
