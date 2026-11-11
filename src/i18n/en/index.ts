/**
 * English strings, one namespace per file (docs/impl/contracts.md §0, §11).
 *
 * To add a namespace: write `./<namespace>.ts` with `export default { … } as const`, then add ONE
 * import line and ONE entry in `en`, each at the end of its list. Append only; don't reorder or
 * edit other tasks' lines.
 */
import common from "./common";

const en = {
  common,
} as const;

export default en;
