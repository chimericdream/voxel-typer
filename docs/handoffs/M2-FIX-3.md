# M2-FIX-3 Owner playtest fixes: age-aware stars, no extra space

Status: done

## What changed

- `src/engine/stars.ts` (pure): `StarInput` gains `band?: AgeBand`. `BAND_STAR_RULES` holds the band table from contracts §6. With no band the rules are exactly Builder's, the rules from before.
- `src/modes/mine/mine.ts`: passes `band` to `computeStars`, and wraps the generated targets in `blockTargets`.
- `src/modes/mine/logic.ts`: new `blockTargets(targets)`, which sets `trailingSpace: false` on every target, so a block breaks on its last char.
- `tools/sim.ts`: passes `--band` to `computeStars`, the only other caller, so the simulator rates stars the way the game does.
- `src/ui/screens/Results.tsx` and `.module.css`: a tighter layout and room under the buttons for the focus ring.
- `src/render/fx/index.ts`: the atlas-swap check drops live chips only when they were cut from an earlier atlas.
- Tests:
  - `tests/unit/engine/stars.test.ts`: a band table at every boundary, plus Sprout's missing speed check.
  - `tests/unit/modes/mine/logic.test.ts` and `mine.test.ts`: blocks finish on their last char.
  - `tests/unit/dom/fx.test.ts`: the first atlas keeps chips made before it.
  - `tests/e2e/mine.spec.ts`: no space after a word.
  - `tests/e2e/slice/baselines.spec.ts`: the Results buttons and focus ring fit at 1280×720.
- Baselines: removed `slice/baselines.spec.ts/results.png` and `mid-word.png` so the Update snapshots workflow makes them again. Results has a new layout, and mid-word no longer shows a `␣` cell after the word.

### 1. Stars by age band: the pedagogy change (needs the pedagogy review)

`target` is `lesson.targets.accuracy`. Every Meadow lesson has a target of 0.85 and no `wpmRelative`.

| Band    | 2nd star                 | 3rd star | 3rd star speed check | Meadow before → after                  |
| ------- | ------------------------ | -------- | -------------------- | -------------------------------------- |
| sprout  | max(0.85, target − 0.05) | 0.90     | none                 | 2★ 0.90 → **0.85**; 3★ 0.95 → **0.90** |
| miner   | max(0.88, target − 0.02) | 0.93     | as before            | 2★ 0.90 → **0.88**; 3★ 0.95 → **0.93** |
| builder | max(0.90, target)        | 0.95     | as before            | unchanged                              |

- **Effect:** Sprout and Miner children get 2 and 3 stars at lower accuracy. With the mastery rule unchanged (a biome's mastery lesson needs ≥ 2 stars), a Sprout child now unlocks the next biome at 85 % accuracy instead of 90 %, and a Miner child at 88 %. Sprout's 3rd star never depends on speed, so a slow, careful 6-year-old can reach 3 stars. For Miner and Builder, speed still counts only against the child's own baseline, and no shipped lesson sets `wpmRelative` yet.
- **What stays:** a finished lesson always gets at least 1 star, an unfinished one 0. Sprout still sees stars only, never a percentage. Results' 700 ms arm time is unchanged.
- **Float noise:** `0.9 − 0.05` is `0.8500000000000001`, which would refuse 17/20 at exactly 85 %. The accuracy checks get the same 1e-9 slack the speed check already had. A test covers 17/20, 22/25 and 57/60.

### 2. No extra space at the end: where it came from

- **Not the generator or the matcher.**
  - The generator gives word-like targets `trailingSpace: true` (contracts §5, M1-06), which is right for text that runs on.
  - The session asks for that space only while another target follows (M1-03). The **last target of a lesson already finished on its last char**: I checked this with a probe session.
- **The source was Mine's segmentation.** Mine shows **each target as its own block** but kept the generator's `trailingSpace: true`. So every word block and every phrase block (`a sad lad`) waited at crack stage 9 for a space nobody could see.
- **The fix**, in Mine, at the point where it turns targets into blocks: `blockTargets` sets `trailingSpace: false`. This uses an existing optional contract field (contracts §3 `Target.trailingSpace`), so **no contract change**. The generator, matcher and session are untouched, so later flowing-text modes (practice) still get spaces between words.
- **Spaces inside a phrase or sentence** are part of its text and still count.

**Effect on stats** (Mine only):

- **Spaces counted:** word lessons now have no space keystrokes. Phrase lessons count only the spaces inside each phrase. `correct` drops by one per block that used to need a space.
- **Per-key stats for space:** fewer space attempts from Mine. The space key's weight in `keyWeights` now rests on phrase lessons and later modes. Space is not a `newKeys` focus key in Meadow, so lesson content is unchanged.
- **WPM:** net WPM counts correct chars / 5, so for short words it drops by about the space's share: roughly 1/(L+1), about 20 % for 4-letter words. The time from a word's last letter to the next word's first key is still active time.
  - The speed baseline is the median of the last 10 mine/practice/minecart summaries. For up to 10 word sessions after this change it still includes older, space-padded sessions. That would make a Miner or Builder speed check slightly harder, but no lesson uses `wpmRelative` today, so no star changes now.
  - Sprout has no speed check at all.
- Tests: `mine.test.ts` plays meadow-05 (words) and meadow-06 (phrases). No breaking key is a space. The keys typed are the texts back to back. `summary.correct` and `perKey[" "].attempts` match the spaces inside the texts.

### 3. Results at 1280×720

- At Sprout's text scale (1.5) the screen was about 25 px taller than the window.
- Results now has:
  - smaller gaps: screen gap 24 → 16 px, card gap 16 → 12 px, card padding 24 → 16 px top and bottom;
  - loot slots one step smaller (56 → 48 px base) when the window is under 800 px tall;
  - bottom padding that always leaves room for the 7 px focus ring.
- On a window still too short for the whole screen, the buttons have `scroll-margin-block` covering the ring, so focusing Next lesson scrolls it into view with the ring showing.
- Wider and taller windows look the same apart from the gaps.
- The new e2e check: all three buttons ± 7 px sit inside `<main>`, `scrollTop` is 0, and Next lesson has focus.

### 4. FX atlas swap

- `chipTexture !== null` is now part of the drop condition.
- Chips burst before the first atlas loaded are left alone when it arrives.
- Chips are still dropped when their atlas is replaced or goes away (new test).
- Untextured chips still flying when the next burst sets the atlas texture draw with the full-atlas UV for their last few frames. That is a harmless blip, and only before the world has loaded.

## Acceptance

- [x] Star table tests per band; existing star tests still pass with no band: `tests/unit/engine/stars.test.ts` (58 tests). A test also checks that every row with no band gives the same stars as Builder, and that the bars never get stricter from Sprout to Miner to Builder (all accuracies at 0.001 steps).
- [x] A test proves a lesson's last word finishes without a trailing space, and so does every other block:
  - `tests/unit/modes/mine/mine.test.ts`: "meadow-05 / meadow-06: every block finishes on its last char", and "breaks the block on its last letter";
  - `tests/unit/modes/mine/logic.test.ts`: "makes every target a block that breaks on its last char";
  - `tests/e2e/mine.spec.ts` meadow-05.
- [x] Results buttons and focus ring fully visible at 1280×720: the e2e check in `tests/e2e/slice/baselines.spec.ts` "results". The baseline is refreshed through the Update snapshots workflow (see the PR's bot commit).
- [x] FX: `tests/unit/dom/fx.test.ts` "keeps chips made before any atlas when the first atlas loads". It fails on the old code.
- [x] `npm run verify` green. No local e2e was run (owner's load rule, decision 79). CI runs it.

## Decisions

- **The trailing space is dropped in Mine (`blockTargets`), not in the generator or the matcher.** A block is a separate object with nothing after it. Flowing-text modes keep the generator's spaces between words. No contract change.
- **The accuracy bars get 1e-9 slack**, like the speed check, so `target − 0.05` float noise never costs a star. With no band it can only matter within 1e-9 of a bar, which a real correct/total ratio never is.
- **`tools/sim.ts` passes its `--band`** to the star rules, so its star distributions match the game. Its default band is Miner, so default sim runs show slightly more stars than before.
- **Results compaction** is in Results' own sheet. A doubled class `.page.page` beats the shared `.screen`. The smaller slots apply only under 800 px tall.

## New dependencies

- None.

## Notes for downstream tasks

- **Any mode that shows one target per object** (Defense mobs, Minecart signs, Boss) should pass its targets through `blockTargets` or set `trailingSpace: false`. Flowing text (practice, daily) should keep the generator's default.
- `nextKeyOf`'s space branch, the HUD's `␣` cell and `hud.wordSpace` still work for any mode that keeps trailing spaces. Mine no longer reaches them.
- **e2e helpers:** a Mine word no longer waits for a space. `state().next` never returns `" "` between Mine blocks, only inside a phrase.
- **Star callers:** always pass `band` (`ctx.band`). Leaving it out gives Builder's bars.

## Contract change request / Questions

- None. The band field was approved (decision 80). The trailing-space fix uses the existing `Target.trailingSpace`.

Closes #144

## Review fix (orchestrator, B1 of review 5869357876)

- **The bug:** with no trailing space, a space typed out of habit between blocks counted as a wrong key.
  - Sprout and Miner: a streak break and lower accuracy.
  - Builder: the space was charged to the next block's first letter, shifting every later key.
- **The fix:** Mine now drops a space when no block is active or nothing of the active block is typed yet (`isStraySpace` in `src/modes/mine/logic.ts`). Spaces inside a phrase still count.
- **Test:** for every band, a test types a space after each block of meadow-05 and expects 100 % accuracy with no `wrong` events. All three cases fail without the guard.
- **Also from the review (non-blocking):**
  - meadow-03 (syllables) also loses its between-block spaces.
  - Mine lessons get about 20–33 % fewer keystrokes, because the length budget counted spaces.
