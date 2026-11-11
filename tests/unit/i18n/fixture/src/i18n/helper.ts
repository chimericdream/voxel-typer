/** Inside src/i18n/: definitions, not uses. This call must not count as a use of menu.neverUsed. */
const t = (key: string): string => key;
export const ignored = t("menu.neverUsed");
