# M4-FIX-7 Night Defense Results line is slow to appear, plus plates over other mobs

Status: done

Two items. The M4-FIX-4 worker saw Night Defense's Results line ("… sent home") come 10.4 s after
the route switched to Results on a clean origin/main. The #213 review (N3) saw word plates sit over
_other_ mobs' heads ("shade" plate over the "rugs" mob), so a child reads that mob as gone.

## Rework (review on #218 at 53c6c16)

| #   | What the review found                                                                                      | What changed                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | The 0.7 fade on a covering plate drops white-on-plate contrast to about 4.2:1, and fades high contrast too | No fade. `covers` is only a data mark (`data-covers`). New DOM test: the plate, its layer and its letters stay at full opacity, locked or not. The comment and the Decisions entry are corrected (white text, dark plate). |
| 2   | The Mine cases' 2.5 s hold from `play` leaves 1–3 s of margin; a fast runner could fail the 500 ms case    | The test waits for the preloaded chunk before typing, so the margin no longer depends on the runner. Hold 2 s, so the preload-off run still fails both limits (see Tests).                                                 |
| 3   | Plates jump about 66 px diagonally when the nearest choice flips                                           | Hysteresis: last frame's slide is kept while it fits (`side` in and out of `layoutPlates`). Unit test.                                                                                                                     |
| 4   | `h(screen, …)` in `App.tsx`                                                                                | `<Screen …/>`. Oxlint's `react/static-components` flags it (the component is read, not declared), so the line carries a disable with its reason.                                                                           |
| 5   | Put the CI-measured times in the handoff                                                                   | The specs print them (`[M4-FIX-7] …`) in the CI log. See "CI-measured times" below.                                                                                                                                        |

## CI-measured times

The specs print each measurement as `[M4-FIX-7] …: Results lines N ms after the route change`.
CI's run on the first fix (`849d2f5`, preload only): Miner night **1940 ms**, retry **2001 ms**
(failed the 1.5 s check; that led to the screen cache). The run on this head is recorded in the
PR description once it finishes.

## Item 1: the slow Results line

**Cause: a stalled fetch of the Results screen's lazy chunk.** I put an in-page probe on the
`defense.spec` night (Miner, `birch-08`). It recorded `__vt.screen()`, the heading, the lines and
resource timing every 5 ms. The finding:

| Run                              |       Route → heading and lines | What the resource timing shows                                                                         |
| -------------------------------- | ------------------------------: | ------------------------------------------------------------------------------------------------------ |
| main `6a12ed2`, three setups     |                        70–90 ms | Results chunk fetched in about 15 ms                                                                   |
| main before #214 (`9d764a2`), #1 |                     **10.07 s** | (no resource log on this run)                                                                          |
| `9d764a2`, #2                    |                           51 ms | about 15 ms                                                                                            |
| `9d764a2`, three nights, #3      | **10.08 s**, **10.07 s**, 71 ms | `Results-*.js` requested at +13 ms, answered **10.0 s** later; `nav-*.js` and the CSS queued behind it |

The whole screen was late, heading included. Results draws nothing until `ScreenView` has its
lazy chunk (`routes.ts`: `results: () => import(...)`), and the chunk was fetched only at the
moment the night ended. In run #3 the `AchievementToast` chunk stalled the same 10 s at boot. So
this is a stall in the server (`vite preview` here) that can hit any request. It is not #214,
#205, the night-end path, the audio or the snapshot: the route switch itself was on time, and
#214's code is not on the slow path. Clean main only looked fixed because the stall is random.
Real hosting can be slow too (a first visit, a weak connection), so the app should not depend on
a fetch at that moment.

**Fix:** the shell asks for the code of the screen a lesson ends on when the lesson starts.

- `src/app/shell.ts`: `endScreenOf(lesson)` gives Results, `map` for Builder and `placement` for
  the placement test. `onFinished` now routes with it (same routes as before), and `enter` calls
  the new optional dep `preloadScreen(endScreenOf(lesson))` on every `play` route.
- `src/main.ts`: `preloadScreen(id)` loads `screens[id]` through `loadScreen` and ignores a
  failure (the screen tries again when it is shown).
- `src/app/screen-cache.ts` (new): `loadScreen(loader)` fetches a screen's code and remembers the
  component, and `loadedScreen(loader)` returns it at once if it has arrived.
- `src/app/App.tsx` (`ScreenView`): a screen whose code is already here is drawn **in the same
  render as the route change**. Before, `ScreenView` always rendered nothing first, then waited
  for an effect (after a frame) and a promise. A screen not loaded yet works as before.

A lesson lasts far longer than any stall, so the chunk is in memory when Results comes.

**Why the second part.** With the preload alone, CI's first run (`43433584261`) measured the
Miner night's lines **1940 ms** and **2001 ms** (retry) after the route change, against 70–90 ms
locally. The chunk was there, but the effect waits for a frame, and on CI's software renderer a
frame right after the night ends is slow. Drawing from the cache takes frames out of the path.

Mine's Results goes through the same `ScreenView`, so it had the same exposure and gets the same
fix. It is checked below.

## Item 2: plates over other mobs

Built on #213's layout (`clearOfBanner`, the stage floor), merged in first.

- `src/modes/defense/logic.ts` (pure):
  - `mobHead(x, top, feet)`: a mob's head box, the top 40 % of its height on the page, 70 % of
    that height wide (`HEAD_SHARE`, `HEAD_WIDTH_SHARE`).
  - `PlateWish.head` (optional) and `PlatePlace.covers` (new).
  - `layoutPlates` keeps plates off every mob's head, its own included. Order is unchanged: plates
    are placed in `order` (locked first, then the mobs nearest the base), and the first keeps its
    spot. A plate whose wish spot touches a plate or a head takes the nearest free spot of these:
    straight up (as before), or slid sideways past heads only. A sideways slide never goes so far
    that the plate stops spanning its own mob's middle, so it still reads as that mob's word.
    Then down, as before. With no free spot it is placed by the old rule (clear of plates only)
    and marked `covers` if it lies on another mob's head. Without heads the result is the same as
    before, and every existing layout test passes unchanged.
  - Hysteresis (review note 3): `PlatePlace.side` says whether the plate slid left (−1) or right
    (1), and `PlateWish.side` passes last frame's side back. While that slide still fits it is
    kept over a nearer spot, so a plate doesn't jump between a slide and a lift as mobs walk.
    (Left and right can never both fit: a slid plate must span its mob's middle, and the head in
    the way covers it. So the jumps were between a slide and "up".)
- `src/modes/defense/plates.ts`: each wish gets its mob's head from `mobHead` when the feet are
  known (Defense always passes them), and the side it slid to last frame. A plate marked
  `covers` gets `data-covers="1"` for the e2e and **stays fully opaque**, locked or not (review
  B1). The covered mob still has its own plate and stem, so the child doesn't read it as gone.

## Tests

- `tests/unit/app/screen-cache.test.ts` (new): a screen is known only once its code has arrived,
  then at once; a failed fetch leaves nothing behind.
- `tests/unit/app/shell.test.ts`: entering `play` asks for `results` at once, before the lesson
  ends. The island asks for `map`. `endScreenOf` for each lesson kind.
- `tests/unit/modes/defense/logic.test.ts`, new block "plates and other mobs' heads (M4-FIX-7)":
  `mobHead`; the review's case (the near "shade" plate slides 42.5 px left, nearer than 48 px up,
  and still spans its mob); a head too wide to slide by sends the plate up; order (a locked far
  plate keeps its spot, and the near one works round it); with no room the plate is marked
  `covers` and still touches no plate; a property test (seed 7216, 400 runs) that plates never
  overlap and any plate on another mob's head is marked; a three-lane night has at most one
  covering plate; last frame's slide is kept while it fits, and let go once the head has gone.
- `tests/unit/dom/defense-view.test.ts`: a plate that must lie on a head gets `data-covers`, and
  it stays fully opaque: no opacity on the plate or its layer, and every letter not typed yet at
  opacity 1. The same when it is locked. With room it moves off and the mark goes.
- `tests/e2e/results-lines.spec.ts` (new):
  - Night Defense under reduced motion at 1024×600: the night's lines ("sent home", "Best streak")
    within 500 ms of the route change, in the same render as the heading.
  - Mine (`meadow-01`, a Miner), at 1280×720 with motion (≤ 1.5 s) and at 1024×600 under reduced
    motion (≤ 500 ms). Here **`page.route` holds the Results chunk back 2 s**, a slow server on
    purpose. If the lesson's start asked for the chunk (the preload), the test lets it arrive
    before typing, so a short lesson on a fast runner can't end first (review note 2). If nothing
    asked for it, the test doesn't wait: the fetch starts at the route change and is held 2 s, so
    the lines come 2 s or more late and both cases fail (≥ 2000 ms against 1500 and 500). Before
    this rework, with a 2.5 s hold and no wait, the preload-off run measured 2568 ms (local).
- `tests/e2e/defense.spec.ts`: the Miner night (with motion) now asserts its lines come within
  1.5 s of the route change, with the heading. The timing is recorded in the page
  (`tests/e2e/helpers/results-timing.ts`), so a slow runner doesn't blur it.
- `tests/e2e/defense-plates.spec.ts` (new): 1024×600 at text scale 1.25 and 2, and 1280×720 at
  scale 2, the review's cases. Nobody types, visitors gather, and the plates are sampled every
  250 ms until two or more have shared the field 30 times. No plate may lie on another mob's head
  unless it is marked `data-covers`, and no two plates may overlap. **With the heads taken out of
  the layout, all three cases fail with "shade over rugs" and "rugs over shade".** With them, all
  pass.

Local runs (07:00–07:23, one worker, private port 4559, temp config since deleted):
`results-lines` (4), `defense-plates` (3), `defense-short` (7, #213's), `defense.spec` (all) pass.
`npm run verify` passes. No screenshot baselines change.

## Acceptance

- [x] **Reproduce on main with a timing probe and find the real cause.** Two of four nights on
      `9d764a2` gave 10.07–10.08 s, the whole screen late. Resource timing shows the Results chunk
      request answered 10.0 s late. Cause: Results' code was fetched only when the night ended.
- [x] **Fix it.** The end screen's chunk is fetched as the lesson starts (`preloadScreen`).
- [x] **e2e: Results lines within 1.5 s of the route change, at once under reduced motion.**
      `defense.spec.ts` (motion), `results-lines.spec.ts` (Defense reduced motion; Mine both
      ways, with a 2 s chunk delay that fails without the fix).
- [x] **Check Mine's Results too.** Same path, same fix, `results-lines.spec.ts`.
- [x] **Plates avoid every mob's head; order and lock frame readable.** Nudged clear of every
      head. With no free spot the plate stays fully opaque and is only marked (`data-covers`).
- [x] **Unit test on the layout function.** `logic.test.ts` and `defense-view.test.ts`.
- [x] **e2e at 1024×600 and 1280×720.** `defense-plates.spec.ts`.
- [x] Built on #213's code (merged origin/main at `9bfbd8a` first).

## Decisions

- **Preload, not a static import.** A static import would put Results in the first bundle
  (`routes.ts`: each screen stays out of it until shown), against the size budgets. Preloading
  when `play` starts costs nothing on the menus, and a lesson is always long enough.
- **The preload is a shell dep** (`preloadScreen`), not an import of `screens` in `shell.ts`, so
  the shell's unit tests don't load real screen modules. `main.ts` already imports `screens`.
- **Heads are the top 40 % of the mob, 70 % as wide as it is tall.** The plate layer knows only
  a mob's top, feet and middle on the page. These shares cover the head and shoulders of the
  current mobs without blocking the whole field.
- **Sideways only past heads.** A plate in the way of another plate is still passed by going up,
  as M4-04's card asks ("nudges them vertically"). Sideways is allowed only for heads, and only
  while the plate still spans its own mob's middle.
- **No fade (review B1).** The plates are `--c-plate: rgba(20,20,24,0.8)` with **white** text
  (`themes.ts`). Fully opaque over a white backdrop the plate comes to about (67, 67, 70), and
  white text on it is about 9.9:1; over black, about 18:1; the high-contrast plate (0.9 black)
  over white, about 17.5:1. The earlier 0.7 fade brought white-over-pale down to about 4.2:1, under
  4.5:1 on a word a child must read and type, and faded the high-contrast theme too. A word plate
  is never faded now.

## New dependencies

- None.

## Notes for downstream tasks

- Every lesson now fetches its end screen's code as it starts. A new mode with its own end screen
  should extend `endScreenOf` in `shell.ts`, which `onFinished` also uses.
- `layoutPlates` takes an optional `head` and `side` on each wish, and `PlatePlace` has `covers`
  and `side`. `data-covers="1"` marks a plate on another mob's head for the e2e; it is never
  faded.
- Follow-up (orchestrator's card): a failed lazy screen load shows a blank page with no retry,
  and some browsers keep a failed module fetch, so the "tried again when shown" comment in
  `main.ts` may be optimistic. A friendly "Try again" panel would fix both.
- The `vite preview` stall (10.0 s on one request, others queued behind it) can still hit any
  lazy chunk fetched mid-test, such as `AchievementToast` at boot. Screens fetched from a menu
  are not covered by this fix.

## Contract change request / Questions

- (none) `src/app/shell.ts` and `src/main.ts` are app files outside the defense mode. The change
  is one optional dep and a routing helper with the same routes as before.

Closes #216
