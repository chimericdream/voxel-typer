# M3-FIX-13 Key faces, Results side by side, Escape race

Status: done (CI is the e2e gate: no local e2e was run, by the owner's daytime rule)

## What changed

- `src/ui/keyboard/KeyIcon.tsx` (new): icons for Backspace, Caps Lock, Tab, Enter and Shift, each
  an SVG named by its key's `t("keyboard.key.*")` string. Space keeps its word.
- `src/ui/keyboard/OnScreenKeyboard.tsx`: named keys draw `KeyIcon`; two-char keys draw their chars
  as two spans; new `fitFaces` (run from `fitLabels`, and again when the lit key or the labels
  change) marks a two-char key `data-face-tight` when two 12-px lines don't fit inside its outline
  and label lift; `data-shifted` marks a key lit for its Shift char.
- `src/ui/keyboard/OnScreenKeyboard.module.css`: every key face is at least 12 px (letters
  `max(12px, 0.42u)`, two-char `max(12px, 0.27u)`, Space `max(12px, 0.3u)`), icons at least 14 px. A
  tight key shows one char at the letters' size: the Shift char when lit for it, else the plain
  char. The M4-FIX-4 short-row rules are untouched (28-px key floor, letters 0.5u).
- `src/ui/kit/KeyCap.tsx`: `glyph` takes any `ComponentChildren` (was `string`), for the icons.
- `src/ui/screens/Results.module.css`: on a short, wide window (`max-height: 760px` and
  `min-aspect-ratio: 3/2`) the page is a grid: heading across the top, the card on the left, the
  buttons in a column on the right. The badge-toast dock moves under both columns (on the page's
  content edge), so a toast shows below the card and the buttons and waits when it doesn't fit.
- `src/app/shell.ts`, `src/app/App.tsx`: new `Shell.screenDrawn(route)`, called by `ScreenView`
  once the route's screen has drawn. The router's unhandled-Escape step back now runs only when the
  current route's screen is up (play always counts as up). `AppApi.back()` (Back buttons) is never
  held back. Until the app first calls `screenDrawn`, nothing is held back, so shells in unit tests
  behave as before.
- Fixtures: `small-text-sprout` (text scale 1), `big-text-sprout` (2), `big-text-builder` (2),
  copies of `fresh-sprout` / `fresh-builder` with a new id.
- Tests: `tests/unit/ui/keyboard.test.tsx` (icons and their names, `fitFaces`, `data-shifted`),
  `tests/unit/app/shell.test.ts` (Escape held until the screen draws), `hud.test.tsx` (hand-SVG
  counts skip key icons). E2E: `key-faces.spec.ts`, `results-fit.spec.ts`, `escape-race.spec.ts`;
  `achievements.spec.ts` waits for the map before Escape; `results-toast.spec.ts` lets a text
  scale 2 toast show on Results when it fits (it still checks that it covers nothing).

## Acceptance

- [ ] Item 1: nothing printed on a Sprout's keyboard is under 12 px; long names are icons with an
  accessible name through `t()`; key floor 28 px. `tests/e2e/key-faces.spec.ts` (Mine and Night
  Defense × 1024×600, 1280×720 × text scale 1, 2), `tests/unit/ui/keyboard.test.tsx`. CI.
- [ ] Item 2: Results at 1024×600 and 1280×720, text scale 1 and 2, Builder and Sprout: with "Next
  lesson" focused, nothing scrolled, and the heading, the stars and the three buttons are wholly on
  screen, the buttons right of the card. At scale 1 the whole card too.
  `tests/e2e/results-fit.spec.ts`. The toast dock: `tests/e2e/results-toast.spec.ts`. CI.
- [ ] Item 3: Escape right after "Back to the map", before the map has loaded, stays on the map
  (the map's code is held back 1.5 s, so the race always happens). `tests/e2e/escape-race.spec.ts`,
  `tests/unit/app/shell.test.ts`. The achievements World Map toast e2e waits for the map heading
  before Escape. CI.
- [x] `npm run verify` passes locally.

## Decisions

- The 12-px floor applies to every band, not only Sprout: one rule, and a Builder's punctuation
  keys were 10.8 px too.
- A two-char key that can't fit two 12-px lines shows one char rather than shrinking. The char to
  type is never hidden: a key lit for its Shift char shows that char. The room counts text over the
  inner bevel shading as on the key, but not over the outer outline.
- Shift shows an icon too, not the word: on ISO layouts the left Shift is 1.25 units, too narrow
  for "shift" at 12 px next to a finger label. The hint line and the spoken name still say "shift".
- Results two-column layout keys on `min-aspect-ratio: 3/2` with the existing `max-height: 760px`,
  so it covers 1024×600 and 1280×720 at every text scale. At text scale 2 a tall card can still run
  below the window (the page scrolls), but the heading, the stars and the buttons show on arrival.
- Escape: held back in the shell's router path, not by a timer. Kept out of `ScreenView`'s loading
  logic (one hook call), so PR #218's screen cache merges around it: there, `drawn` becomes
  "the screen drew in this render".

## New dependencies

- none

## Notes for downstream tasks

- PR #218 (M4-FIX-7) rewrites `ScreenView`'s body. On merge, keep `useScreenDrawn(shell, route,
  drawn)` before the early returns, with `drawn` true when a screen component is drawn (the cache's
  or the loaded one) or the route has no loader.
- A test that counts SVGs inside the keyboard must skip `svg[data-key-icon]`.

## Contract change request / Questions

- (none)

Closes #215
