/**
 * Polite live regions for the whole page (M2-07 review N5). Screen readers often skip a live
 * region that is inserted with its text already inside, which is how a Toast mounts. So the kit
 * keeps each region mounted and changes its text: on its first use a region is created empty and
 * filled a moment later; after that the text is cleared and set again.
 *
 * Two channels, two regions (M3-07 review N6): `page` for what the app says about where the child
 * is (route changes, Results), `toast` for Toasts. A route change and a toast a few milliseconds
 * apart each keep their own words instead of one overwriting the other.
 *
 * Some screen readers (VoiceOver especially) read only the later of two messages that arrive
 * together, so a toast waits until {@link TOAST_AFTER_PAGE_MS} after the last page message: the
 * page speaks first, then the toast (M3-FIX-4 a11y review S2).
 */
export type AnnounceChannel = "page" | "toast";

const REGION_IDS: Record<AnnounceChannel, string> = {
  page: "vt-announcer",
  toast: "vt-announcer-toast",
};
/** The wait before the first message, so the new region is in the accessibility tree first. */
export const FIRST_ANNOUNCE_MS = 150;
/** The wait between clearing and setting, so the same message twice is read twice. */
export const NEXT_ANNOUNCE_MS = 30;
/** How long after a page message a toast waits before it is read. */
export const TOAST_AFTER_PAGE_MS = 1000;

/** When each document's page region last got (or will get) its text, in `Date.now()` ms. */
const pageSpokenAt = new WeakMap<Document, number>();

const HIDDEN: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

/** A channel's live region, made on first use. */
export function announcer(
  doc: Document,
  channel: AnnounceChannel = "page",
): { region: HTMLElement; fresh: boolean } {
  const id = REGION_IDS[channel];
  const found = doc.getElementById(id);
  if (found) return { region: found, fresh: false };
  const region = doc.createElement("div");
  region.id = id;
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  Object.assign(region.style, HIDDEN);
  doc.body.append(region);
  return { region, fresh: true };
}

/** Reads `text` out politely. Returns a cancel function for a message that goes away first. */
export function announce(
  doc: Document,
  text: string,
  channel: AnnounceChannel = "page",
): () => void {
  const { region, fresh } = announcer(doc, channel);
  region.textContent = "";
  if (text.trim() === "") return () => {};
  const view = doc.defaultView;
  if (!view) {
    region.textContent = text;
    return () => {};
  }
  const now = Date.now();
  let wait = fresh ? FIRST_ANNOUNCE_MS : NEXT_ANNOUNCE_MS;
  if (channel === "page") {
    pageSpokenAt.set(doc, now + wait);
  } else {
    const page = pageSpokenAt.get(doc);
    if (page !== undefined) wait = Math.max(wait, page + TOAST_AFTER_PAGE_MS - now);
  }
  const timer = view.setTimeout(() => {
    region.textContent = text;
  }, wait);
  return () => view.clearTimeout(timer);
}
