export const languageSlugsToLabels = {
  jvm: "jvm",
  py: "py",
  js: "js",
  "other-platforms": "...",
};

export type LanguageSlug = keyof typeof languageSlugsToLabels;

export type PathParts = {
  language: LanguageSlug;
  subpath: "" | "get-started" | "facets" | "cache";
  is404: boolean;
};

export function getPathParts(path: string): PathParts {
  const splitPath = path.split("/");
  return {
    language: languageSlugsToLabels[splitPath[1] as LanguageSlug] || "jvm",
    subpath: splitPath.length === 3 ? splitPath[2] : "",
    is404: splitPath[1] === "404",
  } as PathParts;
}
