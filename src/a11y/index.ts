/**
 * Accessibility (task M3-07, PLAN.md §4.6): reduced motion, the flash guard, page look settings
 * (high contrast, letter size, fonts), finger labels, read-aloud and screen-reader announcements.
 * Each module's header says where it is wired.
 */
export { allowFlash, flashGuard, FLASH_WINDOW_MS, MAX_FLASHES } from "./flashes";
export { createFlashGuard, planFlashes } from "./flash-guard";
export type { FlashGuard, FlashGuardOptions } from "./flash-guard";
export { guardHeldActivation, isHeldActivation } from "./key-repeat";
export {
  appMotion,
  createMotionFlag,
  reducedMotion,
  resolveReducedMotion,
  setMotionSetting,
} from "./motion";
export type { MotionFlag, MotionSetting } from "./motion";
export { fingerLabelsOn, hearAgainKey, hearAgainShown } from "./options";
export { applyFont, applyPageSettings, fontOverrides } from "./page";
export { announcementFor, attachRouteAnnouncer } from "./route-announcer";
export { browserVoices, watchLocalVoice } from "./voice";
