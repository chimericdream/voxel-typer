# M3-FIX-8 My Badges scrolling and toast placement

Status: done (screenshot baselines made on CI by the Update snapshots workflow)

In the owner's playtest on 2026-11-12, the My Badges list scrolled with nothing to show it, so
"16 of 24 badges" with 15 cards on screen looked like a bug (`docs/screenshots/screenshot-11.png`).
Now the list fills the room the screen has left. While badges are out of sight below, its bottom
edge fades and a **"More badges below ↓"** cue shows under it. Clicking the cue scrolls the list
down. A badge toast that arrives while a modal is open now waits until the modal closes, then shows
and is read out. On the World Map the toast sits below the corner buttons, which it measures, so it
stays clear of them at text scale 2.

## What changed

- `src/ui/screens/Achievements.tsx` + `.module.css`:
  - The page is as tall as the window (`height: 100%`, `justify-content: safe center`). The list
    (`.frame` → `.scroll`) shrinks to fit the space the title, count, cue and Back leave, down to
    about one row (`9rem × text scale`); below that the page scrolls. The old `max-height: 60vh` is
    gone. A list that fits keeps its own height and stays centred.
  - `useHidden` watches the list (scroll, window resize, and a `ResizeObserver` on the list and its
    grid for fonts and text scale) and sets `data-below` and `data-above`. Each one fades that
    edge with a `mask-image`, so the fade works over the sky, at night and in strong colors. The
    focus ring moved to `.frame` (`:has(> .scroll:focus-visible)`), because the mask would clip the
    list's own outline.
  - The cue is a `<button tabIndex={-1}>` with the copy `achievements.moreBelow`, "More badges
    below", and a CSS-drawn blocky arrow. It is on a plate (`--c-plate`/`--c-plate-text`) with an
    edge, so it reads on every theme and keeps a `CanvasText` edge in forced colours. It renders
    once the list scrolls at all, and is `visibility: hidden` at the end, so its room stays and the
    list doesn't jump. The arrow hops 3 times when it appears (`0.6s × --motion-ok`), so with
    reduced motion it doesn't move. A click scrolls 80 % of the list's height, smoothly unless
    motion is reduced (`prefersReducedMotion`).
  - `hiddenParts(scrollTop, clientHeight, scrollHeight)` is exported for tests (2 px slack).
- `src/ui/components/AchievementToast.tsx`:
  - `useModalOpen(doc, watch)`: true while a `dialog[open]` is in the page. It watches with a
    `MutationObserver` only while there is a badge to show. `showModal()` makes the page outside the
    dialog inert, including the live region in `body`, so a toast shown under a modal was never
    read. Now the toast doesn't open while a modal is open. A toast already up when one opens is put
    away (its timer stops), and when the modal closes it comes back with its full
    `BADGE_TOAST_MS` and is read out again. The existing rules still hold: never on `play`, and only
    after `BADGE_SETTLE_MS` on a route.
  - `useClearTop` + `clearBelow(doc)`: while a toast shows, its `top` is set to 12 px below the
    lowest `[data-toast-clear]` element. It is measured again on window resize, when one of those
    elements resizes (`ResizeObserver`), and when the page's elements change (the map's corner
    comes back when an island's lesson path closes). With none on the page, the stylesheet's `top`
    applies.
- `src/ui/components/Badge.module.css`: comment only (the `top` there is now the fallback).
- `src/i18n/en/achievements.ts`: `moreBelow: "More badges below"`.
- **Outside "Owns"** (one attribute): `src/ui/screens/WorldMap.tsx` marks the corner `<div>` with
  `data-toast-clear`.
- Tests:
  - `tests/unit/ui/achievements.test.tsx`: `hiddenParts`; the screen's fade and cue states (none,
    below, both, end) and the cue's scroll; a toast queued under a kit `Dialog` is not drawn, read
    or timed, then is drawn and read in the live region after the modal closes; a toast already up
    is put away and gets its full time again; the toast's `top` follows a `data-toast-clear`
    element as it grows and falls back when the element goes. With the modal check removed, both
    modal tests fail.
  - `tests/e2e/achievements.spec.ts` (new): at 1280×720, the cue shows and the last badge is out of
    sight, at text scale 1, at text scale 2 and in strong colors at text scale 2 (each set through
    Settings → Look), with screenshots `badges-1280.png`, `badges-1280-scale2.png` and
    `badges-contrast-scale2.png`, and axe clean. Keyboard: Shift+Tab from Back focuses the list,
    End shows the last badge and hides the cue, Home brings it back, ArrowDown scrolls, and a click
    on the cue scrolls. Toast: a Sprout at text scale 2 plays lesson 1 and goes back to the map;
    the badge toast's box overlaps none of the corner buttons and is on screen.

## Acceptance

- [x] At 1280×720 and at text scale 2, a screenshot shows the cue whenever badges are hidden.
      `tests/e2e/achievements.spec.ts`, "My Badges shows that it scrolls" (scale 1, scale 2, and
      strong colors at scale 2). The baselines were made on CI.
- [x] A test that a toast queued under a modal is announced after the modal closes:
      `tests/unit/ui/achievements.test.tsx`, "a badge toast under a modal (M3-FIX-8)".
- [x] Text scale 2: the toast stays clear of the map corner. E2E "badge toast on the World Map".
- [x] `npm run verify` passes.

## Decisions

- **The list fills the room and the cue shows, rather than a layout that always fits.** Fitting 24
  cards at text scale 2 on 1280×720 would need tiny cards. The fade plus the plain-words cue shows
  both "there is more" and where it is.
- **The cue is not a Tab stop.** The list itself is a Tab stop and scrolls with the arrow keys,
  Page Up/Down, Home and End, so a keyboard user already reaches every badge. A Tab stop that
  disappears at the end would move focus. A screen reader can still find and press the cue, and
  all 24 badges are always in the list.
- **The modal check looks at the page (`dialog[open]`), not a kit flag.** The kit `Dialog` is the
  only modal and always uses `<dialog>`, so this needs no change to the kit and covers any later
  `<dialog>`.
- **A toast put away by a modal gets its full time again**, so a child who paused can still see
  it.
- The kit `Toast` (save notices) is unchanged. Those notices stay until dismissed, so a modal
  doesn't cut their time. Holding their announcement as well would be a kit change, outside this
  card.

## New dependencies

- None.

## Notes for downstream tasks

- Anything a toast must stay below can carry `data-toast-clear`. The badge toast measures every
  one on the page.
- `useModalOpen(document, watch)` in `AchievementToast.tsx` can be reused if another queued message
  must wait for modals.
- **Reconcile with M3-FIX-4 (#189)**, which delays toasts after route announcements and gives them
  their own live region. The modal hold here is the hook `useModalOpen` plus one term in
  `showing` (`&& !modal`). Keep both: a separate toast region outside `#app` is still inert
  under `showModal()`, so the hold is still needed.
- M3-FIX-2 (fonts) changes `--font-pixel` users. This task's new CSS uses only `--font-body`.

## Contract change request / Questions

- **Found, not fixed (WorldMap is not this card's):** at text scale 2 on 1280×720, the World Map's
  hint ("Pick an island. Press Enter to go in.") lies over the **My Badges** corner button and
  takes its clicks. Playwright's click on it waited 30 s, blocked by the hint in `<header>`. The
  keyboard still works, and the e2e here opens My Badges with Enter. M4-FIX-1 fixed the same
  overlap at 1024 px; 1280 px at scale 2 needs the same treatment. This needs a card.

Closes #178
