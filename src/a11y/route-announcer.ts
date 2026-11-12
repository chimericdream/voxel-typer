/**
 * Screen-reader announcements for menu changes and lesson results (task M3-07, PLAN.md §4.6).
 *
 * When the route changes, the new screen's name is read out politely through the page's one live
 * region (`announce` in `src/ui/kit/announce.ts`, outside `#app`, shared with toasts). Results also
 * say the stars and the warm message, because Results moves focus to its first button and a
 * screen reader would otherwise read only that button.
 *
 * Never per keystroke: play itself announces nothing here. In play the word display has its own
 * name, and the HUD's one message at a time (Caps Lock hint over the banner, decision 76) is read by
 * its toast.
 */
import { effect } from "@preact/signals";
import type { ReadonlySignal } from "@preact/signals";
import type { Route, RouteId } from "@/app/routes";
import type { Lesson } from "@/content/lessons/types";
import { t } from "@/i18n";
import type { ModeResult } from "@/modes/types";
import type { AgeBand } from "@/types/core";
import { messageText } from "@/ui/screens/results-logic";

export interface RouteAnnouncerDeps {
  /** The shell's route signal. */
  route: ReadonlySignal<Route>;
  /** True when a screen file exists for the route (otherwise the "coming soon" panel shows). */
  hasScreen(id: RouteId): boolean;
  lesson(id: string): Lesson | null;
  lastResult(): ModeResult | null;
  band(): AgeBand | null;
  /** Reads the text out (the kit's `announce`). */
  say(text: string): void;
}

/** Names of screens that later cards add; until then their routes show "coming soon". */
function screenName(id: RouteId): string | null {
  switch (id) {
    case "splash":
      return t("screens.splash.press");
    case "profiles":
      return t("profiles.title");
    case "profileCreate":
      return t("screens.profileCreate.title");
    case "map":
      return t("map.title");
    case "privacy":
      return t("screens.privacy.title");
    case "island":
      return t("a11y.screen.island");
    case "inventory":
      return t("a11y.screen.inventory");
    case "achievements":
      return t("a11y.screen.achievements");
    case "settings":
      return t("a11y.screen.settings");
    case "parent":
      return t("a11y.screen.parent");
    default:
      return null;
  }
}

/** What to read out on arriving at `route`, or null for nothing. */
export function announcementFor(
  route: Route,
  deps: Pick<RouteAnnouncerDeps, "hasScreen" | "lesson" | "lastResult" | "band">,
): string | null {
  // Play announces nothing: the word display and the HUD message speak for themselves.
  if (route.id === "play") return null;
  if (!deps.hasScreen(route.id)) return t("screens.comingSoon.title");
  const lesson = route.lesson === undefined ? null : deps.lesson(route.lesson);
  if (route.id === "lessonIntro") {
    return lesson ? t("a11y.lessonIntro", { title: t(lesson.titleKey) }) : null;
  }
  if (route.id === "results") {
    const result = deps.lastResult();
    if (result === null) return t("screens.results.title");
    return t("a11y.results", {
      stars: t("screens.results.stars", { count: result.stars }),
      message: messageText(result.stars, deps.band() ?? "miner"),
    });
  }
  return screenName(route.id);
}

/**
 * Announces each route change (not the first screen: the page itself is read on load). Returns a
 * function that stops it.
 */
export function attachRouteAnnouncer(deps: RouteAnnouncerDeps): () => void {
  let last: string | null = null;
  return effect(() => {
    const route = deps.route.value;
    const id = `${route.id}:${route.lesson ?? ""}`;
    if (last === null) {
      last = id;
      return;
    }
    if (id === last) return;
    last = id;
    const text = announcementFor(route, deps);
    if (text !== null) deps.say(text);
  });
}
