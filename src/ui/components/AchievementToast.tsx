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
 *
 * M3-FIX-12:
 * - A screen can ask the toast to wait with `data-toast-hold` (Results does while its stars fill
 *   in). It is held like a modal: not drawn, read or timed until the mark goes.
 * - A screen with a `data-toast-dock` element gets the toast there instead of in the window's
 *   corner: centred on the dock, just below its top, and following it as the page scrolls. Results
 *   puts its dock under its buttons, so the toast never covers the card or the buttons. When the
 *   whole toast wouldn't fit between the dock and the window's bottom (a short window, large
 *   text), it isn't shown or read there at all: it stays queued for the next screen. A silent,
 *   hidden copy is measured first, because the kit Toast reads itself out as it mounts.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { achievementById } from "@/content/achievements";
import { t } from "@/i18n";
import { Toast } from "@/ui/kit/Toast";
import toastStyles from "@/ui/kit/Toast.module.css";
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

/**
 * What holds a toast back: an open modal dialog (the page outside it is inert), or a screen's
 * `data-toast-hold` mark (Results while its stars fill in, M3-FIX-12).
 */
const HOLD = "dialog[open], [data-toast-hold]";
/** Where a screen wants the toast drawn, in its own layout (M3-FIX-12). */
const DOCK = "[data-toast-dock]";

export interface ToastPage {
  /** A modal is open, or a screen asks the toast to wait. */
  held: boolean;
  /** The screen's toast dock, or null for the window's corner. */
  dock: Element | null;
}

function readPage(doc: Document): ToastPage {
  return { held: doc.querySelector(HOLD) !== null, dock: doc.querySelector(DOCK) };
}

/**
 * Holds and docks in `doc`, read fresh on every render (so the render where `watch` turns true
 * never draws, or reads out, a toast that a hold should stop). While `watch` is true the page is
 * watched, and a change renders again.
 */
export function useToastPage(doc: Document, watch: boolean): ToastPage {
  const page = readPage(doc);
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!watch) return undefined;
    // The first check always draws again, in case the page changed after the render.
    let last: ToastPage | null = null;
    const check = (): void => {
      const now = readPage(doc);
      if (last !== null && now.held === last.held && now.dock === last.dock) return;
      last = now;
      redraw((n) => n + 1);
    };
    check();
    const view = doc.defaultView;
    if (!view || typeof view.MutationObserver !== "function") return undefined;
    const watcher = new view.MutationObserver(check);
    watcher.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open", "data-toast-hold"],
    });
    return () => watcher.disconnect();
  }, [doc, watch]);
  return page;
}

/** True while a modal dialog is open in `doc`, or a screen holds toasts back. */
export function useModalOpen(doc: Document, watch: boolean): boolean {
  return useToastPage(doc, watch).held;
}

/** What the toast stays below. */
const CLEAR = "[data-toast-clear]";
/** Room between the toast and what it stays below, in px. */
const CLEAR_GAP_PX = 12;

/**
 * The lowest bottom edge of the page's `data-toast-clear` elements, or null if there are none.
 * With `span` (the toast's left and right), only elements above or below the toast count: the map
 * heading, which goes under the corner buttons at large text (M3-FIX-4), on the left, out of the
 * toast's way, doesn't push it down.
 */
export function clearBelow(doc: Document, span?: { left: number; right: number }): number | null {
  let bottom: number | null = null;
  for (const el of doc.querySelectorAll(CLEAR)) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) continue;
    if (span !== undefined && (r.right <= span.left || r.left >= span.right)) continue;
    bottom = Math.max(bottom ?? 0, r.bottom);
  }
  return bottom;
}

/**
 * Where the toast goes on a screen with a dock: its top just below the dock's top, its middle on
 * the dock's middle (M3-FIX-12). The dock is an empty mark the screen lays out where there is room.
 */
export function dockPlace(dock: Element): { top: number; center: number } {
  const r = dock.getBoundingClientRect();
  return { top: Math.round(r.top) + CLEAR_GAP_PX, center: Math.round(r.left + r.width / 2) };
}

/**
 * Places `ref` while it is shown. With a dock, on the dock (and again as the page scrolls).
 * Otherwise its top stays below the `data-toast-clear` elements. Either is placed again when the
 * window or one of the watched elements resizes, and when the page changes (the map's corner comes
 * back when an island's lesson path closes).
 */
function usePlace(
  ref: { current: HTMLElement | null },
  shown: boolean,
  dock: Element | null,
  /** Changes when a new element may be drawn (the hidden copy gives way to the toast). */
  phase: string,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!shown || !el) return undefined;
    const doc = el.ownerDocument;
    const view = doc.defaultView;
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(() => place()) : null;
    let watched: Element[] = [];
    function place(): void {
      if (!el) return;
      if (dock !== null) {
        const at = dockPlace(dock);
        el.style.setProperty("top", `${at.top}px`);
        el.style.setProperty("left", `${at.center}px`);
        return;
      }
      const self = el.getBoundingClientRect();
      const bottom = clearBelow(doc, self.width > 0 ? self : undefined);
      if (bottom === null) el.style.removeProperty("top");
      else el.style.setProperty("top", `${Math.ceil(bottom) + CLEAR_GAP_PX}px`);
    }
    const rewatch = (): void => {
      const now = dock === null ? [...doc.querySelectorAll(CLEAR)] : [dock];
      if (now.length === watched.length && now.every((c, i) => c === watched[i])) return;
      watched = now;
      sizes?.disconnect();
      for (const c of now) sizes?.observe(c);
      place();
    };
    rewatch();
    place();
    view?.addEventListener("resize", place);
    // The dock is in a screen that may scroll; the toast follows it.
    if (dock !== null) doc.addEventListener("scroll", place, { capture: true, passive: true });
    const changes =
      view && typeof view.MutationObserver === "function"
        ? new view.MutationObserver(rewatch)
        : null;
    changes?.observe(doc.body, { subtree: true, childList: true });
    return () => {
      view?.removeEventListener("resize", place);
      doc.removeEventListener("scroll", place, { capture: true });
      el.style.removeProperty("left");
      sizes?.disconnect();
      changes?.disconnect();
    };
  }, [ref, shown, dock, phase]);
}

/** Room kept between a docked toast and the window's bottom edge, in px. */
const EDGE_PX = 8;

/** Whether a toast `height` px tall fits between `dock` and the bottom of `view`. */
export function fitsUnder(dock: Element, height: number, view: Window | null): boolean {
  const bottom = view?.innerHeight ?? Number.POSITIVE_INFINITY;
  return dockPlace(dock).top + height <= bottom - EDGE_PX;
}

/** What the last measure found, for one badge on one dock. */
interface Room {
  id: AchievementId;
  dock: Element;
  fits: boolean;
}

export function AchievementToast({ queue, open, onShown }: AchievementToastProps) {
  const id = queue[0];
  const def = id === undefined ? null : achievementById(id);
  const { held, dock } = useToastPage(document, open && id !== undefined);
  const showing = open && id !== undefined && !held;
  // On a dock, a badge shows only if it fits there; until it is measured, it doesn't show.
  const [room, setRoom] = useState<Room | null>(null);
  const fits =
    dock === null ? true : room !== null && room.id === id && room.dock === dock ? room.fits : null;
  const probing = showing && def !== null && dock !== null && fits === null;
  const visible = showing && def !== null && fits === true;
  const wrap = useRef<HTMLDivElement>(null);
  usePlace(wrap, visible || probing, dock, probing ? "probe" : "toast");

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!probing || !el || dock === null || id === undefined) return;
    const height = el.getBoundingClientRect().height;
    setRoom({ id, dock, fits: fitsUnder(dock, height, el.ownerDocument.defaultView) });
  }, [probing, dock, id]);

  // A badge with no room may get some when the window grows: measure again.
  const noRoom = showing && dock !== null && fits === false;
  useEffect(() => {
    if (!noRoom) return undefined;
    const again = (): void => setRoom(null);
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, [noRoom]);

  useEffect(() => {
    // An id with no definition (an older or newer build's badge) is skipped at once.
    if (showing && def === null) {
      const skip = setTimeout(onShown, 0);
      return () => clearTimeout(skip);
    }
    if (!visible) return undefined;
    const timer = setTimeout(onShown, BADGE_TOAST_MS);
    return () => clearTimeout(timer);
    // `queue` changes identity on every push; restart only when the shown badge changes.
  }, [showing, visible, id, def, onShown]);

  if (def === null || !(visible || probing)) return null;
  const body = (
    <span class={styles.toastBody}>
      <BadgeIcon icon={def.icon} />
      <span>{t("achievements.toast", { name: t(def.nameKey) })}</span>
    </span>
  );
  if (probing) {
    // The same box as the toast below, hidden and silent, to measure (see the file comment).
    return (
      <div class={styles.toastWrap} data-docked="1" data-probe="1" aria-hidden="true" ref={wrap}>
        <span class={toastStyles.toast} data-tone="cheer">
          <span class={toastStyles.mark}>★</span>
          <span>{body}</span>
        </span>
      </div>
    );
  }
  return (
    <div
      class={styles.toastWrap}
      data-testid="badge-toast"
      data-docked={dock === null ? undefined : "1"}
      ref={wrap}
    >
      <Toast key={def.id} tone="cheer">
        {body}
      </Toast>
    </div>
  );
}
