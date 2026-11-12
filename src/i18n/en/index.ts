/**
 * English strings, one namespace per file (docs/impl/contracts.md §0, §11).
 *
 * To add a namespace: write `./<namespace>.ts` with `export default { … } as const`, then add ONE
 * import line and ONE entry in `en`, each at the end of its list. Append only; don't reorder or
 * edit other tasks' lines.
 */
import common from "./common";
import blocks from "./blocks";
import lessonsMeadow from "./lessons-meadow";
import app from "./app";
import keyboard from "./keyboard";
import screens from "./screens";
import hud from "./hud";
import mine from "./mine";
import map from "./map";
import placement from "./placement";

const en = {
  common,
  blocks,
  lessonsMeadow,
  app,
  keyboard,
  screens,
  hud,
  mine,
  map,
  placement,
} as const;

export default en;
