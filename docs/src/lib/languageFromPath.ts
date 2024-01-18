export const languageSlugsToLabels = {
  jvm: "jvm",
  js: "js",
  py: "py",
  "other-platforms": "...",
};

export type LanguageSlug = keyof typeof languageSlugsToLabels;

export type PathParts = {
  language: LanguageSlug;
  subpath: "" | "get-started" | "advanced";
  is404: boolean;
};

export function getPathParts(path: string): PathParts {
  const splitPath = path.split("/");
  return {
    language: languageSlugsToLabels[splitPath[1] as LanguageSlug] || "jvm",
    subpath: splitPath.length === 3 ? splitPath[2] : "",
  } as PathParts;
}
