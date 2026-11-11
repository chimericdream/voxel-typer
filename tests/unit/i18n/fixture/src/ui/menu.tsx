/** Fixture for tests/unit/i18n/keys.test.ts: t() calls the scanner must find. */
const t = (key: string, params?: Record<string, string | number>): string =>
  params ? `${key}:${JSON.stringify(params)}` : key;

export const play = t("menu.play");
export const quit = t("menu.quit", { n: 1 });
// t("lesson.alsoNeverUsed") in a comment is not a use.
export const typo = t(`menu.plya`);
export const biome = (id: string): string => t(`menu.biome.${id}`);
export const gone = t("shop.title");
export const notAKey = "menu.neverUsedd";
