# M4-FIX-1 Builder: digging keeps every block, plus leftovers

Status: done (rework after review of 48a8ee1). Screenshot baselines are made on CI; see
"Baselines" below.

## Rework (review of 48a8ee1)

| #           | What the review found                                                                                                                                                            | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1, blocking | In a full palette each new dug block took the last slot, so the next one pushed it out. After a reopen the palette ranked by count again, and a block owned once never came back | **Within a visit:** a newly dug, armed or placed kind takes the **least recently used** slot. Builder keeps a "last used" tick per block. Slots not used this visit go first (the last of those), then the oldest used. **Across a reload:** the palette's slots are saved with the island (`IslandSave.palette`, the approved additive field). On open they are restored after dropping unknown ids, used-up blocks, repeats and anything past 6. A save without them ranks by count, as before                                           |
| 3           | The tests could not catch it                                                                                                                                                     | New tests. Each one fails on 48a8ee1's `src/` and passes now: the reviewer's own case in the `visit` harness (dig, dig, quit, reopen with a 6-kind bag), and a fast-check property in the same harness (after any run of moves and digs, the newest dug kinds are all in the palette). A unit test of the palette logic digs grass, dirt and stone into a full palette, then reopens. The e2e now uses a new 6-kind fixture, `full-bag-miner`, digs twice, and checks the slots after a pause save and a second visit                      |
| 4           | Touch only showed the tip while the finger was down, and not at all in iOS Safari                                                                                                | In the narrow layout, the first tap on a corner button opens its tip and keeps it open, a second tap goes, and a tap anywhere else closes it. This uses pointer events (`pointerdown` with `pointerType`, then a capturing click). Mouse, keyboard and wide windows go straight away. Unit tests cover all three                                                                                                                                                                                                                           |
| 4           | At 1024 px the hint plate covered Change player, and the baseline froze that                                                                                                     | Fixed (small). The map measures the corner's width into `--corner-w`, and the heading row stops short of it, so at 1024 px the hint wraps under the title. Only in the narrow layout (≤ 1100 px): a first try also applied it at 1280 px, where it wrapped the hint for no reason and broke the 1280 px large-text label checks, so it was taken back there and `map-new-player.png` kept as on main. The e2e now checks that the hint and the Change player button don't overlap. `map-narrow-corner.png` was deleted and is remade on CI |
| 4           | The thicker cursor frame had no check                                                                                                                                            | `tests/unit/modes/builder/view.test.ts`: bars 0.085 thick in the open (2 draws), and buried a 2.5× bold frame over a wider outline (3 draws)                                                                                                                                                                                                                                                                                                                                                                                               |
| 2           | Does the owner's profile really have 6 or more kinds?                                                                                                                            | I can't check the owner's device. See "Questions"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Where the dug grass went

It was never deleted. The island editor moved it into the inventory correctly, and the save wrote
it. I traced the refund delta (`island.ts` `plan`), the write-back (`afterEdit`, `patch()`), the
autosave and the leave save (`play-host`, `withIslandPatch`, `applyResult`'s `addLoot`). All of
them keep it. **The block disappeared in the hotbar filter.** The palette shows 6 slots: the
blocks already shown stay while owned, and a free slot goes to the most-owned block. A player with
six or more kinds from the Mine (the Meadow loot table has 26) has a full palette, so a dug block
owned once never outranks blocks owned by the dozen. It sat in the inventory with no slot, and
there is no inventory screen yet, so it "never showed up anywhere". A block armed by name from
outside the palette had the same problem.

## What changed

- `src/modes/builder/logic.ts`:
  - `steadyPalette(shown, inventory, placeable, focus)` now takes a `PaletteFocus` object: `n`,
    `held`, `picked`, `used`. The block in hand and the block just dug, armed or placed always
    get a slot. In a full palette they take the least recently used one.
  - New `restorePalette`: makes a saved palette safe to show.
- `src/modes/builder/builder.ts`:
  - `dig`, `put` and arming mark a block as used, and it gets a slot.
  - The palette's slots are saved with the island, and restored on open.
  - Moved slots count as a change worth saving, but only on an island that is already saved. A
    fresh island is still written only after its first edit.
  - `dig` leaves water alone, with a kind hint.
  - The habit window is per band (`HABIT_MS`).
- `src/modes/builder/lesson.ts`: `islandPatchOf` keeps a patch's palette when it is a list of at
  most 6 ids, and leaves it out otherwise. A bad palette never stops an island save.
- `src/save/schema.ts`: `Profile.island.palette?: BlockId[]`, optional, at most 6 ids of 1–64
  characters (the approved additive change, no schema bump). This file is orchestrator-owned; the
  orchestrator approved the change in its rework note.
- `src/modes/builder/commands.ts`: when held letters are replayed and one of them doesn't fit,
  they are treated as the end of the name. Before, `plank` then `o` dropped the `k` (M4-07
  review N-B).
- `src/modes/builder/view.ts`:
  - Frame bars 0.06 → 0.085.
  - A buried cursor gets a bold on-top frame (2.5× bars) over a dark outline. Draw calls are
    unchanged.
- `src/i18n/en/builder.ts`: `builder.hint.cantPickUp`: "You can't pick up {name}. It stays
  here."
- `src/ui/screens/WorldMap.tsx`, `WorldMap.module.css`, narrow corner (≤ 1100 px). These files
  are outside "Owns", but the card and the rework note name the items.
  - A button's words open as a tip on hover, on focus, and after a tap (`data-tip`).
  - The `title` attribute is gone.
  - The heading row stays clear of the corner (`--corner-w`, narrow layout only).
  - The comment "Three sliders" is fixed.
- `tests/fixtures/profiles/full-bag-miner.json` (new): `meadow-done-miner` with six kinds and no
  grass or dirt (cobble 30, oak-planks 20, stone 18, brick 14, glass 12, sand 10).
- Tests:
  - `tests/unit/modes/builder/conservation.test.ts`: the conservation property.
  - `tests/unit/modes/builder/view.test.ts`: the cursor frame.
  - `builder.test.ts`: full-palette digs, the reopen, the palette property, arming from outside
    the palette, water, and the Sprout habit window.
  - `logic.test.ts`: LRU slots, `restorePalette`, the palette in `islandPatchOf`.
  - `schema.test.ts`: the new field, and the new fixture is valid.
  - `commands.test.ts`: `planko`.
  - `map.test.tsx`: tap to open, the second tap goes, mouse and wide.
  - `e2e/builder.spec.ts`: a full palette.
  - `e2e/map.spec.ts`: the narrow corner, no overlap, the baseline.

## Acceptance

- [x] Property test (fast-check, seed 181, 40 runs): for any sequence of `put`, `dig`, `undo` and
      reload, the island blocks plus the inventory equal the starting totals for every block,
      after every step and after each save and reload. A reload goes through `withIslandPatch`,
      the validating memory store and `openIsland`. Half the runs start with no grass in the bag.
      File: `tests/unit/modes/builder/conservation.test.ts`. As the review says, this property
      guards conservation, and the engine never broke it. The palette bug is covered by the
      `visit`-harness property in `builder.test.ts` (seed 184), which fails on 48a8ee1.
- [x] e2e: `builder.spec.ts`, "a full palette: dig grass and dirt…". Uses `full-bag-miner` (6
      kinds, no grass or dirt).
  - The palette shows 6 slots, digs twice, and both `grass` and `dirt` show 1.
  - The pause save has both in the inventory and both in `island.palette`. `found` is unchanged.
  - After leaving and coming back both slots are still there, and `grass put` places one.
  - Not run locally (daytime rule); CI runs it.
- [x] Habit window by band: `HABIT_MS`, with a unit test for a slow Sprout.
- [x] `plank` + `o` no longer drops the `k`: `commands.test.ts`.
- [x] Thicker cursor outline: `view.ts`, checked by `view.test.ts`.
- [x] Tooltips open on focus and on touch: CSS for hover and focus, pointer events for a tap.
      Tested in `map.test.tsx`, and in the e2e for focus.
- [x] "Three sliders" comment fixed.
- [x] Narrow corner baseline at 1024×720, made on CI only.
- [x] `npm run verify` passes.

**These fail on the reviewed head:** I put 48a8ee1's `builder.ts`, `logic.ts`, `lesson.ts` and
`schema.ts` back and ran the new `builder.test.ts` cases. "digging a hole in a full palette…" fails
(grass gone after the second dig). The property fails at once on `dig,dig,east 1: grass`. Both
pass on the rework.

## Decisions

- **`IslandSave.palette` (orchestrator-approved, additive, README §4.3).** It touches
  `contracts.md` §15 "Save data (`src/save/schema.ts`)", the `Profile` interface, field
  `island`. The new type is:

  ```ts
  island: {
    grid: ReturnType<VoxelGrid['toJSON']>;
    expansions: number;
    lastEdited: EpochMs;
    palette?: BlockId[];   // Builder's palette slots, in order; at most 6 ids
  } | null;
  ```

  - `SCHEMA_VERSION` stays 1, with no migration. A save without the field ranks the palette by
    count.
  - The schema checks only the shape: a list of at most 6 strings of 1–64 characters.
  - On load, `restorePalette` drops unknown ids, ids the player no longer owns, repeats and
    anything past 6.
  - `islandPatchOf` drops a malformed palette rather than refusing the patch, so a bad palette
    can never stop an island save.

- **Least recently used.** "Used" means dug, armed or placed this visit. Slots not used this
  visit go first, the last of them first, so the first slots stay put. The block in hand and the
  block being added are never evicted.
- **Touch tip:**
  - The first tap opens the tip and keeps it open.
  - The second tap on the same button goes.
  - A tap anywhere else closes it.
  - A pure toggle (tap again to close) would leave a touch user no way to press the button, so
    the second tap goes instead.
  - It only applies in the narrow layout (`matchMedia("(max-width: 1100px)")`), where the words
    are hidden. Wide windows, a mouse and the keyboard are unchanged.
- **Grass stays grass.** It is a placeable block, the Meadow Mine loot gives out grass (weight 6,
  the same as dirt), and the inventory type is any block id. Mapping grass to dirt would make the
  island and the Mine disagree.
- **Water can't be dug.** It is the only non-placeable block that starter terrain uses. It has no
  drop, and no slot could show it. `dig` on water says so and changes nothing.
- Habit window: Sprout 3 s, Miner 2 s, Builder 1.5 s, as the card suggests.

## New dependencies

- none

## Notes for downstream tasks

- `steadyPalette(shown, inventory, placeable, { n, held, picked, used })` and
  `restorePalette(saved, inventory, placeable, n)` live in `src/modes/builder/logic.ts`.
- `HABIT_MS` is now `Record<AgeBand, Ms>`.
- The map sets `--corner-w` on its root while the corner buttons show. In the narrow layout `.top` uses it to stay
  clear of them.
- A new fixture, `full-bag-miner`: a Miner with a full palette and no grass or dirt.
- Remaining gap, for M4-09's inventory screen: a seventh, eighth… kind dug in one visit pushes
  out the least recently used one. It is in the bag and can be armed by name, but it has no slot.

## Baselines

- `map-narrow-corner.png`: deleted and remade on CI (13afdeb), because the heading now wraps clear
  of the corner. It shows the hint under the title and the My Island tip open.
- `map-new-player.png`: the same run remade it with the 1280 px hint wrapped. That came from the
  first try at the fix, now scoped to the narrow layout, so the file is restored to its main
  version.
- `builder-miner.png`, `builder-sprout.png`: unchanged (the thicker frame is inside their
  budget). The cursor frame is now checked by `view.test.ts`.

## Contract change request / Questions

- **Contract change (approved by the orchestrator):** `IslandSave.palette`, as under
  "Decisions". Please copy it into `contracts.md` §15.
- **Question (review item 2):** I can't confirm that the owner's profile had six or more kinds.
  Without that, a bag of only dirt leaves free slots, and grass would have shown on main too. I
  found no other loss path. The engine, the write-back, autosave, leave and the store all keep
  the block, and the property test checks every step. The owner could check: on the device,
  open the profile export, or type `grass` on My Island. If grass is there with a count, this
  was the palette.
- The Sprout words, the damaged-island reset and the `veteran-builder` fixture are untouched, as
  the card says.

Closes #181
