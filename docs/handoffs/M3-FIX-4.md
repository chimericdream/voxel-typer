# M3-FIX-4 Map labels and accessibility follow-ups

Status: done. The a11y review's blocking items B1–B4 and its should-fix items S1–S4 are addressed (see "After the a11y review" below). I ran no local e2e, because it was evening; CI runs it.

## What changed

- `src/render/map/view.ts`: three new methods on `WorldMapView`.
  - `pick(point)` finds the island under a canvas point. It raycasts the island's meshes first. If that misses, it falls back to the ellipsoid that fills the island's bounding box, so a tap between two trees still counts.
  - `hover(biome)` puts the hovered island's lit mesh on a second Lambert material at 1.3× color. It changes color only and moves nothing, so reduced motion is unaffected. It also calls `requestRender()` once and starts no frames.
  - `centers()` gives each island's middle on screen, for the e2e.
- `src/ui/screens/WorldMap.tsx`:
  - **Whole island is the target.** A click or tap on the map's 3D picture asks `pick`. An open island goes in, the same as its label; a locked one gets the same wobble and kind line. Clicks on labels, the heading and the corner buttons never reach `pick`.
  - Mouse hover runs at most one `pick` per animation frame, and nothing runs while the mouse rests. The hovered open island is drawn brighter, its label gets the gold edge (`data-hover`), and the map shows the hand cursor (`data-pointing`). Locked islands get no glow and no hand, the same as their labels.
  - Keyboard selection and the labels are unchanged.
  - **N3:** any key clears the "not yet" line, typed letters included.
  - **N4:** a second click on the same locked island clears the line and puts it back after `NEXT_ANNOUNCE_MS`. Its 4 s timer starts over, and a screen reader hears it again.
  - **(a), (b):** the corner buttons go on one tap, and a long press shows a button's words (see Decisions).
  - Test builds write `data-center` on each island's spot so the e2e can click the model. `MARK_CENTERS` is a constant from `import.meta.env.MODE`, so production has none of it; I checked with a grep of `dist/`.
- `src/ui/screens/WorldMap.module.css`:
  - **(c):** the `.top` max-width now subtracts the measured `--corner-w` at every width. Before, only the ≤ 1100 px media query did. At 1280 px, the 72 % rule let the hint run under "Change player".
  - Adds the hand cursor and the hover edge on the label, with a `Highlight` outline in forced colors.
  - Long-press styling on the narrow corner buttons: `-webkit-touch-callout: none` and `user-select: none`, so iOS doesn't open its own menu.
- `src/ui/screens/map-logic.ts`: **N1.** The last step of `layoutLabels` is now `settle()`.
  - Labels are placed one at a time. Each keeps its spot if that spot is inside the window and clear of the labels already placed and of the keep-out areas. Otherwise it takes the nearest clear spot beside, above or below something in its way.
  - Four placement orders are tried: top first, bottom first, widest first and curriculum order.
  - If every order leaves a label stuck, a row fallback (`inRows`) stacks the labels in rows under the keep-outs. It is used only when it leaves fewer labels stuck.
  - Every pair and the window's bottom are checked against the final places.
- `src/a11y/flash-guard.ts` and `flashes.ts`: **shared guard clock.**
  - The guard has a new option, `backwards: "reset" | "refuse"`. `"reset"` is the default and keeps the old behavior.
  - The app's shared guard uses `"refuse"`: a time from another clock is refused and the window is kept.
  - `allowFlash()` no longer takes a time; it reads `performance.now()` itself.
- `src/ui/keyboard/OnScreenKeyboard.tsx`: calls `allowFlash()` with no argument. Its wobble gate still uses the injected `now`.
- `src/ui/hud/Hud.tsx`, `src/ui/kit/Toast.tsx` and `Toast.module.css`: **the HUD banner asks the flash guard.** Each new message (the banner or the Caps Lock hint) asks `allowFlash()` once. If the guard refuses, the message still shows, only without the pop-in (`Toast still` → `data-still`).
- `src/ui/hud/Hud.module.css`: **"Hear it again" fits.** In a short top row, the words drop and the key cap stays, and the progress bar keeps at least `min(120px, 15%)`.
- `src/ui/hud/Hud.module.css`: **GrayText.** Under `forced-colors: active`, typed letters (`data-mark="ok"` and `"fixed"`) use the `GrayText` color.
- `src/ui/kit/announce.ts`, `Toast.tsx` and `src/a11y/route-announcer.ts`: **two live regions.** `announce(doc, text, channel)` takes `"page"` (the default; `#vt-announcer`, route changes and Results) or `"toast"` (`#vt-announcer-toast`, every Toast). Neither overwrites the other.
- `src/ui/screens/nav.ts` and `Results.tsx`: **Results reads the motion setting live.**
  - `useReducedMotion(setting)` re-renders when the app's motion flag changes.
  - Results uses it for the stars and slots.
  - The star sounds are planned once, on arrival, so a change mid-Results doesn't refocus the button or replay the sounds.
- `src/ui/kit/KeyCap.module.css`: **KeyCap** defaults to `--font-body`.
- Tests:
  - `tests/unit/ui/map.test.tsx`:
    - the 1024×600 scale-2 label case;
    - a fast-check property: jittered anchors at 1024×600 and 1024×720, 300 runs, seed 4162 (it also passed 5000 runs locally);
    - touch tests: one tap goes; a long press shows the words without going; a cancelled touch sets nothing; a key's click after a long press still goes.
  - `map-rebuild.test.tsx`: a model click goes in on an open island and nudges on a locked one; a click on a label never asks `pick`.
  - `tests/unit/render/map.test.ts`: `pick` and `centers` for all nine islands; `hover` changes color only, renders once and starts no frames.
  - `flash-guard.test.ts`: the refuse mode, and the shared guard reading its own clock.
  - `hud-a11y.test.tsx`: the banner shows without its pop-in once the page has flashed 3 times.
  - `use-motion.test.tsx`: `useReducedMotion` re-renders on a flag change.
  - `kit.test.tsx` and `achievements.test.tsx`: updated for the toast region.
  - `tests/e2e/map.spec.ts`:
    - a click on the middle of Meadow's model (asserted not to be on its label) opens the path;
    - hover gives the hand cursor and the lit label, draws once, then idles;
    - a locked island's model gives the kind line; a second click re-announces it; a typed letter clears it;
    - every label test asserts `data-mode="3d"` and nine placed spots (N2);
    - a 1024×600 text-scale-2 case (N1, d);
    - the hint checked against all four corner buttons at 11 widths from 1024 to 1920 px (c);
    - touch through CDP: long press, cancelled touch, then one tap goes (a, b).
  - `tests/e2e/a11y.spec.ts`:
    - the shake control now measures camera roll before and after the breaking letter. The rig aims with `lookAt` and up = +y, so drift and glides never roll the camera, and only the shake does (`rotateZ`). Frame-to-frame jumps didn't work on CI: the lesson's opening glide was as big as the shake;
    - a new test switches the OS to reduced motion mid-lesson and checks that the camera then holds still. This fails on a cached boolean;
    - "Hear it again" at text scale 2 at 1024×720, 1024×600 and 1280×720, with a stubbed local English voice. The key cap must show whole; the words must show whole or not at all, and whole at 1280 px; the progress bar must keep at least 110 px.
  - `tests/fixtures/profiles/voice-miner.json`: a new fixture, a Miner with read-aloud on and text size 2. It is a copy of `meadow-done-miner`.
- Baselines: after merging main (#186, every UI font is Atkinson), I deleted `map-new-player.png`, `map-all-open.png` and `map-narrow-corner.png` again, so CI makes them with the new font. The hint now wraps at 1280 px, and the labels may settle differently. I checked the other baselines and none show this change:
  - the HUD hint shows only with a voice, which CI doesn't have;
  - the progress bar's new minimum width is far below its width in the baselines;
  - the lesson-path view hides the corner buttons and the labels, so `map-lesson-path.png` keeps main's version.

## After the a11y review

- **B1–B3** were fixed in c842ec5: the race in the re-announce test (now with an N4 unit test), My Island landing on `play`, and the "Hear it again" fit. The review's N1 (flaky shake control) is fixed the same way: the check now uses camera roll, not frame-to-frame jumps.
- **B4:** merged origin/main (#186). Only the three map baselines conflicted; they are deleted and remade on CI. The "Hear it again" fit at text scale 2 is measured again by its e2e on this head, with the Atkinson font.
- **S1, the long-press mark:** it is cleared in a task right after the finger lifts, so it can only swallow that lift's own click. A later click with no pointer before it (TalkBack's double tap, Switch Access, Voice Access) always goes. New unit test: long press, lift with no click, then a click with a detail → it goes.
- **S2, two messages at once:** `announce` holds a toast until `TOAST_AFTER_PAGE_MS` (1 s) after the last page message, so the page speaks first and the toast follows. New unit test in `kit.test.tsx`.
- **S3, the clickable container:** the click and hover handlers are no longer on the map container. They are on an `aria-hidden` stage layer (`data-stage`) under the heading, labels and corner buttons, present only while the whole map shows in 3D. New unit test: a click on the heading asks nothing, and the layer is gone while a path is open.
- **S4, near misses:** the fallback is now the ellipsoid inside each island's box, not the box. The box's empty corners, where the review found its near misses, are no longer targets. Gaps between trees still are. New unit test: a point just inside the outermost on-screen corner of Meadow's box doesn't pick Meadow. I didn't repeat the review's grid measurement of near misses.

- **(c) at text scale 2 (found by M3-FIX-8's e2e):** at 1280×720 and text scale 2 on main, the hint lay over My Badges and took its clicks.
  - On this branch the heading already stopped short of the corner buttons at every width (`--corner-w`). At text scale 2, though, the four word buttons leave it only about 290 px beside them at 1280 px.
  - Now, when the room beside the buttons is under 14rem × the text scale, the heading moves below them (`data-stack`, `--corner-h`) and keeps 72 % of the width.
  - The whole heading (title, hint and note) has `pointer-events: none`. It holds nothing to press, so even if a plate ever overlaps a button, the button keeps its clicks. A click on the heading's area now goes to the 3D picture under it.
  - The e2e sweep runs at text scale 1 and 2, at 11 widths from 1024 to 1920 px, and checks four things:
    - neither the title nor the hint overlaps a corner button;
    - each plate is at least 100 px wide;
    - the middle of each corner button is its own (`elementFromPoint`);
    - the heading's `pointer-events` is `none`.

## Owner check at the M3 gate

- **GrayText contrast in Windows Contrast themes.** Typed letters (`data-mark="ok"` and `"fixed"`) use the system `GrayText` color under `forced-colors: active`. The documented palettes suggest at least 4.5:1, but nobody has looked on a real Windows Contrast theme. Please check all four themes (Aquatic, Desert, Dusk, Night sky) once in a lesson: typed letters should look dimmer than the letters still to type, and stay readable.

## Acceptance

- [x] An e2e clicks the centre of the Meadow island's model (not its label) and the lesson panel opens: `map.spec.ts`, "a click on the middle of the Meadow island's model opens its lesson path". It runs on CI; I ran no local e2e, because it was evening.
- [x] Each item is fixed or listed with a reason:
  - Whole island, cursor, hover: done.
  - N1: done (unit tests and e2e at 1024×600).
  - N2: done.
  - N3: done (e2e and code).
  - N4: done (e2e).
  - (a) one tap: done (unit tests and e2e).
  - (b) swallowed click: done (unit tests and e2e).
  - (c) hint from 1024 to 1920 px: done (e2e).
  - (d) 1024×600 fit check: done (e2e).
  - GrayText: done. No automated forced-colors test; Chromium headless can't emulate it in our setup. Owner check at the gate (see above).
  - Banner flash guard: done (unit test).
  - Shared guard clock: done (unit test).
  - Reduced-motion e2e: done (both parts).
  - Separate live regions: done.
  - Results reads motion live: done (hook test).
  - KeyCap font: done.
  - "Hear it again" at scale 2: done (e2e). It didn't fit: on the first CI run, Miner at 1024×720 left the progress bar 87 px. So, as the review suggested, the words now drop and the key cap stays. The hint is one line tall and wraps, so words with no room move to a hidden second line and are never cut in half. The progress bar keeps `min(120px, 15%)`.
- [ ] Accessibility review passes. This needs the reviewer.
- `npm run verify` passes locally (115 files, 4315 tests, size in budget).

## Decisions

- **Corner buttons on touch (a): one tap goes; a long press (500 ms) shows the words.**
  - One tap now does what the button says, the same as a click, Enter or VoiceOver's double tap. Two taps confused children, and assistive tech couldn't always reach the second one.
  - I chose a long press over showing the tip "briefly alongside the action", because every corner button leaves the map, so a tip shown with the action would vanish with the screen.
  - A long press lets a curious child find out what a picture means without going there. Lifting the finger after a long press does nothing.
  - Mouse users still get the tip on hover, and keyboard users on focus.
- **(b):** the long-press flag is set only by the timer firing. It is cleared on every `pointerdown`, `pointercancel` and click, and in a task right after the lift (review S1). Only a pointer click (`detail > 0`) that comes with the lift is ever swallowed. A scroll can't leave anything set, and neither a key's click (`detail === 0`) nor a later assistive-tech click is swallowed.
- **Island picking:** the meshes come first, with a fallback to the ellipsoid inside each island's box. Children aim loosely, and a gap between trees shouldn't be a miss. A real block hit always wins over the fallback, and between two fallbacks the nearer one wins. The reviewer measured that no two islands' boxes overlap along any ray at 10 sizes.
- **Hover highlight** is a 1.3× brighter material plus the label's gold edge, with no lift. It works the same with or without reduced motion, and keyboard selection keeps its lift. Locked islands get no glow and no hand cursor, the same as their labels, but a click on one still gives the kind line.
- **The hint's limit at all widths** uses the same `--corner-w` measure that M4-FIX-1 added for ≤ 1100 px. At 1280 px and above, the hint wraps under the title when the word buttons need the room.
- **Label layout fallback:** if every greedy order leaves a label stuck, rows are used, even though they move some labels farther from their islands. Keeping every label readable and inside the window comes first.
- **Toasts get their own live region**, and a toast waits until 1 s after the last page message (review S2), so VoiceOver can't drop the first of two. I haven't run a screen reader on it; it's worth a listen at the gate.

## New dependencies

- None.

## Notes for downstream tasks

- `WorldMapView` has new methods: `pick`, `hover` and `centers`. Any fake of it needs all three (see `map-rebuild.test.tsx`).
- `allowFlash()` takes no argument now. Use `createFlashGuard` with your own clock for planned flashes.
- `announce(doc, text, "toast")` is for toasts; the default channel is `"page"`. A toast waits until `TOAST_AFTER_PAGE_MS` (1 s) after the last page message. E2E checks of route announcements still use `#vt-announcer`, and toast text is in `#vt-announcer-toast`.
- The map's click and hover layer is `[data-stage]` (aria-hidden). It exists only while the whole map shows in 3D.
- `useReducedMotion(setting)` in `src/ui/screens/nav.ts` is the live version of `prefersReducedMotion` for components.
- Ownership: this card touched some shared files outside the map, as its a11y items needed:
  - `Hud.tsx` and `Hud.module.css`;
  - the kit's `Toast`, `KeyCap` and `announce`;
  - `OnScreenKeyboard.tsx`;
  - `nav.ts` and `Results.tsx`;
  - `route-announcer.ts`;
  - the comment in `mine.spec.ts`.

  Each change is small.

## Contract change request / Questions

- None. `WorldMapView` and `announce` aren't in `contracts.md`, and the new parameters are optional.

Closes #162
