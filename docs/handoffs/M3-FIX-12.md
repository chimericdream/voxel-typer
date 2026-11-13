# M3-FIX-12 Results toast placement and Sprout finger labels

Status: done (no screenshot baselines change; the new e2e checks measure boxes)

The M4 gate visual review found two problems (2026-11-13). On Results, the "New badge" toast
covered the card's top right at 1280×720, and at 1024×600 it covered the stars message while
"Lesson done!" was scrolled off the top. On a Sprout's on-screen keyboard, the 10 px finger labels
ran into each other at 1024 px and narrower ("middle pointer pointer pointer").

Now Results fits 1024×600 and 1280×720 without scrolling, heading first, at text scale 1 and at
Sprout's 1.5. Badge toasts on Results wait for the stars to fill in and then show under the
buttons. If a whole toast can't fit there, it shows on the next screen. Finger labels are never
smaller than 12 px, and a label too wide for its key is hidden. The hint line ("Use your left
pinky.") still names the finger.

## What changed

- `src/ui/components/AchievementToast.tsx`:
  - `useToastPage(doc, watch)` replaces the inside of `useModalOpen` (which is kept and uses it).
    It reads, fresh on every render, whether the toast is **held** (`dialog[open]` as before, or
    any `[data-toast-hold]`) and whether the page has a **dock** (`[data-toast-dock]`). While
    watching, a `MutationObserver` renders again on a change. Reading at render time means the
    render where `open` turns true can't draw, or read out, a toast that a hold should stop.
  - A hold works like the modal hold from M3-FIX-8: the toast isn't drawn, read or timed.
  - **Dock:** with a dock on the page the toast stays `position: fixed`, but `usePlace` (formerly
    `useClearTop`) puts its top 12 px under the dock's top and its middle on the dock's middle
    (`dockPlace`). It places it again on resize, when the dock resizes, and on any scroll, so it
    moves with the page. Nothing in the layout moves when a toast comes or goes.
  - **Room check:** the kit Toast reads itself out as it mounts, so a docked badge first renders a
    hidden, silent copy (`data-probe`, `aria-hidden`, the kit's toast classes but not the kit
    component) and measures it (`fitsUnder`: dock top + 12 + height ≤ window height − 8). If it
    fits, the real toast shows and its time starts. If it doesn't, nothing is drawn, read or timed,
    and the badge stays first in the queue. On the next screen (no dock) it shows in the corner as
    before. A window resize measures again.
- `src/ui/components/Badge.module.css`: `.toastWrap[data-docked]` (centred on `left`, `translate:
  -50% 0`) and `.toastWrap[data-probe]` (`visibility: hidden`).
- `src/ui/screens/Results.tsx` + `.module.css`:
  - `fillInMs(stars, best, reduced)`: the stars' fill-in time, `(stars − 1) × 350 + 450` ms, or
    1500 ms when the personal-best plate pops in. 0 with reduced motion. While it runs the page
    carries `data-toast-hold="stars"`. If the OS switches to reduced motion mid-fill, the hold ends
    at once.
  - An empty `data-toast-dock` mark inside the button row (`position: absolute; top: 100%`,
    `aria-hidden`), so it takes no room.
  - A short window (`max-height: 760px`): the page is top-aligned (the leftover room goes under the
    buttons, where the toast shows), gaps and the card's padding tighten, the title steps down to
    `--fs-lg`, the stars to 52 px × text scale and the find slots to `--slot-base: 40px`. Text
    keeps its size. The Stars kit is wrapped in a `.stars` div so the size can be overridden without
    touching the kit.
- `src/ui/keyboard/OnScreenKeyboard.tsx` + `.module.css` (label CSS and logic only):
  - `--label-size: max(12px, var(--u) × 0.2)` replaces `max(10px, …)`. The glyph lift is 0.8 × that
    (it was 0.16u with 0.2u labels).
  - `fitLabels(board)` sets `data-label-off` on each key whose label is wider than the key. Keys
    not laid out yet are left alone. `useLabelFit` runs it after the keys draw, on a board resize
    (window, text scale) and when fonts finish loading. A key with `data-label-off` hides its label,
    even when it is the lit key, and its glyph stays centred.
  - The labels carry `data-finger-label` (for the measure and the e2e).
- Tests:
  - `tests/unit/ui/achievements.test.tsx`: fill-in times; a `data-toast-hold` mark holds the toast
    (not drawn, read or timed) and lets it go; a dock with room places the toast at the dock's top
    - 12 and its middle; with no room it isn't drawn, read or timed, and shows in the corner once
      the dock goes; `fitsUnder`'s margin.
  - `tests/unit/ui/keyboard.test.tsx`: the stylesheet has the 12 px floor and no `max(10px`; with
    measured widths, "pointer" on a 40 px key is hidden (the lit key too), "pinky" and "ring" stay,
    and it comes back on a 60 px key; nothing is hidden before layout.
  - `tests/e2e/results-toast.spec.ts` (new): at 1024×600 and 1280×720, for a Sprout (scale 1.5)
    and a Builder (scale 1), Results fits with `scrollTop` 0 and the heading, card and buttons fully
    in view. For 6 s every toast box is checked against the heading, the card and each button, and
    must be wholly on screen. The toast shows on Results in three of the four cases. For Sprout at
    1024×600 it doesn't, and the test then checks it shows on the map. The same overlap watch runs
    at text scale 2 at both sizes. A hold test records, in the page, when the hold comes and goes
    and when the toast first shows: the hold lasts over 800 ms and the toast comes after it. With
    reduced motion there is no hold.
  - `tests/e2e/finger-labels.spec.ts` (new): Mine (`meadow-01`) and Night Defense (`birch-08`), a
    Sprout at 1024×600 and 1280×720. Every visible label is ≥ 12 px, inside its key, and overlaps
    no other label. The hint line shows.

## Acceptance

- [x] **Toasts never cover the Results card or its buttons at 1280×720, 1024×600 and text scale 2.** `results-toast.spec.ts`, the four size/band cases and the two scale-2 cases.
- [x] **Hold badge toasts until the stars have filled, with no extra wait under reduced motion.**
      `results-toast.spec.ts` "toasts wait for the stars" (both); unit "the stars' fill-in time" and
      "waits while a data-toast-hold mark is on the page".
- [x] **Existing timing rules kept.** The 1.5 s route settle (`BADGE_SETTLE_MS`, App), the 1 s gap
      after a page announcement (`announce.ts`) and the modal hold are unchanged. The toast live
      region is unchanged. All of M3-FIX-8's and M3-FIX-4's unit tests pass unchanged.
- [x] **Results heading and card fit at 600 px tall without scrolling the heading off.**
      `results-toast.spec.ts` checks `scrollTop` 0 and the heading fully in view at 1024×600 (scale 1
      and 1.5). At text scale 2 the screen is taller than 600 px and still scrolls (see Notes).
- [x] **Never show finger-label text under about 12 px to a Sprout; the hint line stays; Mine and
      Defense.** `finger-labels.spec.ts` (4 cases); unit tests in `keyboard.test.tsx`.
- [x] **e2e checks at 1024×600 and 1280×720 for both items.** The two new specs. No screenshot
      baselines were added or changed.
- [x] `npm run verify` passes (see the PR's checks). Locally: `results-toast.spec.ts` and
      `finger-labels.spec.ts` with one worker on port 4547, all passing.

## Decisions

- **The toast goes under the buttons, not bottom-right.** At 1024 px wide there is no room beside
  the card (Sprout's card is 960 px wide), and under the buttons is the one place that never meets
  the card at any width.
- **A toast that can't fit whole under the buttons waits for the next screen** rather than showing
  half off screen or over the card. That is Sprout at 1024×600 and anything at text scale 2. It
  isn't lost: it shows, and is read, on the map or the lesson intro. A screen reader user hears it
  there too, a moment later.
- **The toast stays fixed and measures the dock** instead of being portalled into the page.
  `createPortal` lives in `preact/compat`, which patches Preact's options app-wide when loaded
  (for example, `onChange` turns into `onInput`). It also follows the pattern M3-FIX-8 used for
  `data-toast-clear`.
- **"pointer" stays.** It is the Sprout word and matches the hint line ("Use your left pointer
  finger."). "index" would make the label disagree with the hint. A label that doesn't fit is
  hidden, as the card suggests. At 1280×720 a Sprout sees pinky, ring and thumb labels, and the
  pointer and some middle labels are hidden. The colour and pattern still mark every zone.
- The hold covers the stars and the personal-best plate, not the find slots. The toast is under
  the buttons now, so the slots popping in can't be covered, and with many kinds of finds waiting
  for them would delay the toast by several seconds.

## New dependencies

- None.

## Notes for downstream tasks

- **M4-FIX-4 (#208)** may change the keyboard's size on short screens. This task changed only the
  label rules (`--label-size`, `.label`, the lift, `data-label-off`) and `useLabelFit`. A smaller
  key unit just hides more labels; nothing else depends on the size.
- Any screen can now use `data-toast-hold` (hold toasts while something important animates) and
  `data-toast-dock` (an empty mark where toasts should show). The dock's toast must fit whole
  between the dock and the window's bottom, or it waits for the next screen.
- At text scale 2, Results at 1024×600 is still taller than the window. Focusing "Next lesson" on
  arrival scrolls the buttons into view (M2-FIX-3), so the heading scrolls off there. Fitting it
  would need smaller buttons or a two-column card at scale 2; I left that alone.
- The key-name glyphs on the keyboard ("backspace", "caps lock", "shift": `.slot[data-face="named"]`
  at 0.24u, and the two-symbol keys at 0.27u) are also under 12 px at Sprout sizes on a 1024 px
  window. They are key faces, not finger labels, so they are outside this card. That may be worth a
  follow-up card.

## Contract change request / Questions

- (none)

Closes #209
