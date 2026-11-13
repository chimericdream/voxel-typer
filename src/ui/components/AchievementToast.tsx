/**
 * "New badge" toasts (task M3-10). The shell queues each badge as it is earned; this shows them
 * one at a time, each for {@link BADGE_TOAST_MS}, and only while `open` is true. The app keeps it
 * closed while a lesson is on (playing or paused), so a toast never comes up mid-word: it waits
 * for Results or the next screen. The kit Toast reads each one out through the page's live region, outside
 * `#app`. Its pop-in follows the shared motion flag (`--motion-ok`), so reduced motion shows it at
 * once.
 *
 * M3-FIX-8:
 * - A modal dialog (`showModal()`) makes the rest of the page inert, the live region too, so a
 *   toast shown under one is never read. While a modal is open the toast waits; a toast already
 *   up is put away and shown again, in full, when the modal closes.
 * - The toast sits below anything marked `data-toast-clear` (the World Map's corner buttons),
 *   measured, because at large text that row wraps and grows.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { achievementById } from "@/content/achievements";
import { t } from "@/i18n";
import { Toast } from "@/ui/kit/Toast";
import type { AchievementId } from "@/types/core";
import { BadgeIcon } from "./BadgeIcon";
import styles from "./Badge.module.css";

export const BADGE_TOAST_MS = 3500;

export interface AchievementToastProps {
  /** Badges waiting to be shown, oldest first. */
  queue: readonly AchievementId[];
  /** False while a child is typing. */
  open: boolean;
  /** The first badge has been shown long enough. */
  onShown: () => void;
}

/** An open modal dialog: the page outside it is inert. */
const MODAL = "dialog[open]";

/** True while a modal dialog is open in `doc`. Watches the page only while `watch` is true. */
export function useModalOpen(doc: Document, watch: boolean): boolean {
  const [modal, setModal] = useState(() => doc.querySelector(MODAL) !== null);
  useEffect(() => {
    if (!watch) return undefined;
    const check = (): void => setModal(doc.querySelector(MODAL) !== null);
    check();
    const view = doc.defaultView;
    if (!view || typeof view.MutationObserver !== "function") return undefined;
    const watcher = new view.MutationObserver(check);
    watcher.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => watcher.disconnect();
  }, [doc, watch]);
  return modal;
}

/** What the toast stays below. */
const CLEAR = "[data-toast-clear]";
/** Room between the toast and what it stays below, in px. */
const CLEAR_GAP_PX = 12;

/** The lowest bottom edge of the page's `data-toast-clear` elements, or null if there are none. */
export function clearBelow(doc: Document): number | null {
  let bottom: number | null = null;
  for (const el of doc.querySelectorAll(CLEAR)) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) continue;
    bottom = Math.max(bottom ?? 0, r.bottom);
  }
  return bottom;
}

/**
 * Keeps `ref`'s top below the `data-toast-clear` elements while it is shown: again when the window
 * or one of them resizes, and when the page changes (the map's corner comes back when an island's
 * lesson path closes).
 */
function useClearTop(ref: { current: HTMLElement | null }, shown: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!shown || !el) return undefined;
    const doc = el.ownerDocument;
    const view = doc.defaultView;
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(() => place()) : null;
    let watched: Element[] = [];
    function place(): void {
      const bottom = clearBelow(doc);
      if (bottom === null) el?.style.removeProperty("top");
      else el?.style.setProperty("top", `${Math.ceil(bottom) + CLEAR_GAP_PX}px`);
    }
    const rewatch = (): void => {
      const now = [...doc.querySelectorAll(CLEAR)];
      if (now.length === watched.length && now.every((c, i) => c === watched[i])) return;
      watched = now;
      sizes?.disconnect();
      for (const c of now) sizes?.observe(c);
      place();
    };
    rewatch();
    place();
    view?.addEventListener("resize", place);
    const changes =
      view && typeof view.MutationObserver === "function"
        ? new view.MutationObserver(rewatch)
        : null;
    changes?.observe(doc.body, { subtree: true, childList: true });
    return () => {
      view?.removeEventListener("resize", place);
      sizes?.disconnect();
      changes?.disconnect();
    };
  }, [ref, shown]);
}

export function AchievementToast({ queue, open, onShown }: AchievementToastProps) {
  const id = queue[0];
  const def = id === undefined ? null : achievementById(id);
  const modal = useModalOpen(document, open && id !== undefined);
  const showing = open && id !== undefined && !modal;
  const wrap = useRef<HTMLDivElement>(null);
  useClearTop(wrap, showing && def !== null);

  useEffect(() => {
    if (!showing) return undefined;
    // An id with no definition (an older or newer build's badge) is skipped at once.
    const timer = setTimeout(onShown, def === null ? 0 : BADGE_TOAST_MS);
    return () => clearTimeout(timer);
    // `queue` changes identity on every push; restart only when the shown badge changes.
  }, [showing, id, def, onShown]);

  if (!showing || def === null) return null;
  return (
    <div class={styles.toastWrap} data-testid="badge-toast" ref={wrap}>
      <Toast key={def.id} tone="cheer">
        <span class={styles.toastBody}>
          <BadgeIcon icon={def.icon} />
          <span>{t("achievements.toast", { name: t(def.nameKey) })}</span>
        </span>
      </Toast>
    </div>
  );
}
