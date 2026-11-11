// A registry that doesn't match the folder: "missing" has no file, extra.txt isn't listed.
// oxfmt-ignore
export const POOL_IDS = [
  "listed",
  "missing",
  "listed",
] as const;
