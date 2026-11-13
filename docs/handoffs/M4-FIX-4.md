# M4-FIX-4 Night Defense layout on short screens

Status: done

From the M4 gate's visual review. At 1024×600 the keyboard took about 45 % of the screen, the
field was about 100 px tall (60 px at text scale 2), mobs were 20–30 px, and plates covered them.
Mobs were dark on the dark night lanes, the hotbar's count badges covered its icons at text scale 2,
the empty hotbar read like a well-known game's HUD, and the dusk banner faded in slowly.

## What changed

- **The field gets its room (item 1).**
  - `src/modes/defense/logic.ts` (pure): `stageFloor(viewH, textScale)` is the stage height a night
    asks of the HUD. It is the message's room, plus a far plate's room, plus `FIELD_MIN_PX` (170 px)
    of field, and never under 40 % of the screen (`STAGE_MIN_SHARE`). `stageRoom` sizes both rooms
    from the real fonts, which a short screen caps (`plateFontPx`: `min(22px × scale, 5.4dvh)`;
    `messageFontPx`: `min(20px × scale, 3.6dvh)`). At text scale 2 on a 600 px screen the room is
    about 130 px; it used to be `2 × (46 + 56)` = 204 px. `BANNER_ROOM` and `PLATE_ROOM` moved here
    from `defense.ts`.
  - `src/ui/hud/bridge.ts`: a new `stage` custom slice, `{ minPx }`, read by `stageMinOf`.
  - `src/ui/hud/Hud.tsx`: a new `HudStage` part. It reads only the slice and sets `data-min` and
    `--stage-min` on the stage.
  - `src/ui/hud/Hud.module.css`: with a floor, the stage row holds `min(--stage-min, 55dvh)`. The
    keyboard row is `minmax(0, <its usual height>)`, and the keyboard fills it. The key unit already
    follows the row's height (`--keyboard-max-unit`), so the keys shrink, and the next-key ring, the
    lit key's finger label and the hint line all stay. Without the slice nothing changes (Mine,
    Builder, the HUD baselines).
  - `src/ui/keyboard/OnScreenKeyboard.module.css`: in a short keyboard row (keys under about 34 px),
    only the lit keys keep their finger label. At 27 px a Sprout's "pointer" labels ran into each
    other. The hint line under the keys ("Use your left ring finger.") still names the finger.
    This is a height container query on the HUD's keyboard row, so the keyboard previews and every
    taller row are unchanged.
  - `src/modes/defense/defense.ts`: `relayout` works out the floor and sends the slice when it
    changes, then frames the field again 3 frames later, once the HUD has re-rendered
    (`fitLaneView`, with the real plate room). Sprout nights still hide the drawn hands (decision
    106); the hint line stays.
- **Mobs read at night (item 2).** `src/modes/defense/view.ts`: an emissive lift. The mobs'
  material (one per type) gets a small shader patch, `totalEmissiveRadiance *= diffuseColor.rgb`, so
  its emissive adds a share of the mob's own colour (texture, vertex colour and tint) and never a
  flat glow. `setGlow` drives it with the camp's glow: none by day, `NIGHT_LIFT` (0.25) at night,
  half at dusk. The lanes don't get it, so the mobs stand out from them. It wraps the model
  runtime's own shader patch (`patchModelShader`), and like that patch it throws if three.js
  renames its chunk. It adds no draw call and no light, and it doesn't touch the shadows.
- **Badges (item 3).** `src/ui/kit/Slot.module.css`: a badge's font stops at `--slot-badge-max`
  when a row sets it. `Hud.module.css`'s top row sets it to 30 % of the slot (19 px in a 64 px
  slot; it was 32 px at text scale 2). Results and the inventory set no cap, so nothing changes
  there.
- **The empty hotbar (item 4).** `HotbarSlice.hideEmpty` (bridge). With it, `HudCombo` hides the
  bar while every slot is empty and no combo slot is lit. It uses `visibility: hidden`, so the bar
  keeps its room, the stage doesn't move and the camera doesn't re-frame when the first block lands.
  Defense publishes its (empty) hotbar with the flag when the night starts. The bar shows with the
  first lit combo slot or the first block, and stays through dawn. Results draws its own loot and
  is unchanged.
- **The dusk banner (item 5).** `Hud.module.css`: a message over the stage pops in over 90 ms
  (`--t-fast`, 2 steps) from 40 % opacity, instead of the kit Toast's 200 ms fade from nothing.
  Under reduced motion it is instant (`--motion-ok` is 0). A message the flash guard held back
  (`data-still`, `allowFlash()`) still has no animation. This applies to every HUD message (Mine's
  too).
- **For the e2e.** `plates.ts`: each plate carries its mob's head and feet on the page as
  `data-mob="x head feet"`. It is written only when they move a whole pixel. `view.headOf` fills
  `feet` when the caller passes it.
- Tests:
  - `tests/unit/modes/defense/logic.test.ts`: a new "short screens" block. It covers the rooms, a
    check that the font formulas match the CSS and `plates.ts`, the floor at five heights and four
    scales, and a pure framing check: every band at 1024×600 and scale 1–2 draws a far mob at least
    44 px tall, with the plate's room above it.
  - `tests/unit/dom/defense-view.test.ts`: the feet; the lift (one material per type, the program
    key, the emissive following `setGlow`, the patch on three's own Lambert shader, and the
    runtime's `vtTex` patch kept under it); the patch failing loudly; and the plate's `data-mob`.
    The draw-call test is unchanged and passes (85, 86, 87).
  - `tests/unit/ui/hud.test.tsx`: the `stage` slice, `hideEmpty` (hidden, then shown by a lit slot
    or an item, and an empty bar without the flag still shows), and stylesheet checks for the floor,
    the message's pop and the badge cap.
  - `tests/e2e/defense-short.spec.ts` (new): at 1024×600, for text scale 1, 1.25 and 2 (Miner) and
    1.5 (Sprout). It checks the stage is ≥ 40 % of the screen, the hotbar is hidden during the day
    and the dusk banner pops in within 100 ms. It then measures every mob on the field: the smallest
    must be ≥ 46 px tall, no plate may come down past its own mob's head, and a key must still be
    lit. A screenshot of each is attached, not compared.
  - `tests/fixtures/profiles/small-text-miner.json` (new): a copy of `meadow-done-miner` at text
    scale 1. The other Miner fixtures are at 1.25 and 2.

## Acceptance

- [x] **Field ≥ about 40 % of the stage; a compact keyboard below that; the camera pulled in
      (`fitLaneView`).** `defense-short.spec.ts`. Measured locally at 1024×600 (one worker, port
      4543):

  | Profile (text scale)     | Stage, before → after | Smallest mob, before → after | Plate past its mob's head, before → after |
  | ------------------------ | --------------------: | ---------------------------: | ----------------------------------------: |
  | small-text-miner (1)     |           46 % → 46 % |                   54 → 54 px |                        −6 → −6 px (clear) |
  | meadow-done-miner (1.25) |           37 % → 48 % |                   37 → 54 px |                        −6 → −6 px (clear) |
  | fresh-sprout (1.5)       |           43 % → 50 % |                   42 → 53 px |                        −6 → −6 px (clear) |
  | voice-miner (2)          |           29 % → 50 % |                   29 → 54 px |                     +13 (covered) → −6 px |

- [x] **E2E measures mob height at 1024×600, text scale 1 and 2 (≥ about 48 px), with no plate
      covering its own mob.** As above. It passes at ≥ 46 px, and every case measures 53–55 px.
- [x] **Mobs not dark on the night lanes.** The emissive lift. It is subtle, works with root-only
      shadows and instanced mobs, and costs no draw call (`defense-view.test.ts`).
- [x] **Hotbar badges don't cover the icons at text scale 2.** They are capped at 30 % of the slot
      (`hud.test.tsx` stylesheet check).
- [x] **The empty hotbar is hidden during the day.** `hideEmpty`. The loot display at dawn and on
      Results is unchanged (`hud.test.tsx`; the e2e checks the day).
- [x] **A shorter dusk-banner fade; instant under reduced motion.** 90 ms from 40 % opacity
      (`hud.test.tsx`, `defense-short.spec.ts`).
- [x] Accessibility: reduced motion (instant pop, no new motion), `allowFlash()` (unchanged: a
      held-back message has no pop), text scale (the sizes follow it, capped by the screen), high
      contrast (no new colours; the lift scales the mob's own colours). Plates stay below the HUD
      message: `clearOfBanner` and its cache are unchanged, and the plate room now matches the real
      font.
- [x] `npm run verify` passes.
- [x] No new screenshot baselines. A night runs on real time, so its pictures are attached, not
      compared. If CI finds a changed HUD baseline, it is remade by the Update snapshots workflow.

## Decisions

- **The floor comes from the field, not a fixed share.** The stage asks for message room, plate
  room and 170 px of field, never under 40 %, and the HUD caps it at 55 %. A plain 40 % was not
  enough at text scale 2: the message and plate room alone took about 130 px of the 240.
- **The keys shrink; the drawn hands stay hidden only on nights (decision 106).** At 1024×600 the
  key unit is about 34 px at scale 1.25, 32 px at scale 2 and 27 px for a Sprout (it was 35–50 px).
  At 1280×720 the floor doesn't bind for Miner and Sprout, so nothing changes there. The lit key,
  its ring, its finger label and the hint line stay at every size.
- **Labels only on the lit key in a short row.** At 27 px a label on every key ran into its
  neighbours. Hiding them there keeps the finger information (the lit key and the hint line) in a
  form that can be read.
- **Emissive lift, not a light or lighter lanes.** A light would light the lanes too and lose the
  contrast. A lift of the mob's own colour keeps its look and costs nothing.
- **The hotbar hides in place** (`visibility`), so the first block never moves the stage or the
  camera.
- **The message pop is shorter in every mode.** It is one HUD part, and a slow fade reads the same
  everywhere.

## New dependencies

- None.

## Notes for downstream tasks

- **Any mode can ask for a stage floor** with `custom.stage = { minPx }` (`STAGE_SLICE`). The HUD
  shrinks the keyboard to fit and caps the floor at 55 % of the screen. The M5 bosses' `minions`
  phase can use it.
- **`HotbarSlice.hideEmpty`** is optional; Mine and Builder don't send it.
- **`data-mob` on plates** is for tests: `x head feet`, in page pixels.
- The HUD message's and the plates' font formulas are repeated in `logic.ts` (`messageFontPx`,
  `plateFontPx`). A test fails if the CSS or `plates.ts` changes without them.

## Contract change request / Questions

- No frozen contract changes. `HudState.custom` is mode-specific by design (contracts §10); the
  `stage` slice and `hideEmpty` are additive, like M4-04's `hands` slice. The orchestrator may log
  them with decision 106.
- **"May touch" files outside the mode:** `src/ui/hud/{bridge.ts,Hud.tsx,Hud.module.css}` (M2-14),
  `src/ui/kit/Slot.module.css` (M2-07, one line), `src/ui/keyboard/OnScreenKeyboard.module.css`
  (M2-09, the short-row labels). Each change is opt-in or scoped, as described above.

Closes #208
