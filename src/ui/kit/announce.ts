/**
 * One polite live region for the whole page (M2-07 review N5). Screen readers often skip a live
 * region that is inserted with its text already inside, which is how a Toast mounts. So the kit
 * keeps a single region mounted and changes its text: on its first use the region is created
 * empty and filled a moment later; after that the text is cleared and set again.
 */
const REGION_ID = "vt-announcer";
/** The wait before the first message, so the new region is in the accessibility tree first. */
export const FIRST_ANNOUNCE_MS = 150;
/** The wait between clearing and setting, so the same message twice is read twice. */
export const NEXT_ANNOUNCE_MS = 30;

const HIDDEN: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

/** The page's live region, made on first use. */
export function announcer(doc: Document): { region: HTMLElement; fresh: boolean } {
  const found = doc.getElementById(REGION_ID);
  if (found) return { region: found, fresh: false };
  const region = doc.createElement("div");
  region.id = REGION_ID;
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  Object.assign(region.style, HIDDEN);
  doc.body.append(region);
  return { region, fresh: true };
}

/** Reads `text` out politely. Returns a cancel function for a message that goes away first. */
export function announce(doc: Document, text: string): () => void {
  const { region, fresh } = announcer(doc);
  region.textContent = "";
  if (text.trim() === "") return () => {};
  const view = doc.defaultView;
  if (!view) {
    region.textContent = text;
    return () => {};
  }
  const timer = view.setTimeout(
    () => {
      region.textContent = text;
    },
    fresh ? FIRST_ANNOUNCE_MS : NEXT_ANNOUNCE_MS,
  );
  return () => view.clearTimeout(timer);
}
