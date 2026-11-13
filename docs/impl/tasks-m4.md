# Tasks: M4 Night Defense + Home Island Builder

**Goal:** the speed/target-switching mode and the creative reward loop. Kids earn blocks in Mine and Defense and spend them building their island.

Field legend: see the top of `tasks-m0-m1.md`.

---

### M4-01 Voxel model runtime
- **Size/Tier:** M / A · **Review:** required
- **Depends on:** M2-01, M1-14
- **PLAN refs:** §5.1 (block-based characters)
- **Owns:** `src/render/models/*.ts`, `src/render/models/schema.json`, `tests/unit/models/*.test.ts`
- **Spec:** `contracts.md` §8.4. `buildModel(def, atlas) → { root: THREE.Group, play(anim, opts), update(dt), setTint(color), dispose() }`. Part hierarchy by `parent`, pivots honored. Animation: per-track linear interpolation between keys, `loop` or clamp, crossfade 120 ms between anims, `onEnd` callback. Geometry per part is a box with per-face atlas UVs or flat color; parts of the same model share a material. For many identical mobs, `buildModelInstanced(def, count)` uses one `InstancedMesh` per part (keeps draw calls ≤ parts × types). JSON schema validation test for every `*.model.json` in the repo.
- **Acceptance:**
  - [ ] 30 identical mobs on screen add ≤ (parts count) draw calls.
  - [ ] Interpolation and crossfade unit tests.

### M4-02 Model Lab (dev page)
- **Size/Tier:** S / C · **Review:** optional
- **Depends on:** M4-01
- **PLAN refs:** §5.1
- **Owns:** `lab.html`, `src/dev/model-lab.tsx`
- **Spec:** Dev-only page listing every model; orbit camera; buttons for each animation; time scrubber; background toggle (day/night); "copy screenshot". Excluded from the prod build.
- **Acceptance:**
  - [ ] Opens every model without console errors (e2e loops over the list).

### M4-03 Mobs, wave 1 (8 creatures)
- **Size/Tier:** L / A · **Review:** required (visual + IP)
- **Depends on:** M4-01, M4-02
- **PLAN refs:** §7.3, §1 (IP)
- **Owns:** `src/content/mobs/{slimeling,moss-golem,cave-bat,frost-pup,cactus-cat,lantern-fish,crystal-crab,sandstorm-imp}.{model.json,ts}`, `src/content/mobs/ambient-chicken.*` (decorative, Meadow), `src/i18n/en/mobs.ts`
- **Spec:** Each mob: model (6–14 parts), `idle`, `walk`, `hit`, `defeat` animations, a home biome, a **word flavor** (pool tag, e.g. Frost Pup carries `theme=cold` words), a speed class (slow/medium/fast), and a friendly defeat (poofs into sparkles and a block drop; nothing violent). Designs are cute, round-edged-in-spirit, clearly not any existing game's mobs. Reviewer checks each against the IP rule.
- **Acceptance:**
  - [ ] Screenshots of each mob in Model Lab; visual + IP review passes.

### M4-04 Night Defense mode
- **Size/Tier:** L / A · **Review:** required (feel)
- **Depends on:** M4-03, M4-05, M2-13 (patterns), M2-02 (night), M3-03 (lesson data can reference `defense`)
- **PLAN refs:** §3.2.2, §3.4
- **Owns:** `src/modes/defense/**` (except `director.ts`), `src/content/worldgen/defense-arena.ts`, `src/i18n/en/defense.ts`, `tests/unit/modes/defense/*.test.ts`
- **Spec:**
  - Flow: short **day** phase (10 s, shows the base and a "Night is coming!" banner) → **dusk** wave announcement ("3 slimelings are on the way!") → **night** waves → **dawn** (sun rises, results). No game over.
  - Arena: a small base (the player's lantern-lit camp) at the front, 3–5 lanes (Sprout 2–3) stretching to the horizon, camera `lane` preset. Night lighting with lanterns as point lights (quality-capped).
  - Mobs walk lanes carrying words shown as DOM plates above their heads (projected; occlusion-free; plates never overlap: a small layout pass nudges them vertically). Engine: `lockOn` targeting; `priority` = distance to the base so the closest wins ties. Locked mob plate gets a bright frame; typed chars mark on the plate.
  - Completing a word: mob `defeat` anim, `pop` SFX, sparkles, a block drop that flies to the hotbar.
  - Mob reaching the base: it "bonks" the shield (soft `shield` SFX, shield bar drops a segment, mob poofs). Shield at zero: mobs just bounce off harmlessly until dawn (a friendly "The shield needs a rest! Keep going!" banner). **Nothing is lost.** Shield regenerates at dawn.
  - Calm mode: mobs stop at a "waiting line" short of the base and wait until typed.
  - Results: mobs popped, best streak, loot; stars by accuracy (speed targets only for Builder with `wpmRelative`).
- **Acceptance:**
  - [ ] Unit: no code path removes inventory or progress (M4-10 property test also covers it).
  - [ ] Plates never overlap (layout unit test on random positions).
  - [ ] Feel review with screenshots/recording (dusk banner, mid-wave with lock, dawn).

### M4-05 Wave director (pure)
- **Size/Tier:** M / A · **Review:** required
- **Depends on:** M1-04, M1-06, M1-07
- **PLAN refs:** §3.2.2 (waves scale to WPM), §8 Phase 4 accept
- **Owns:** `src/modes/defense/director.ts` (pure zone — add it to the purity overrides in `.oxlintrc.json` and `tools/check-boundaries.ts` in the same PR), `tests/unit/modes/defense/director.test.ts`, `tools/sim-defense.ts`, `docs/sim.md` (append)
- **Spec:** `createDirector({ band, baselineNetWpm, calm, rng }) → { nextWave(): WaveSpec; observe(feedback: { accuracy, reachedBase, wordsDone, activeMs }): void }`. WaveSpec = list of `{ mobId, lane, spawnAtMs, speed, word }`. Controller adjusts spawn interval and mob speed to keep measured accuracy in **85–95%** and "reached base" fraction ≤ 20%: proportional step on a difficulty scalar `d ∈ [0.3, 2.0]`, bounded change per wave (±15%). Initial difficulty from baseline WPM (and a conservative default for new profiles). Words come from the generator with the mob's flavor pool, filtered to the learner's allowed keys.
- **Acceptance:**
  - [ ] `tools/sim-defense.ts`: synthetic typists at 10, 25 and 50 WPM converge to accuracy 85–95% within 4 waves and stay there (median over 50 seeds). Evidence in `docs/sim.md`.
  - [ ] Pure, deterministic for a seed.

### M4-06 Island data and persistence
- **Size/Tier:** S / B · **Review:** required (data)
- **Depends on:** M1-09, M1-13
- **PLAN refs:** §3.1 (48×48×32, grows), §6.6
- **Owns:** `src/engine/island.ts` (pure), `tests/unit/engine/island.test.ts`; requests `Profile.island` shape confirmation from the orchestrator
- **Spec:** Island starts as a 24×16×24 meadow plot (generated from the meadow worldgen at small size, seeded by profile id) inside a 48×32×48 max grid. Expansions (one per completed biome) add 8-wide rings with that biome's starter terrain. Edits are a command log applied to the grid: `{ kind: 'place' | 'remove' | 'stamp', ... }` with undo up to 50 steps (kept in memory only). Placing consumes inventory; removing refunds it (the island is a safe place; nothing destroys blocks permanently). Save = `VoxelGrid.toJSON()`.
- **Acceptance:**
  - [ ] Save/load round-trips exactly (property test with random edit sequences).
  - [ ] Inventory is conserved: `inventory + blocks on island` constant across any place/remove/undo sequence (property test).

### M4-07 Builder mode
- **Size/Tier:** L / A · **Review:** required (feel + pedagogy)
- **Depends on:** M4-06, M2-13, M2-14
- **PLAN refs:** §3.2.4
- **Owns:** `src/modes/builder/**`, `src/i18n/en/builder.ts`, `tests/unit/modes/builder/*.test.ts`
- **Spec:**
  - Command parser (pure, `src/modes/builder/commands.ts`): the HUD shows a command line. Typing builds a command; commands **auto-run** when the typed text exactly matches a known command and no longer command shares that prefix, otherwise Space or Enter runs it. Commands: any block `typedName` (arms that block), `put` / `dig` (or Space with an empty command line = put armed block at the cursor), blueprint names (`house`, `tower`, …; stamps at the cursor if inventory allows, else shows what's missing), `up`/`down`/`north`/`south`/`east`/`west` + optional number (`east 3`) to move the cursor, `undo`. Sprout band gets a picture palette (`KeyCap` chips showing the first letters of the 6 most-owned blocks) so they type 3-letter names.
  - Arrow keys move the cursor (convenience), PageUp/PageDown change layer. Backspace edits the command line; with an empty line it undoes. `Ctrl+Z` undoes.
  - Typing in Builder records a practice session (`mode: 'builder'`, `end: manual`, no stars) so the words still count toward key stats.
  - Cursor: a pulsing wireframe cube + a ghost of the armed block. Camera `orbit` preset; `[` `]` rotate, `-` `=` zoom (when the command line is empty).
  - Autosave every 30 s and on exit.
- **Acceptance:**
  - [ ] Parser table tests (prefix ambiguity, numbers, unknown words give a gentle hint, never an error).
  - [ ] E2E: type `oak`, `put`, `east 2`, `put`, `undo` and assert the island grid and inventory.

### M4-08 Blueprints, expansion, orbit, PNG snapshot
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M4-07
- **PLAN refs:** §3.2.4, §3.3
- **Owns:** `src/content/blueprints/*.ts`, `src/modes/builder/snapshot.ts`, `src/i18n/en/blueprints.ts`, `tests/unit/content/blueprints.test.ts`
- **Spec:** 10 blueprints (house, tower, bridge, garden, well, lantern-post, farm, boat, statue, castle-gate), each a small `VoxelGrid` + a block cost list + an unlock condition (biome completion or achievements). Snapshot: renders the island at 2× from the current camera with UI hidden, downloads `my-island-<date>.png` (local only). Expansion ceremony when a biome is completed (camera sweep, new ring appears; reduced-motion = instant).
- **Acceptance:**
  - [ ] Every blueprint fits within the island bounds and only uses existing blocks (test).

### M4-09 Inventory and loot screens
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M2-07, M2-04
- **PLAN refs:** §3.3
- **Owns:** `src/ui/screens/Inventory.tsx`, `src/ui/components/BlockIcon.tsx` (isometric block icon rendered once per block to a cached data-URI from the atlas), `src/i18n/en/inventory.ts`
- **Spec:** Grid of owned blocks with counts and rarity frames, filter by biome/tag, details panel with the block's name and where it's found. Keyboard grid navigation. Unknown blocks shown as "?" silhouettes (collection goal).
- **Acceptance:**
  - [ ] Keyboard navigation test; axe clean.

### M4-10 No-failure invariants and M4 E2E
- **Size/Tier:** M / B · **Review:** optional · **E2E:** yes
- **Depends on:** M4-04, M4-07, M4-08, M4-09
- **PLAN refs:** §1 pillar 2, §8 Phase 4 accept
- **Owns:** `tests/unit/invariants/*.test.ts`, `tests/e2e/m4/*.spec.ts`
- **Spec:** Property test across Mine, Defense and Builder result application: for any `ModeResult` and any key stream, the profile's inventory, unlocked biomes and lesson best-stars never decrease (except Builder placing blocks, which moves them to the island and is reversible). E2E: a Defense night on a Miner fixture with `typeLikeAKid` at 15 WPM finishes at dawn; Builder session places a blueprint and the island persists after reload; inventory screen shows the loot.
- **Acceptance:**
  - [ ] All green twice.

### M4-FIX-1 Builder: digging keeps every block, plus leftovers
- **Size/Tier:** S / B · **Review:** required (no-failure rule)
- **Depends on:** M4-07
- **Owns:** `src/modes/builder/*`, `src/engine/island.ts`, their tests
- **Spec:**
  - **Dig loses blocks (owner playtest, 2026-11-12, no-failure rule):** on My Island, typing `dig`
    on a block the player had none of (grass, when they only had dirt) removed it, and it never
    showed up anywhere. `island.ts` says starter terrain refunds to the inventory. Find where it is
    lost: the refund delta, the hotbar filter, the inventory write-back or the save. Fix it, so
    every dug block shows in the hotbar and in the inventory, and survives a reload. If a block
    can't go in the inventory (it isn't a placeable block), refund the block it drops instead, as
    grass drops dirt, and say so in the hint.
  - **From the M4-07 review:**
    - Make the habit window depend on the band. 1.5 s may be too short for slow Sprouts.
    - `plank` followed by `o` drops the `k`.
    - The cursor outline is too thin.
    - Tooltips should also open on focus and on touch.
    - Fix the "Three sliders" comment.
    - Add a baseline for the narrow map corner.
  - The owner's answers on Sprout words, damaged-island reset and the `veteran-builder` fixture
    are added here when they arrive.
- **Acceptance:**
  - [ ] A property test: for any sequence of put, dig and undo, the island blocks plus the inventory
    always add up to the starting totals, counted per block, after a save and reload.
  - [ ] An e2e: dig grass with zero grass in the inventory, and grass (or its drop) appears in the
    hotbar.

### M4-FIX-2 Night Defense pacing and leftovers
- **Size/Tier:** S / B · **Review:** required (feel)
- **Depends on:** M4-04, M4-05
- **Owns:** `src/modes/defense/*`, their tests and sims
- **Spec:**
  - **Pacing (owner playtest, 2026-11-12):** mobs come too slowly, even for kids. There should never
    be more than about 2–3 s of empty field. Measure the empty time: no mob visible and walking, and
    no word left to type. When the field empties, bring the next spawn forward, so the gap is at most
    `maxIdleMs` (start at 2,500 ms, the same for every band). Fewer mobs for a slow learner still
    comes from the speed and the count, never from long empty waits. Keep the existing convergence
    targets (the 50 WPM pin, mean in 90–97 %) passing, or retune and report the new numbers.
  - The slow typists' dips are pinned at 25 %. Check that this still holds after the pacing change.
  - Crash memory was removed. Check that nothing else depended on it.
- **Acceptance:**
  - [ ] A sim test: across bands and 5–60 WPM typists, no stretch of empty field is longer than
    `maxIdleMs` + 250 ms, except the dawn ending.
  - [ ] The existing director tests pass, or the handoff explains each retuned number.

### M4-FIX-3 Night Defense for 5 WPM learners
- **Size/Tier:** S / B · **Review:** required (feel)
- **Depends on:** M4-FIX-2
- **Owns:** `src/modes/defense/director.ts`, `tools/sim-defense.ts`, their tests, `docs/sim.md`
- **Spec:** from the M4-FIX-2 handoff and review (#188). 5 WPM learners struggle: 37–52 % of their
  waves fall under 85 %, and 46 % of a brand-new Builder's waves are swamped. The 10 WPM pin
  (≤ 25 % of waves under 85 %) has little headroom (26.7 % for Miner in a 30-learner run).
  Tune the director's low end (speed floor, counts, calm pace) so a 5 WPM learner feels capable.
  Keep `maxIdleMs` (decision 103): fewer mobs, slower walking, never long empty waits.
  Also from the #188 review:
  - Cache the per-frame banner rect used by `clearOfBanner`.
  - Update the night e2e budget comment (3.9 min on CI).
  - Calm mode's "wave was slow" signal is now tied to the idle pull; check it.
- **Acceptance:**
  - [ ] Pin 5 WPM: at most 30 % of waves under 85 % and no swamped waves for any band, new
    profile included. 10 WPM keeps ≤ 25 % with headroom across 3 seeds of 100 learners.
  - [ ] The 50 WPM pin and the idle cap still pass.

### M4-GATE
`PLAN.md` Phase 4 acceptance (no-failure verified, wave convergence, island round-trip) + visual review of Defense and Builder. Tag `m4`.
