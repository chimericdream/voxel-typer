# M4-FIX-1 Builder: digging keeps every block, plus leftovers

Status: done. Screenshot baselines are made on CI; see "Baselines" below.

## Where the dug grass went

It was never deleted. The island editor moved it into the inventory correctly, and the save wrote
it. I traced the refund delta (`island.ts` `plan`), the write-back (`afterEdit`, `patch()`), the
autosave and the leave save (`play-host`, `withIslandPatch`, `applyResult`'s `addLoot`). All of
them keep it. **The block disappeared in the hotbar filter.** The palette shows 6 slots: the
blocks already shown stay while owned, and a free slot goes to the most-owned block. A player with
six or more kinds from the Mine (the Meadow loot table has 26) has a full palette, so one dug
grass block never outranks blocks owned by the dozen. It sat in the inventory with no slot, and
there is no inventory screen yet, so it "never showed up anywhere". A block armed by name from
outside the palette had the same problem: `held` kept a slot only if it was already shown.

With an empty or near-empty bag (the unit test's `fresh-sprout`), dug grass always showed, which
is why the M4-07 tests passed.

## What changed

- `src/modes/builder/logic.ts`: `steadyPalette` takes a `picked` block too. The block in hand and
  the block just dug always get a slot. In a full palette they take the last slot that is neither,
  so the other slots don't move.
- `src/modes/builder/builder.ts`: `dig` puts the dug block in the palette. `dig` leaves water
  alone, with a kind hint. The habit window is per band (`HABIT_MS`: Sprout 3 s, Miner 2 s,
  Builder 1.5 s). The header comment now says what happens to a dug block.
- `src/modes/builder/commands.ts`: when held letters are replayed and one of them doesn't fit,
  they are treated as the end of the name, as with `plan` then `dig`. Before, `plank` then `o`
  dropped the `k` and left `no` on the line (review N-B).
- `src/modes/builder/view.ts`: frame bars 0.06 → 0.085. A buried cursor gets a bold on-top
  frame, with bars 2.5× as thick, over a dark outline, in place of the thin on-top pass. Draw
  calls are unchanged: 2 in the open, 3 when buried.
- `src/i18n/en/builder.ts`: `builder.hint.cantPickUp`: "You can't pick up {name}. It stays
  here."
- `src/ui/screens/WorldMap.tsx`, `WorldMap.module.css`: in the narrow corner (≤ 1100 px) a
  button's words open as a tip under its picture on hover, on focus (`:focus-within`) and while
  pressed (`:active`, for touch). The `title` attribute is gone, because the tip replaces it and
  in wide windows it only repeated the visible words. The comment "Three sliders" now reads "Two
  sliders, each with its knob". These files are outside "Owns", but the card names the items.
- Tests:
  - `tests/unit/modes/builder/conservation.test.ts` (new): the property test, plus a direct
    test that dug grass survives a save.
  - `builder.test.ts`: full palette plus dig, digging down and reopening, arming from outside
    the palette, water, and the Sprout habit window.
  - `logic.test.ts`: the `steadyPalette` slot rules.
  - `commands.test.ts`: `planko`.
  - `tests/e2e/builder.spec.ts`: dig grass with none in the bag.
  - `tests/e2e/map.spec.ts`: the narrow corner baseline.

## Acceptance

- [x] Property test (fast-check, seed 181, 40 runs): for any sequence of `put`, `dig`, `undo` and
      reload, the island blocks plus the inventory equal the starting totals for every block,
      after every step. The test checks this after each save and reload through
      `withIslandPatch`, the memory save store (validator included) and `openIsland`.
      Half the runs start with no grass in the bag. Edits land where Builder sends them
      (`putCell`, `digCell`). `found` stays as the bag was. File:
      `tests/unit/modes/builder/conservation.test.ts`. I checked that it can fail: when the
      engine skips the grass refund, it fails with a two-step counterexample.
- [x] e2e: `builder.spec.ts`, "dig grass with no grass in the bag…". `meadow-done-miner` (planks
      and cobble, no grass) digs once. The `grass` slot shows 1. The pause save has
      `inventory = { oak-planks: 12, cobble: 30, grass: 1 }` and an empty cell. `found` is
      unchanged. After leaving and coming back the slot still shows 1, and `grass put` places
      it. Not run locally (daytime rule); CI runs it.
- [x] Habit window by band: `HABIT_MS`, with a unit test for a slow Sprout (a 2.5 s pause is still
      the habit space).
- [x] `plank` + `o` no longer drops the `k`: `commands.test.ts`.
- [x] Thicker cursor outline: `view.ts`. The new picture is in `builder-*.png`.
- [x] Tip on focus and touch: CSS. The e2e checks that the words go from clipped (< 2 px) to a
      visible tip (> 40 px) when the button is focused.
- [x] "Three sliders" comment fixed.
- [x] Narrow corner baseline: `map-narrow-corner.png` at 1024×720, with My Island focused, made
      on CI only.
- [x] `npm run verify` passes.

The two new full-palette `builder.test.ts` cases and the arm-by-name case fail without the
`steadyPalette` change (I checked).

## Decisions

- **Grass stays grass.** It is a placeable block, the Meadow Mine loot gives out grass (weight 6,
  the same as dirt), and the inventory type is any block id. Mapping grass to dirt would make the
  island and the Mine disagree, and a kid could never get back the block they dug. So nothing on
  the island maps to a drop.
- **Water can't be dug.** It is the only non-placeable block that starter terrain uses. It has no
  drop, and no palette slot could show it. `dig` on water says "You can't pick up Water. It stays
  here." and changes nothing. This is the card's "refund the block it drops" for the case where
  there is no drop.
- Habit window: Sprout 3 s, Miner 2 s, Builder 1.5 s, as the card suggests. The adaptive option
  (a multiple of the child's recent key gaps) can wait for the M4-GATE playtest.
- In a full palette, the block in hand or the block just dug takes the last slot that is neither,
  in place, so the slots before it don't move.

## New dependencies

- none

## Notes for downstream tasks

- `steadyPalette(shown, inventory, placeable, n, held, picked)`: `held` and `picked` always get a
  slot.
- `HABIT_MS` is now `Record<AgeBand, Ms>`, not a number.
- `map-narrow-corner.png` shows an older layout problem at 1024 px: the "Pick an island. Press
  Enter to go in." plate is drawn over part of the first corner button (Change player). This task
  didn't cause it and doesn't fix it. A follow-up could reserve the corner's width in the
  heading row.
- A future inventory screen would close the remaining gap: a block that drops out of the palette
  later, once 6 other kinds outrank it, is still only visible by typing its name.

## Baselines

New: `map-narrow-corner.png`, made on CI with the Update snapshots workflow on this branch
(commit 712ec5d). The workflow left `builder-miner.png` and `builder-sprout.png` as they were: the
thicker frame stays inside their `maxDiffPixelRatio` budget, and the buried cursor isn't in
either picture.

## Contract change request / Questions

- None. The Sprout words, the damaged-island reset and the `veteran-builder` fixture are untouched,
  as the card says.

Closes #181
