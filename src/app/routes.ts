/**
 * Typed routes (task M2-10, PLAN.md §5.3).
 *
 * The app is a small state machine over these screens. A route without a screen file shows the
 * friendly "coming soon" panel, so every route works from day one.
 *
 * **Append-only** (docs/impl/contracts.md §0): to add a screen, write `src/ui/screens/<Screen>.tsx`
 * (default export: a component taking {@link ScreenProps}) and add ONE line at the end of
 * {@link screens}. Don't reorder or edit other lines. A new route id goes at the end of
 * {@link ROUTE_IDS}.
 */
import type { ComponentType } from "preact";
import type { LessonId } from "@/types/core";
import type { ScreenProps } from "./types";

/** Every route id. `as const` keeps them a literal union. */
export const ROUTE_IDS = [
  "splash",
  "profiles",
  "profileCreate",
  "map",
  "lessonIntro",
  "play",
  "results",
  "island",
  "inventory",
  "achievements",
  "settings",
  "parent",
  "privacy",
] as const;

export type RouteId = (typeof ROUTE_IDS)[number];

/** A place in the app. `lesson` is set for `lessonIntro`, `play` and `results`. */
export interface Route {
  id: RouteId;
  lesson?: LessonId;
}

export function isRouteId(v: unknown): v is RouteId {
  return typeof v === "string" && (ROUTE_IDS as readonly string[]).includes(v);
}

/** Routes that show the footer disclaimer (PLAN.md §1). */
export const FOOTER_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>(["splash", "privacy"]);

/** A lazily loaded screen, so each screen stays out of the initial bundle until it's shown. */
export type ScreenLoader = () => Promise<{ default: ComponentType<ScreenProps> }>;

/**
 * Screen files by route. `play` is drawn by the app itself (`PlayView`), not by a screen file.
 * Append one line per screen, at the end.
 */
export const screens: Partial<Record<RouteId, ScreenLoader>> = {
  // M2-11 and later screens: `splash: () => import("@/ui/screens/Splash"),`
  splash: () => import("@/ui/screens/Splash"),
  profiles: () => import("@/ui/screens/Profiles"),
  profileCreate: () => import("@/ui/screens/ProfileCreate"),
  lessonIntro: () => import("@/ui/screens/LessonIntro"),
  results: () => import("@/ui/screens/Results"),
  privacy: () => import("@/ui/screens/Privacy"),
};
