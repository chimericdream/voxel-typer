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
import a11y from "./a11y";
import placement from "./placement";
import profiles from "./profiles";
import settings from "./settings";
import lessonsBirch from "./lessons-birch";
import lessonsShore from "./lessons-shore";
import lessonsFrosty from "./lessons-frosty";
import achievements from "./achievements";
import importexport from "./importexport";
import mobs from "./mobs";
import builder from "./builder";
import defense from "./defense";
import parent from "./parent";

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
  a11y,
  placement,
  profiles,
  settings,
  lessonsBirch,
  lessonsShore,
  lessonsFrosty,
  achievements,
  importexport,
  mobs,
  builder,
  defense,
  parent,
} as const;

export default en;
