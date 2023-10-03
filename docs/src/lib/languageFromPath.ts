export const languageSlugsToLabels = {
  jvm: "jvm",
  js: "js",
  go: "go",
  "other-platforms": "...",
};

export type LanguageSlug = keyof typeof languageSlugsToLabels;

export type PathParts = {
  language: LanguageSlug;
  subpath: "" | "get-started" | "advanced";
};

// TODO handle 404s
export function getPathParts(path: string): PathParts {
  const splitPath = path.split("/");
  console.log(splitPath);
  return {
    language: splitPath[1],
    subpath: splitPath.length === 3 ? splitPath[2] : "",
  } as PathParts;
}
