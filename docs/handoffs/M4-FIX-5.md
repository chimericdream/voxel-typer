# M4-FIX-5 Builder: see what you built, simpler Sprout help

Status: done. Screenshot baselines are made on CI (see "Baselines").

Three items from the M4 gate visual review (2026-11-13):

1. After a stamp, trees hid the new House. Now the camera turns to the nearest quarter that shows
   the build.
2. At text scale 2 the palette's count badges covered the block pictures. Now the slot grows and
   the badge stays small.
3. Sprout help showed the six direction words and "Layer 6 · North is at the top". Sprouts no
   longer see either. Miner and Builder keep both.

The Sprout Builder words (`gras`, `dir`, …) are unchanged. They are still the owner's decision.

## What changed

- `src/modes/builder/logic.ts` (pure):
  - `cameraPoint(pose)`: where the camera sits. It uses the same sums as the rig's `applyPose`.
  - `viewBlockage(grid, box, pose, occludes)`: casts a sight line from each camera-facing cell of
    the build (its top layer and the two sides nearest the camera) to the camera. It returns
    `[hidden, blocking cells, face cells]`.
  - `clearestView(...)`: picks the quarter that shows the build.
  - `VIEW_TOLERANCE` = 0.08.
- `src/modes/builder/builder.ts`:
  - After a successful stamp, `showBuild(box)` asks `clearestView` for a view. If that is a
    different quarter, it turns the camera there, the same way `[` `]` turn it.
  - The glide takes `TURN_MS` per quarter. Under reduced motion or `?frozen` it is a cut
    (`durationMs` 0).
  - `TURN_MS` is now exported, for the test.
  - Flowers (shape `sprig`) don't count as blocking.
- `src/modes/builder/BuilderHud.tsx`: for Sprout, no direction-words line (`help.move`) and no
  layer and compass plate. Miner and Builder are unchanged.
- `src/modes/builder/BuilderHud.module.css`: the palette slot now has its own `--text-scale`,
  capped at 1.25. The slot is `min(52px × scale, 80px, 7vh × scale)`, so:
  - at scale 1 its size is unchanged;
  - at scale 2 it grows from 60 px to 80 px;
  - the badge text stops growing at 1.25×.

  The block words and Sprout key caps under the slots still follow the full text scale.

- `src/i18n/en/builder.ts`: a comment on `help.move` only. No string changed or was added; the
  Sprout help uses the existing `help.keys` ("Arrow keys move. Space puts a block.").
- Tests:
  - `tests/unit/modes/builder/logic.test.ts`: 8 new tests:
    - the camera point;
    - an open island keeps the view;
    - the build's own blocks don't count;
    - a wall in front turns to the nearest clear quarter;
    - it turns half way only when both nearer quarters are blocked;
    - blocked all round picks the least blocked quarter;
    - one leaf in front of a house-sized build doesn't turn it;
    - flowers don't count.
  - `tests/unit/modes/builder/builder.test.ts`: 3 new tests through the real mode:
    - nothing in the way: no move;
    - a wall in front: one `TURN_MS` glide, and `]` carries on from the new view;
    - reduced motion: a 0 ms cut.
  - `tests/unit/ui/builder-hud.test.tsx`: Sprout help is short; Miner and Builder keep the
    direction words and the layer line.
  - `tests/e2e/builder.spec.ts`:
    - the grown-island test checks that the view turned after `house`, from "North is at the top"
      to another direction;
    - the Sprout test checks the shorter help;
    - new: at 1024×600 with text scale 2, each badge covers at most a quarter of its slot and at
      most 40 % of its height, the slot is over 64 px, and the palette and command line fit.

## Acceptance

- [x] **A stamped build is not left behind trees.**
  - The real `island-builder` fixture: after `house`, the facing view hid 6 of 52 face cells.
    Builder turns to east, where nothing is in the way. I checked a local render at 1280×720 and at
    1024×600 with scale 2: the whole house is in view.
  - The e2e "a grown island…" asserts the turn.
- [x] **Reduced motion: cut, don't swing.** `builder.test.ts`, "reduced motion: a cut, not a swing"
      (`durationMs` 0). The rig also snaps any glide under reduced motion.
- [x] **One WebGL context, and the loop idles afterwards.**
  - Only `camera.moveTo` is used, the same call as the `[` `]` keys.
  - No new scene, renderer or per-frame work.
  - The glide ends, and the loop idles as before.
- [x] **No fight with `[` `]` and zoom.** The turn changes Builder's own `quarter`, so the keys,
      the arrow-key directions and the compass plate all carry on from the new view. The zoom is
      kept. The camera only turns when more than 8 % of the build's camera-facing cells are hidden,
      and then to the nearest better quarter.
- [x] **Hotbar badge at text scale 2.** Builder has its own palette: `BuilderHud` uses the kit
      `Slot` directly, not the shared `Hotbar`. So the fix is in Builder's CSS, and `Slot.module.css`
      is untouched (#208 may change the shared badge without a conflict). The new e2e checks it at
      1024×600, scale 2. It would fail on main, where the badge was about 40 px tall on a 60 px slot.
- [x] **Sprout help is simpler, through `t()`.** No direction words and no "Layer · North is at
      the top" for Sprout. Miner and Builder keep them. Unit tests and e2e cover both.
- [x] `npm run verify` passes: 128 files, 4705 tests, budgets met.
- [x] **Local e2e** (04:20–04:45, one worker, port 4549, temp config deleted): all 10 `builder.spec.ts`
      tests pass. `inventory.spec.ts`, `m3/keyboard-flow.spec.ts` and `a11y.spec.ts` (18 tests)
      also pass. In the first full run, the M4-FIX-1 full-palette test timed out once on "Getting
      your world ready…" (a cold start). It passed when run again.

## Decisions

- **Turn the camera, don't fade the trees.**
  - A turn reuses the existing quarter views, so the arrow keys and the compass still mean what
    they say, and there is no new material or render pass.
  - Fading would need per-block transparency in the chunk meshes.
- **What counts as hidden.**
  - A cell is hidden when the straight line from its middle to the camera crosses a block outside
    the build. Only the build's top layer and its two camera-facing sides are counted.
  - Counting every cell diluted the measure: the real house case read as 8 % hidden when half the
    front was covered.
  - Flowers don't block.
- **Tolerance 8 %.** One leaf block a few cells in front of a house-sized build hides about 4 of 61
  face cells (6.5 %). That should not swing the camera, and the gate's house case (11.5 %) should.
- **Nearest first.** Tie order is: this view, then one turn right, one turn left, half way. A turn
  happens only if the new view is strictly better.
- **Sprout keeps "Arrow keys move. Space puts a block."** It already says what the card asks for.
  The direction words still work when typed; they are just not advertised to Sprouts.
- **The badge cap is 1.25× and the slot cap is 80 px.** At 1024×600 with scale 2 this adds 20 px
  to the palette's height and still fits the window (asserted).

## New dependencies

- None.

## Notes for downstream tasks

- **#208 (M4-FIX-4):** the Defense hotbar is `src/ui/kit/Hotbar.tsx`, which uses the shared
  `Slot`. This card did not touch `Slot` or `Hotbar`. If #208 caps the badge in
  `Slot.module.css`, Builder's override still works: it sets `--text-scale` and `--slot-base` on
  the slot element only.
- `clearestView` could also be used after other big changes, such as the expansion ceremony's
  return. Today only a stamp uses it.
- Still open from M4-07/M4-08: there is no ghost preview for a blueprint.

## Baselines

- `builder-grown.png` changes: after `house` the camera now looks from the east. Deleted, to be
  remade on CI.
- `builder-sprout.png` changes: the Sprout help is shorter. Deleted, to be remade on CI.
- `builder-miner.png` is unchanged: the slot is the same size at scale 1, and Miner help is the
  same.

## Contract change request / Questions

- No contract change.
- Question for the owner: is "Arrow keys move. Space puts a block." the Sprout help you want, or
  should it be shorter still ("Arrow keys move.")?

Closes #210
