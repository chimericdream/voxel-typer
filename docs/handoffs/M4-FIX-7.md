# M4-FIX-7 Night Defense Results line is slow to appear, plus plates over other mobs

Status: done

Two items. The M4-FIX-4 worker saw Night Defense's Results line ("… sent home") come 10.4 s after
the route switched to Results on a clean origin/main. The #213 review (N3) saw word plates sit over
_other_ mobs' heads ("shade" plate over the "rugs" mob), so a child reads that mob as gone.

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
- `src/main.ts`: `preloadScreen(id)` calls `screens[id]?.()` and ignores a failure (the screen
  tries again when it is shown).

A lesson lasts far longer than any stall, so the chunk is in memory when Results comes. The
`import()` promise is the browser's module cache, so the later load returns the same module.

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
- `src/modes/defense/plates.ts`: each wish gets its mob's head from `mobHead` when the feet are
  known (Defense always passes them). A plate marked `covers` is drawn at `COVER_OPACITY` (0.7)
  with `data-covers="1"`, so the mob shows through. **The locked plate is never faded:** its word
  and its double frame stay at full strength.

## Tests

- `tests/unit/app/shell.test.ts`: entering `play` asks for `results` at once, before the lesson
  ends. The island asks for `map`. `endScreenOf` for each lesson kind.
- `tests/unit/modes/defense/logic.test.ts`, new block "plates and other mobs' heads (M4-FIX-7)":
  `mobHead`; the review's case (the near "shade" plate slides 42.5 px left, nearer than 48 px up,
  and still spans its mob); a head too wide to slide by sends the plate up; order (a locked far
  plate keeps its spot, and the near one works round it); with no room the plate is marked
  `covers` and still touches no plate; a property test (seed 7216, 400 runs) that plates never
  overlap and any plate on another mob's head is marked; a three-lane night has at most one faded
  plate.
- `tests/unit/dom/defense-view.test.ts`: a plate that must lie on a head gets `data-covers` and
  opacity 0.7. Locked, it doesn't. With room it moves off and isn't faded.
- `tests/e2e/results-lines.spec.ts` (new):
  - Night Defense under reduced motion at 1024×600: the night's lines ("sent home", "Best streak")
    within 500 ms of the route change, in the same render as the heading.
  - Mine (`meadow-01`, a Miner), at 1280×720 with motion (≤ 1.5 s) and at 1024×600 under reduced
    motion (≤ 500 ms). Here **`page.route` holds the Results chunk back 2.5 s**, a slow server on
    purpose. With the preload removed, both cases fail (2568 ms measured). With it, both pass.
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
      ways, with a 2.5 s chunk delay that fails without the fix).
- [x] **Check Mine's Results too.** Same path, same fix, `results-lines.spec.ts`.
- [x] **Plates avoid every mob's head; order and lock frame readable**, or fade a covering plate.
      Both: nudge first, fade (0.7) only when there is no free spot, never the locked plate.
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
- **Fade to 0.7, not lower.** It is a typing target: dark text on the light plate stays readable,
  and the mob behind shows through. It happens only when no free spot exists.

## New dependencies

- None.

## Notes for downstream tasks

- Every lesson now fetches its end screen's code as it starts. A new mode with its own end screen
  should extend `endScreenOf` in `shell.ts`, which `onFinished` also uses.
- `layoutPlates` takes an optional `head` on each wish, and `PlatePlace` has `covers`.
  `data-covers="1"` marks a faded plate for the e2e.
- The `vite preview` stall (10.0 s on one request, others queued behind it) can still hit any
  lazy chunk fetched mid-test, such as `AchievementToast` at boot. Screens fetched from a menu
  are not covered by this fix.

## Contract change request / Questions

- (none) `src/app/shell.ts` and `src/main.ts` are app files outside the defense mode. The change
  is one optional dep and a routing helper with the same routes as before.

Closes #216
