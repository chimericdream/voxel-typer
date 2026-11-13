# M3-FIX-12 Results toast placement and Sprout finger labels

Status: done (rework after the a11y review; one screenshot baseline changes, `results.png`)

The M4 gate visual review found two problems (2026-11-13). On Results, the "New badge" toast
covered the card's top right at 1280×720, and at 1024×600 it covered the stars message while
"Lesson done!" was scrolled off the top. On a Sprout's on-screen keyboard, the 10 px finger labels
ran into each other at 1024 px and narrower ("middle pointer pointer pointer").

Now Results fits 1024×600 and 1280×720 without scrolling, heading first, at text scale 1 and at
Sprout's 1.5. Badge toasts on Results wait for the stars to fill in, then show under the buttons
in a compact form. A badge toast shows only on a screen that has made room for it: Results' dock,
or the World Map's corner. Anywhere else, Lesson Intro included, it waits. Finger labels are never
smaller than 12 px, and a label too wide for its key is hidden. The hint line ("Use your left
pointer finger.") names the finger, now also when a grown-up turns the hands off and leaves the
labels on.

## Rework (a11y review on #214)

| #   | What the review found                                                                                                                                         | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `results.png` changes at 1280×720 (the short-window layout applies there); the note said no baselines change                                                  | The baseline was deleted and remade on CI by the Update snapshots workflow. I looked at the new image (see Acceptance). This note is corrected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| B2  | For a Sprout at 1024×600 the badge never fit under the buttons, so it moved on, and on Lesson Intro it showed in the old corner over "New keys" and the K key | (1) The docked toast is compact (icon the height of the text, less padding, gap 8 px and edge margin 4 px instead of 12 and 8). Results also takes one more step at `max-height: 640px` (stars 44 px × scale, slots 36 px, tighter gaps). It now fits for a Sprout at 1024×600 with three stars and two rows of finds. (2) The app passes `needsPlace`: a badge toast shows only on a screen with a dock or a `data-toast-corner` (the World Map's corner, which it already measures). On Lesson Intro, or any other screen, it waits. (3) New e2e: Results → "Next lesson" → Lesson Intro at 1024×600 for a Sprout. No toast shows there for 6 s, and Back → the map shows it. |
| N2  | The scale-2 tests never asserted anything about `shown`                                                                                                       | They now assert that the toast doesn't show on Results, then follow it past Lesson Intro to the map.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| N3  | Every pointer and middle label is hidden; with the hands off nothing names the finger                                                                         | With finger labels on and the hands off, the HUD shows the hint line on its own (the M4-04 caption-only path, `data-hands-caption`). This note now says all pointer and middle labels are hidden.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| N1  | "Play again" keeps the badge waiting                                                                                                                          | Mostly moot now the compact toast fits on Results. Where it still waits (text scale 2), the queue is in memory, so closing the tab or switching player drops the toast. The badge itself is saved and shows in My Badges.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| N5  | The stars hold rarely changes anything                                                                                                                        | Kept as a guard: `fillInMs` is at most 1.5 s, the same as `BADGE_SETTLE_MS` from the same route change. The hold matters only when Results mounts late (a slow lazy chunk). The e2e checks that the toast comes after the hold, not that the hold caused the wait.                                                                                                                                                                                                                                                                                                                                                                                                              |
| N6  | A docked toast isn't re-checked when the window shrinks                                                                                                       | `usePlace` re-checks `fitsUnder` each time it places a docked toast (resize, dock resize, scroll). If it no longer fits it is put away, stays queued, and is measured again on the next resize.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## What changed

- `src/ui/components/AchievementToast.tsx`:
  - `useToastPage(doc, watch)` replaces the inside of `useModalOpen` (which is kept and uses it).
    It reads, fresh on every render, whether the toast is **held** (`dialog[open]` as before, or
    any `[data-toast-hold]`), whether the page has a **dock** (`[data-toast-dock]`), and whether it
    has a **corner** kept clear for toasts (`[data-toast-corner]`). While watching, a
    `MutationObserver` renders again on a change. Reading at render time means the render where
    `open` turns true can't draw, or read out, a toast that a hold should stop.
  - A hold works like the modal hold from M3-FIX-8: the toast isn't drawn, read or timed.
  - **`needsPlace`** (new optional prop, set by the app): with it, a toast with neither a dock nor
    a corner on the page waits, like a hold. Without it (the component on its own, in tests) it
    shows anywhere, as before.
  - **Dock:** with a dock on the page the toast stays `position: fixed`, but `usePlace` (formerly
    `useClearTop`) puts its top 8 px under the dock's top and its middle on the dock's middle
    (`dockPlace`). It places it again on resize, when the dock resizes, and on any scroll, so it
    moves with the page. Nothing in the layout moves when a toast comes or goes.
  - **Room check:** the kit Toast reads itself out as it mounts, so a docked badge first renders a
    hidden, silent copy (`data-probe`, `aria-hidden`, the kit's toast classes but not the kit
    component) and measures it (`fitsUnder`: dock top + 8 + height ≤ window height − 4). If it
    fits, the real toast shows and its time starts. If it doesn't, nothing is drawn, read or timed,
    and the badge stays first in the queue. A resize measures again. A docked toast that stops
    fitting is put away the same way (N6).
- `src/ui/components/Badge.module.css`: `.toastWrap[data-docked]` (centred on `left`, `translate:
  -50% 0`; compact: `padding-block: --sp-1`, `line-height: 1.2`, icon `1.2em`, gap `--sp-2`) and
  `.toastWrap[data-probe]` (`visibility: hidden`). The text keeps its size.
- `src/app/App.tsx`: the badge toast gets `needsPlace` (one prop).
- `src/ui/screens/WorldMap.tsx`: the corner `<div>` also carries `data-toast-corner` (one
  attribute, next to M3-FIX-8's `data-toast-clear`).
- `src/ui/screens/Results.tsx` + `.module.css`:
  - `fillInMs(stars, best, reduced)`: the stars' fill-in time, `(stars − 1) × 350 + 450` ms, or
    1500 ms when the personal-best plate pops in. 0 with reduced motion. While it runs the page
    carries `data-toast-hold="stars"`. If the OS switches to reduced motion mid-fill, the hold ends
    at once.
  - An empty `data-toast-dock` mark inside the button row (`position: absolute; top: 100%`,
    `aria-hidden`), so it takes no room. The no-result Results screen has one too.
  - A short window (`max-height: 760px`): the page is top-aligned (the leftover room goes under the
    buttons, where the toast shows), gaps and the card's padding tighten, the title steps down to
    `--fs-lg`, the stars to 52 px × text scale and the find slots to `--slot-base: 40px`. At
    `max-height: 640px`, one more step: stars 44 px × scale, slots 36 px, gaps `--sp-2`. Text keeps
    its size. The Stars kit is wrapped in a `.stars` div so the size can be overridden without
    touching the kit.
- `src/ui/keyboard/OnScreenKeyboard.tsx` + `.module.css` (label CSS and logic only):
  - `--label-size: max(12px, var(--u) × 0.2)` replaces `max(10px, …)`. The glyph lift is 0.8 × that
    (it was 0.16u with 0.2u labels).
  - `fitLabels(board)` sets `data-label-off` on each key whose label is wider than the key. Keys
    not laid out yet are left alone. `useLabelFit` runs it after the keys draw, on a board resize
    (window, text scale) and when fonts finish loading. A key with `data-label-off` hides its label,
    even when it is the lit key, and its glyph stays centred.
  - The labels carry `data-finger-label` (for the measure and the e2e).
- `src/ui/hud/Hud.tsx` (`HudKeyboard`, N3): with labels on and the hands off, the keyboard shows
  the hint line on its own (`hands || caption`, `handsCaptionOnly`), and the row gets
  `data-hands-caption` so its height includes the line.
- Tests:
  - `tests/unit/ui/achievements.test.tsx`: fill-in times; a `data-toast-hold` mark holds the toast
    (not drawn, read or timed) and lets it go; a dock with room places the toast at the dock's top
    \+ 8 and its middle; with no room it isn't drawn, read or timed, and shows once the dock goes;
    with `needsPlace` it waits until a `data-toast-corner` appears; `fitsUnder`'s margin.
  - `tests/unit/ui/keyboard.test.tsx`: the stylesheet has the 12 px floor and no `max(10px`; with
    measured widths, "pointer" on a 40 px key is hidden (the lit key too), "pinky" and "ring" stay,
    and it comes back on a 60 px key; nothing is hidden before layout.
  - `tests/unit/ui/hud.test.tsx`: labels on and hands off show the hint line and no hands. The
    M4-04 test "the hint line is never forced on" now runs with labels off.
  - `tests/e2e/results-toast.spec.ts` (new): at 1024×600 and 1280×720, for a Sprout (scale 1.5)
    and a Builder (scale 1), Results fits with `scrollTop` 0 and the heading, card and buttons fully
    in view. For 6 s every toast box is checked against the heading, the card and each button, and
    must be wholly on screen. The toast shows on Results in all four cases. At text scale 2 at both
    sizes it must not show on Results or Lesson Intro, and then shows on the map. Sprout at
    1024×600: "Next lesson" before the toast's turn, no toast on Lesson Intro for 6 s, then "Back
    to the map". The map comes back with the island's lesson path open, which hides the corner, so
    the badge still waits; once Escape closes the path, it shows in the corner. A hold test records, in the page, when the hold comes and goes and when the
    toast first shows: the hold lasts over 800 ms and the toast comes after it. With reduced motion
    there is no hold.
  - `tests/e2e/finger-labels.spec.ts` (new): Mine (`meadow-01`) and Night Defense (`birch-08`), a
    Sprout at 1024×600 and 1280×720. Every visible label is ≥ 12 px, inside its key, and overlaps
    no other label. The hint line shows.
- Baseline: `tests/e2e/__screenshots__/slice/baselines.spec.ts/results.png`, remade on CI.

## Acceptance

- [x] **Toasts never cover the Results card or its buttons at 1280×720, 1024×600 and text scale 2.** `results-toast.spec.ts`, the four size/band cases and the two scale-2 cases.
- [x] **A toast that waits never lands on Lesson Intro, or on any screen without room for it.**
      `results-toast.spec.ts` "Sprout at 1024×600: a badge left on Results waits past Lesson Intro
      for the map", and the scale-2 cases; unit "with needsPlace it waits for a screen with a dock or
      a toast corner".
- [x] **Hold badge toasts until the stars have filled, with no extra wait under reduced motion.**
      `results-toast.spec.ts` "toasts wait for the stars" (both); unit "the stars' fill-in time" and
      "waits while a data-toast-hold mark is on the page".
- [x] **Existing timing rules kept.** The 1.5 s route settle (`BADGE_SETTLE_MS`, App), the 1 s gap
      after a page announcement (`announce.ts`) and the modal hold are unchanged. The toast live
      region is unchanged. All of M3-FIX-8's and M3-FIX-4's unit tests pass unchanged.
- [x] **Results heading and card fit at 600 px tall without scrolling the heading off.**
      `results-toast.spec.ts` checks `scrollTop` 0 and the heading fully in view at 1024×600 (scale 1
      and 1.5). At text scale 2 the screen is taller than 600 px and still scrolls (follow-up card).
- [x] **Never show finger-label text under about 12 px to a Sprout; the hint line stays; Mine and
      Defense.** `finger-labels.spec.ts` (4 cases); unit tests in `keyboard.test.tsx` and
      `hud.test.tsx`.
- [x] **e2e checks at 1024×600 and 1280×720 for both items.** The two new specs.
- [x] **Baselines made on CI only.** `results.png` was deleted and remade by the Update snapshots
      workflow on CI's Linux runner. I looked at the new image: the compact layout at 1280×720,
      with the heading, the card and the three buttons all in the window, and no toast.
- [x] `npm run verify` passes (see the PR's checks). Locally, with one worker on port 4547:
      `results-toast`, `finger-labels`, `achievements`, `m3/keyboard-flow`, `slice/baselines`
      (screenshots skipped outside CI), `hud` and `settings` all pass.

## Decisions

- **The toast goes under the buttons, compact, not bottom-right.** At 1024 px wide there is no room
  beside the card (Sprout's card is 960 px wide), and under the buttons is the one place that never
  meets the card at any width.
- **A badge toast shows only where a screen made room for it** (`needsPlace`: a dock, or a corner
  kept clear). Otherwise it waits rather than showing over content or half off screen. It isn't
  lost: it shows, and is read, on the World Map. A screen reader user hears it there too, later.
  Today only Results and the World Map make room. Another screen can opt in with
  `data-toast-corner` once its corner is free, or with a dock.
- **The toast stays fixed and measures the dock** instead of being portalled into the page.
  `createPortal` lives in `preact/compat`, which patches Preact's options app-wide when loaded
  (for example, `onChange` turns into `onInput`). It also follows the pattern M3-FIX-8 used for
  `data-toast-clear`.
- **"pointer" stays.** It is the Sprout word and matches the hint line ("Use your left pointer
  finger."). "index" would make the label disagree with the hint. A label that doesn't fit is
  hidden, as the card suggests. At both 1024×600 and 1280×720 **all pointer and middle labels are
  hidden** (24 keys, the home-row D, F, J and K and the lit key included). Only pinky, ring and
  thumb labels show. The colour and pattern still mark every zone, and the hint line names the
  finger, also with the hands off (N3).
- **The hint line with the hands off shows only when finger labels are on.** A grown-up who turned
  off both hands and labels asked for a plain keyboard.
- The hold covers the stars and the personal-best plate, not the find slots. The toast is under
  the buttons, so the slots popping in can't be covered, and with many kinds of finds waiting for
  them would delay the toast by several seconds.

## New dependencies

- None.

## Notes for downstream tasks

- **M4-FIX-4 (#208)** may change the keyboard's size on short screens. This task changed only the
  label rules (`--label-size`, `.label`, the lift, `data-label-off`), `useLabelFit`, and in
  `HudKeyboard` the caption-only hint line for labels on with hands off (which uses the existing
  `data-hands-caption` sizing). A smaller key unit just hides more labels.
- Any screen can now use `data-toast-hold` (hold toasts while something important animates),
  `data-toast-dock` (an empty mark where toasts should show; the toast must fit whole between it
  and the window's bottom) and `data-toast-corner` (the top-right corner is free for toasts).
  Without one of the last two, badge toasts wait on that screen.
- Follow-up card (filed by the orchestrator): Results at text scale 2 on short windows, perhaps
  two columns, since the heading still scrolls off at 1024×600; and key-name faces under 12 px
  ("backspace", "caps lock", "shift" at 0.24u; two-symbol keys at 0.27u), after #208.

## Contract change request / Questions

- (none)

Closes #209
