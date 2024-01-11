import { SVGProps } from "react";

export function Popout(props: SVGProps<SVGSVGElement>) {
  return (
    <svg fill="#FFF" viewBox="0 0 32 32" {...props}>
      <path d="M15.694 13.541l2.666 2.665 5.016-5.017 2.59 2.59 0.004-7.734-7.785-0.046 2.526 2.525-5.017 5.017zM25.926 16.945l-1.92-1.947 0.035 9.007-16.015 0.009 0.016-15.973 8.958-0.040-2-2h-7c-1.104 0-2 0.896-2 2v16c0 1.104 0.896 2 2 2h16c1.104 0 2-0.896 2-2l-0.074-7.056z" />
    </svg>
  );
}
