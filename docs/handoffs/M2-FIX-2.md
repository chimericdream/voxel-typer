# M2-FIX-2 Slice polish from the M2 reviews

Status: done

## What changed

IP (priority 1)

- `src/modes/mine/view.ts`: the first-person sleeve is purple (`wool-purple` 2) with a mustard cuff
  (`wool-yellow` 1), not blue (M2-13 review N4).
- `src/ui/screens/Avatar.tsx`: a new default head on a 10×10 grid: rounded, not square; an auburn
  fringe swept to one side; a leaf sprouting on top; round eyes with a light spot; rosy cheeks. All
  colours come from M1-14 ramps (M2-11 review N5).
- `src/ui/theme/themes.ts`: day hotbar slots are dark oak (`oak-bark` 0/3/4), not neutral grey (M2-07
  review N8; a grey 9-slot strip echoes another game's hotbar).

The first minute (priority 2)

- **N1 hotbar** (`src/modes/mine/logic.ts`, `mine.ts`, `loot-fly.ts`): the first nine kinds found
  keep slots 0–8 for the whole lesson. A tenth or later kind gets `NO_SLOT`: its icon flies to just
  past the hotbar's right end and shrinks away, the pop still plays, its count goes into the loot,
  and Results lists it. **Why this choice:** a slot never changes kind, so a child never sees their
  stack "turn into" another block. "Keep the most recent" or "most plentiful" would both still swap
  an icon under the child. Grouping by kind would merge e.g. glass into a "dirt" count, which reads
  as wrong.
- **N2 "the block"** (`src/i18n/en/mine.ts`): a centred block doesn't fit. At 1280×720 the Sprout
  stage between the word plate and the keyboard (with hands) is about 90 px tall, and the centred
  case of `stageFrame` needs about 230 px. Getting there would mean dropping the number row or
  shrinking the hands and the letter plate, which is M2-09/M2-14's layout and would retune
  `hud.spec`'s 1024×720 scale-2 fit. So the hint changed instead: "Type **this letter** to break
  **the block**!". "This letter" is the big letter on the plate right above the hint, and "the
  block" is the thing that breaks. The old "Type the letter on the block!" sent eyes to the plate,
  which looks like a block. The HUD layout is unchanged, so the `hud.spec` fit test still passes
  locally.
- **N3 "+1"** (`view.ts` `StageView.labelAt`, `mine.ts`): float labels sit beside the block, on the
  side toward the middle of the screen and scaled by the block's on-screen fit, so they never sit
  in the column the next block drops into.
- **Flowers** (`src/render/atlas/painters.ts`, `src/content/blocks/flora.ts`): new `flowers-top` and
  `flowers-side` painters: a grass bed with five-pixel blossoms and a gold middle (orange on yellow
  flowers), and stems with heads on the sides. The bottom is dirt. They no longer read as berry
  bushes.
- **Leaves** (`src/render/atlas/palettes.ts`): the `leaf` ramp is a step warmer and lighter (hue
  about 105°, was 120°).
- **Overview framing** (`src/render/camera.ts`): zoom 0.74 (was 0.7), aim nudged toward the near
  edge (`OVERVIEW_AIM`), so the slab sits in the middle with its near corner clear of the frame.
- **Fence and front lawn** (`src/content/worldgen/diorama.ts`): the fence stands 8 cells past the
  clear stage (was 3) and ends 5 cells behind the target (was 2), so no post fills the side of the
  Mine view. Two flower patches go on each front corner of the lawn, from their own rng fork.
  Pinned grid hashes updated.

Sky (M2-02 review)

- **Dawn vs dusk** (`src/content/biomes/meadow.ts`): ground stops are peach at dawn (`#efc9a4`) and
  rose-violet at dusk (`#8c5c86`).
- **Overview backdrop** (`src/render/sky.ts`): below the horizon the dome blends to the ground stop
  over `smoothstep(0, 0.9)` (was 0.35), so the overview's backdrop reads as the horizon the fog fades
  to.
- **Fog shows**: `fogFor(density, dist)` sets FogExp2 to `density × 3` for a camera within 25 of the
  diorama's middle (the Mine view: far terraces about a quarter hazed) and thins it in proportion
  further out (the overview: under a tenth at the near edge). It's set in the dome's
  `onBeforeRender`, which draws first. The env data and its type are unchanged.
- **Tests**: the dispose test now spies on `dispose` for the dome, the disc geometry and materials,
  both disc textures and the cloud geometry and material, and checks `moon-disc` is removed and the
  background stays null. The cross-fade e2e has a 15 s ceiling.
- **Pollen dropped**: `MEADOW_ENV.particle = null`. Nothing drew it, and a dozen specks over a 64×64
  island would barely show. The `AmbientParticle` type stays, so an ambient-particle card can bring
  it back for every biome.

Contrast and accessibility (priority 3)

- **High-contrast selected slot** (`themes.ts`): `selected` is `wool-blue` 4 (3.7:1 on the white
  slot outline and strip, 5.7:1 on black). A new unit test checks it against the slot outline it
  actually touches.
- **Night empty stars**: new `starEmptyEdge` ink token (`snow` 1 at night, `oak-bark` 2 by day,
  white in high contrast), used by `.star:not([data-earned]) .edge` and checked in `UI_PAIRS`
  against the panel.
- **HUD in high contrast** (M2-14): `textMuted` is `stone` 4 grey, not white, so typed and
  still-to-type letters differ by more than the cursor. It still clears 4.5:1 on its panel.
- **Toggle ✓/✕** (`Toggle.module.css`): the track is `--bevel-w + --bevel-unit` taller, so the
  knob's face holds the glyph inside the bevel at scale 1.
- **Toast announcing** (`src/ui/kit/announce.ts`, `Toast.tsx`): one persistent polite live region
  for the page, created empty on first use and filled 150 ms later, then cleared and refilled for
  each message. The toast stays an `<output>` (role status, findable by browsing) with
  `aria-live="off"`, so nothing is announced twice.
- **Locked button** (`Button.tsx`/`.module.css`): `aria-disabled` instead of `disabled`. It stays in
  the tab order, ignores clicks, blocks a form submit and never shows pressed. `ProfileCreate`'s
  save button gets the same behaviour.
- **Flat bevels** (`themes.ts`): darker shadow edges on day panels, toasts and buttons (`oak` 2/3),
  and a moonlit highlight on night panels (`ore-moon` 2). The ring stays one art pixel wide: a
  two-pixel ring changes `--bevel-w` and every layout that depends on it, too much for this card.

The rest

- **FX atlas swap** (`src/render/fx/index.ts`): if the atlas texture changes while chips are alive,
  the system drops them and clears the map, instead of drawing (and re-uploading) the texture the
  scene disposed. Their UVs point into the old atlas, so they can't switch over. Unit-tested.
- **N8** (`src/app/scene-host.ts`, `camera.ts`, `sky.ts`): no more monkey-patch. The camera rig
  exposes `drifting`, `SkyOptions.drift` may be a function the sky reads every frame, and the app
  passes `() => rig.drifting`. The camera already wakes the loop when drift turns on.
- **N6** (`docs/handoffs/M2-13.md`): the mine chunk is 50.2 KB gzip, not 27 KB (50.4 KB after this
  card). The note's idle claim is corrected for live play too (review N5).

## Acceptance

- [x] Each item fixed, or listed with a reason. All card items are fixed except: pollen, dropped
      (see Sky); the bevel ring width, colours only (see Flat bevels); the centred Sprout block, hint
      instead (see N2).
- [ ] Baselines regenerated through the Update snapshots workflow; visual + a11y review passes.
      Dispatched on this branch after opening the PR; the review is the orchestrator's.
- `npm run verify`: exit 0 (2790 tests; all bundle budgets met).
- `npm run e2e` locally (one worker, port 4393, screenshots skipped off CI): 58 passed.

Expected baseline changes: `diorama` (both), `sky` (all 8), `scene`, `hello-voxel`, `atlas` (leaf
ramp, flower tiles), `ui-kit` (all 3), `hud` (all 3: slots, bevels, contrast muted), `keyboard`
contrast (selected ring colour). M2-15's slice baselines will change too if it lands first.

### Screenshots for the reviewer (local SwiftShader, 1280×720, test build)

Before (`origin/main` at `4501070`):
`C:\Users\bill\AppData\Local\Temp\claude\dc77606e89cacb55\600ea18c-8655-4b79-ad66-7a299f458c52\scratchpad\before\`

After (this branch):
`C:\Users\bill\AppData\Local\Temp\claude\dc77606e89cacb55\600ea18c-8655-4b79-ad66-7a299f458c52\scratchpad\after\`

Both folders hold `overview.png`, `diorama-mine.png`, `mine-sprout-start.png` (meadow-01, fresh
Sprout), `mine-sprout-start-1024.png` (1024×720), `mine-sprout-break.png` (250 ms after the first
break: "+1"), `mine-sprout-20.png` (after 20 blocks: hotbar), `mine-miner-start.png` (meadow-05),
`results-sprout.png` and `results-miner.png`. After only: `profiles.png` (new avatar) and
`ui-kit-{day,night,contrast}.png`.

## Decisions

- Hotbar: the first nine kinds keep their slots; later kinds count but take no slot (reason above).
- Sprout start hint: "Type this letter to break the block!". No HUD layout change.
- Sleeve purple with a mustard cuff. Default avatar: a rounded head with an auburn side fringe and a
  leaf.
- Day hotbar slots are dark oak.
- Fog strength scales with camera distance (`fogFor`, `FOG_BOOST` 3, `FOG_NEAR_DIST` 25), so the
  env data stays as it is.
- Meadow pollen dropped until an ambient-particle system exists.
- Disabled kit buttons use `aria-disabled` and stay focusable.
- Toasts announce through one persistent live region (`announce.ts`).

## New dependencies

- None.

## Notes for downstream tasks

- `StageView.labelAt(i, out)` gives float-label spots beside the block; `CameraRigCore.drifting` is
  new; `SkyOptions.drift` accepts `() => boolean`.
- `slotOf` returns `NO_SLOT` (−1) after nine kinds; `Flight.slot` can be `NO_SLOT`.
- Kit toasts are no longer live regions themselves; tests that read the announcement should read
  `#vt-announcer` after `FIRST_ANNOUNCE_MS`.
- `Button disabled` keeps focus and the tab order (`aria-disabled`). Code that checks
  `button.disabled` won't see it (`src/ui/screens/nav.ts` no longer skips such buttons, on purpose).
- `tests/unit/ui/screens/screens.test.tsx` "stars fill one by one" is a wall-clock test that flakes
  under load. It failed once on unchanged `origin/main` here too.
- Owner question carried over from M2-13: about 14 loot kinds per Sprout lesson is a lot for a
  6-year-old; consider trimming the Meadow loot table's variety.

## Contract change request / Questions

- (none)

Closes #139
