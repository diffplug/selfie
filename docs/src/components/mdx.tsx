import clsx from "clsx";

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

export function code({ children, ...props }: ParentComponentProps) {
  return children ? (
    <code {...props} dangerouslySetInnerHTML={{ __html: children }} />
  ) : (
    <code {...props} />
  );
}

export function pre({ children, ...props }: ParentComponentProps) {
  return (
    <div className={clsx(["rounded-2xl", "bg-grey/60", "shadow"])}>
      <pre className="overflow-scroll p-4" {...props}>
        {children}
      </pre>
    </div>
  );
}
