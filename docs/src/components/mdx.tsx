import clsx from "clsx";
import { createContext, useContext } from "react";

type ParentComponentProps = {
  children?: React.ReactNode;
};

export function Row({ children }: ParentComponentProps) {
  return (
    <div className="grid grid-cols-1 items-start gap-x-16 gap-y-10 xl:max-w-none xl:grid-cols-2">
      {children}
    </div>
  );
}

type ColProps = ParentComponentProps & {
  sticky?: boolean;
};

export function Col({ children, sticky = false }: ColProps) {
  return (
    <div
      className={clsx(
        "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
        sticky && "xl:sticky xl:top-24"
      )}
    >
      {children}
    </div>
  );
}

const CodeBlockContext = createContext(false);

export function code({ children, ...props }: ParentComponentProps) {
  let isBlock = useContext(CodeBlockContext);
  const className = isBlock
    ? ""
    : clsx([
        "bg-grey",
        "px-[14px]",
        "pt-[6px]",
        "pb-[2px]",
        "rounded",
        "text-sm",
        "desktop:text-base",
        "leading-[1.5em]",
      ]);
  return children ? (
    <code
      {...props}
      className={className}
      dangerouslySetInnerHTML={{ __html: children }}
    />
  ) : (
    <code {...props} className={className} />
  );
}

export function pre({ children, ...props }: ParentComponentProps) {
  return (
    <CodeBlockContext.Provider value={true}>
      <div
        className={clsx([
          "rounded-2xl",
          "bg-grey/60",
          "shadow",
          "text-sm",
          "desktop:text-base",
          "overflow-hidden",
          "leading-[1.5em]",
        ])}
      >
        <pre className="overflow-scroll p-4" {...props}>
          {children}
        </pre>
      </div>
    </CodeBlockContext.Provider>
  );
}

export function p({ children, ...props }: ParentComponentProps) {
  return (
    <p {...props} className="py-[13px]">
      {children}
    </p>
  );
}

export function h2({ children, ...props }: ParentComponentProps) {
  return (
    <>
      <br />
      <h2 {...props}>{children}</h2>
    </>
  );
}

export function a({ children, ...props }: ParentComponentProps) {
  // TODO: contrast issue against the transparent Selfie bot
  return (
    <a {...props} className="text-blue hover:underline">
      {children}
    </a>
  );
}

export function ul({ children, ...props }: ParentComponentProps) {
  return (
    <ul {...props} className="list-inside list-disc">
      {children}
    </ul>
  );
}
