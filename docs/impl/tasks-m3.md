# Tasks: M3 Curriculum, adaptation and meta

**Goal:** biomes 1–4 fully playable (in Mine mode, with bosses as mastery checks until M5), world map, placement test, remedial lessons, settings and accessibility, multiple profiles, achievements v1, Parent Dashboard v1, save migrations and import/export.

Field legend: see the top of `tasks-m0-m1.md`.

---

### M3-01 Curriculum validator and doc generator
- **Size/Tier:** S / B · **Review:** optional
- **Depends on:** M1-06, M2-12
- **PLAN refs:** §4.2, §7.2
- **Owns:** `tools/validate-curriculum.ts`, `tools/gen-curriculum-doc.ts`, `docs/curriculum.md` (generated), `tests/unit/content/curriculum.test.ts`
- **Spec:** Validates all lessons: unique ids, contiguous `order` per biome, id matches `<biome>-<order>`, every `newKeys` char introduced exactly once across the curriculum, `reviewKeys ⊆ allowed`, each lesson generates ≥ 20 distinct targets over 10 seeds **for every band** using only allowed keys, word-kind lessons draw ≥ 70% real words (not syllable fallback), every biome has exactly one `mastery` lesson and it is last (or second-to-last before `boss`), title keys exist. Doc generator writes a Markdown table per biome (id, title, new keys, kind, mode, targets, sample output for seed 1). `npm test` runs the validator; CI fails if `docs/curriculum.md` is stale (regenerate and diff).
- **Acceptance:**
  - [ ] Fails on fixtures for each rule. Passes on Meadow 1–6.

### M3-02 Word lists for biomes 1–4
- **Size/Tier:** L / A · **Review:** required (child safety + reading level)
- **Depends on:** M1-10 (may start before M2-GATE; `task-graph.md` rule 4)
- **PLAN refs:** §2, §7.1, `README.md` §8.4
- **Owns:** `src/content/wordlists/{meadow,birch,shore,frosty}-*.txt`, `src/content/wordlists/theme-*.txt` (blocks, animals, colors, food, tools, nature), `src/content/wordlists/pools.ts` (append), `src/content/wordlists/SOURCES.md` (append)
- **Spec:**
  - Key sets (cumulative): Meadow `a s d f j k l ; g h`; Birch + `e i r u t y o w q p` (introduced in that order); Shore + `c n v m b x z`; Frosty = full a–z consolidation.
  - For each biome × band: word pools sized Sprout ≥ 60, Miner ≥ 120, Builder ≥ 200 (where the key set allows; record shortfalls for Meadow). Phrases (2–4 words) for Miner/Builder from Birch on. Reading-level tags: Sprout `dolch`/`cvc`/`grade1`, Miner up to `grade4`, Builder up to `grade6+`.
  - Themed lists give flavor: Birch (trees, birds, forest), Shore (sand, waves, crab, boat), Frosty (snow, ice, fox, cold).
  - Authored by the worker or taken from public-domain sources; provenance per file in `SOURCES.md`. No copied commercial lists.
  - Run the validator; also produce `docs/review/wordlists-m3.txt` (a flat dump, one word per line with pool id) for the owner's human review (👤 at M6).
- **Acceptance:**
  - [ ] Validator clean. Pool size targets met or shortfalls recorded with reason.
  - [ ] Reviewer spot-checks 100 random Sprout words for readability and safety.

### M3-03 Lessons for biomes 1–4
- **Size/Tier:** M / A · **Review:** required (pedagogy)
- **Depends on:** M3-01, M3-02, M2-12
- **PLAN refs:** §4.1, §4.2, §7.2, `README.md` §8.3–8.4
- **Owns:** `src/content/lessons/{meadow,birch,shore,frosty}.ts`, `src/i18n/en/lessons-*.ts`
- **Spec:** Meadow 14 (01–06 exist; add 07–12 incl. `g h`, 13 mastery, 14 boss), Birch 15, Shore 14, Frosty 12. Pattern per new key pair: letters → syllables → words → review mix; every 4th lesson is a review; one `challenge-hide-keyboard` lesson per biome (optional, gives a cosmetic). Speed targets (`wpmRelative`) begin in Frosty (`PLAN.md` §4.1: after chapter 3), starting at 1.0 and rising to 1.15. Mastery lesson: 90 s, mixed content, accuracy target 0.9. Boss lesson: `mode: 'boss'`, `tags: ['boss']` (falls back to Mine until M5).
- **Acceptance:**
  - [ ] Curriculum validator clean; `docs/curriculum.md` regenerated.
  - [ ] Pedagogy reviewer approves the key introduction order and pacing.

### M3-04 World map
- **Size/Tier:** L / A · **Review:** required (visual + a11y)
- **Depends on:** M2-01, M2-03, M2-11
- **PLAN refs:** §3.1, §5.3
- **Owns:** `src/ui/screens/WorldMap.tsx`, `src/ui/screens/BiomePath.tsx`, `src/render/map/*.ts`, `src/content/worldgen/islands.ts`, `src/i18n/en/map.ts`, `tests/unit/ui/map.test.tsx`
- **Spec:** 3D overview of floating islands (small, cheap dioramas: ~16×12×16 per island, generated from biome palettes; locked islands shown desaturated with a gentle cloud cover). Keyboard: arrows/Tab move between unlocked islands, Enter opens the biome's lesson path (a node path drawn in DOM over the island, each node shows 0–3 stars, the next recommended lesson pulses). Remedial lesson nodes appear as a small "practice camp" node when suggested (M3-06). Screen-reader labels: "Birch Forest, 4 of 15 lessons done, 9 stars". In lite mode (M6) the same data renders flat.
- **Acceptance:**
  - [ ] Keyboard-only navigation e2e: map → island → lesson → play → results → back to map with the node updated.
  - [ ] Draw calls ≤ 120 on the map at Medium.
  - [ ] Visual review.

### M3-05 Placement test mode
- **Size/Tier:** M / B · **Review:** required (pedagogy)
- **Depends on:** M2-13
- **PLAN refs:** §3.2.8
- **Owns:** `src/modes/placement/**`, `src/engine/placement.ts`, `src/i18n/en/placement.ts`, `tests/unit/engine/placement.test.ts`
- **Spec:** Mine-mode reskin, 90 s, starts with home-row letters and expands the allowed set every time the learner gets 8 of the last 10 targets right (home row → top → bottom → words → capitals → numbers). `estimatePlacement(summary, progression) → { startBiome, keyBaseline: Record<string, KeyStat> }` is pure. Shown on first launch after profile creation with a clear **Skip** button (skip = start at Meadow). Unlocks biomes up to `startBiome` and marks earlier lessons as 1-star "tested out". Placement never puts a Sprout past Frosty.
- **Acceptance:**
  - [ ] Sim: slow typist ⇒ meadow; avg ⇒ birch/shore; fast ⇒ frosty or later (Builder only). Thresholds documented.

### M3-06 Remedial lessons, baselines and band defaults
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M1-05, M3-03
- **PLAN refs:** §4.3, §7.2, §2
- **Owns:** `src/engine/remedial.ts`, `src/app/recommend.ts`, `src/i18n/en/remedial.ts`, `tests/unit/engine/remedial.test.ts`
- **Spec:** After each session, if any allowed key has weight ≥ 4 and ≥ 30 attempts, suggest a remedial lesson: 60 s Mine, focus on the top-2 weak keys plus review, id `remedial-<hash of keys+session>`, never saved into the curriculum. Friendly framing by finger ("Your left pinky wants practice!"). `recommendNext(profile)` returns the next lesson to pulse on the map: due remedial (at most 1 per 3 sessions) → next unplayed → lowest-star lesson in the current biome. Band defaults for policy/lengths per `contracts.md` §6.
- **Acceptance:**
  - [ ] Pure tests for suggestion rules and rate limiting.

### M3-07 Accessibility features
- **Size/Tier:** M / B · **Review:** required (a11y)
- **Depends on:** M2-07, M2-08, M2-09, M2-14
- **PLAN refs:** §4.6
- **Owns:** `src/a11y/*.ts`, `src/ui/theme/high-contrast.css`, `src/ui/theme/motion.css`, `tests/unit/a11y/*.test.ts`
- **Spec:** Wire settings into the UI and render: text scale (`--text-scale`), fonts (`pixel`/`clean`/`dyslexic`), high contrast theme, reduced motion (`'system'` follows `prefers-reduced-motion`; disables shake, hit-stop, parallax, bob, water wobble, cloud drift, UI squash), flash guard (a global utility that refuses to schedule > 3 flashes/s), TTS on/off and `hearAgain`, colorblind patterns always on in the keyboard. Live region announcements for menu changes and lesson results (not per keystroke).
- **Acceptance:**
  - [ ] E2E with `prefers-reduced-motion: reduce` emulated: camera position identical before/after a block break (no shake).
  - [ ] Flash guard unit test.
  - [ ] Screen reader labels on all menu controls (axe + a manual checklist in the handoff note).

### M3-08 Settings screen and parent gate
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M2-11, M3-07
- **PLAN refs:** §4.4 (gate), §6.7, §4.6
- **Owns:** `src/ui/screens/Settings.tsx`, `src/ui/components/ParentGate.tsx`, `src/i18n/en/settings.ts`, `tests/unit/ui/settings.test.tsx`
- **Spec:** Tabs: Play (keyboard, hands, calm mode, break reminder), Look (text size with live preview, font, high contrast, reduced motion, quality), Sound (4 volume sliders, TTS), Grown-ups (behind gate: band change, delete profile, export/import, danger zone). Parent gate: shows a random word from a Builder-band list rendered as text ("Grown-ups: type the word **lantern** to continue"), 3 tries then a 30 s cool-down; it's a speed bump, not security (say so in `docs/decisions.md`). Changes apply live and save.
- **Acceptance:**
  - [ ] Every setting persists across reload (e2e).
  - [ ] Danger-zone actions require the gate (e2e).

### M3-09 Profiles (multi) and avatar
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M2-11, M1-09
- **PLAN refs:** §6.6 (8 profiles), §3.3 (skins)
- **Owns:** `src/ui/screens/Profiles.tsx` (extend), `src/ui/components/AvatarPreview.tsx`, `src/render/avatar.ts`, `src/content/cosmetics/base.ts`, `src/i18n/en/profiles.ts`
- **Spec:** Up to 8 profile cards with a small rendered voxel avatar (a static 3D render to an offscreen canvas snapshot, or a CSS pixel portrait in lite mode). Create, select, rename (gated), change band (gated), delete (gated + confirm by typing the nickname).
- **Acceptance:**
  - [ ] 9th profile creation is blocked with a friendly message.
  - [ ] Deleting a profile removes its `prev` record too.

### M3-10 Achievements framework and v1 set
- **Size/Tier:** M / B · **Review:** optional (copy review required)
- **Depends on:** M2-10
- **PLAN refs:** §3.3
- **Owns:** `src/engine/achievements.ts`, `src/content/achievements/{typing,progress,collect}.ts`, `src/ui/screens/Achievements.tsx`, `src/ui/components/AchievementToast.tsx`, `src/i18n/en/achievements.ts`, `tests/unit/engine/achievements.test.ts`
- **Spec:** An achievement = `{ id, nameKey, descKey, icon: BlockId | cosmetic, hidden?: boolean, check(ctx): boolean }` where `ctx` = profile + latest result + engine event aggregates. Evaluated after each session and (for streak-type ones) on bus events with debouncing. About 20 in v1: First Ore, Home Row Hero, No Mistakes Minute, Wrote a Whole Word, 100 Blocks, Pinky Power, Biome badges ×4, Early Bird (played before 9 am local, purely fun), etc. Never shaming, no "fail" achievements.
- **Acceptance:**
  - [ ] Each achievement has a test that unlocks it from a fixture and one that doesn't.

### M3-11 Parent Dashboard v1
- **Size/Tier:** L / B · **Review:** required (privacy, clarity)
- **Depends on:** M3-08, M1-04
- **PLAN refs:** §4.4
- **Owns:** `src/ui/screens/Parent.tsx`, `src/ui/charts/*.tsx` (hand-rolled SVG: line, bar, heatmap keyboard), `src/app/csv.ts`, `src/i18n/en/parent.ts`, `tests/unit/ui/charts.test.tsx`, `tests/unit/app/csv.test.ts`
- **Spec:** Behind the parent gate. Per profile: net WPM and accuracy over time (line, last 30 sessions + weekly aggregates), minutes practiced per day (bar, last 28 days), weak-keys heat map on the keyboard layout (error rate, color + numeric label), curriculum progress (stars per biome), top 5 weak bigrams for Builder. "Download CSV" exports sessions. Plain-language captions ("Higher is better", "Most kids grow 1–3 WPM per week of regular practice" only if we have a source; otherwise omit claims). No chart library dependency; follow the `dataviz` skill guidance if available.
- **Acceptance:**
  - [ ] Charts render correctly from the `veteran-builder` fixture (screenshot baseline) and handle an empty profile with friendly empty states.
  - [ ] CSV round-trips the visible numbers.

### M3-12 Migrations and import/export UI
- **Size/Tier:** S / B · **Review:** required (data loss)
- **Depends on:** M1-09, M3-08
- **PLAN refs:** §6.6
- **Owns:** `src/ui/components/ImportExport.tsx`, `src/i18n/en/importexport.ts`, `tests/e2e/import-export.spec.ts`; requests schema changes from the orchestrator if needed
- **Spec:** Export downloads `voxel-typer-<date>.json`; import via a file picker, shows the result summary. If the M3 tasks needed schema changes, the orchestrator bumps `schemaVersion` to 2 and writes migration 1→2 with fixture `v1.json` → expected `v2.json` (this card verifies it).
- **Acceptance:**
  - [ ] E2E: export from one browser context, import into a fresh one, profiles equal.

### M3-13 Progression simulation study
- **Size/Tier:** M / A · **Review:** required
- **Depends on:** M1-07, M3-03, M3-05, M3-06
- **PLAN refs:** §8 Phase 3 accept, §9.3
- **Owns:** `tools/sim-progression.ts`, `tools/sim/learner.ts`, `docs/sim.md` (append), `tests/unit/sim/progression.test.ts`
- **Spec:** A learner model whose per-key error rate and latency improve with practice (power-law learning curve per key: `err_k(n) = err0_k × (1 + n/τ)^−β`), plays the curriculum in recommended order with the real generator, stars, unlock and remedial logic. Report sessions-to-complete each biome for slow/avg/fast learners per band, star distributions, how often remedial fires. "Plausible" targets: a median Miner finishes Meadow in 8–20 sessions and biomes 1–4 in 40–90. If out of range, propose lesson length or threshold changes in the handoff note (the orchestrator applies them via a small fix task).
- **Acceptance:**
  - [ ] Report in `docs/sim.md` with tables; deterministic for a seed.

### M3-14 E2E and accessibility sweep
- **Size/Tier:** M / B · **Review:** optional · **E2E:** yes
- **Depends on:** M3-04, M3-05, M3-08, M3-09, M3-10, M3-11, M3-12
- **Owns:** `tests/e2e/m3/*.spec.ts`
- **Spec:** Axe on every menu screen in all three themes; keyboard-only full flow: new profile → placement → map → a Birch lesson → achievements → settings → parent dashboard → back; settings persistence; remedial node appears for the `pinky-weak` fixture.
- **Acceptance:**
  - [ ] All green twice in a row.

### M3-FIX-1 World map polish from the M3-04 review
- **Size/Tier:** S / B · **Review:** required (visual + a11y)
- **Depends on:** M3-04
- **Owns:** `src/ui/screens/WorldMap.tsx`, `src/ui/screens/map-logic.ts`, `src/render/map/*.ts`,
  `src/i18n/en/map.ts`, the map e2e and unit tests
- **Spec:** non-blocking items from the M3-04 review (PR #148, review 5869540979).
  - **Meta line:** a new player's island reads "☆ 0 · 0 of 6", which a child sees as "0 0 of 6".
    Hide the stars at 0 and write "0 of 6 done" through `t()`.
  - **Labels:** at 1024 px the "Sparkstone Factory" label already loses 21–26 px off the left edge
    at Sprout's default text scale of 1.5. At scale 2 it loses about 67 px and overlaps "Crystal
    Caverns" by about 50 px. Keep labels inside the window, draw the focused label on top so its
    focus ring always shows, and add an e2e check for overlap and clipping at scales 1.5 and 2.
  - **Locked islands:** they're washed so gray that every biome looks the same. Keep some biome
    colour under the clouds. The locked-label stripes barely show.
  - **Clicking a locked island** does nothing. Give a gentle "not yet" response: a short wobble
    and a kind line, with no pressure words.
  - **Rebuilds:** the 3D view rebuilds whenever the profile object changes. Key it on the data the
    map actually uses, before later cards save the profile on this screen.
- **Acceptance:**
  - [ ] Each item fixed, or listed in the handoff with a reason.
  - [ ] Map baselines refreshed through the Update snapshots workflow; visual + a11y review passes.

### M3-FIX-2 Pixel font legibility
- **Size/Tier:** S / B · **Review:** required (visual + a11y)
- **Depends on:** M2-08. High priority after the owner's playtest.
- **Owns:** `src/ui/theme/fonts.css` and the font tokens, plus any app-wide heading or HUD style
  that uses Pixelify
- **Spec:** in bold Pixelify, "C" reads as "O" and "5" as "S" (M3-04 review). Typing targets
  already use Atkinson (decision 68). Find where bold Pixelify shows letters or digits a child
  must read: island names, HUD numbers, Results. Then use the regular weight, or fall back to
  `--font-body` for digits and short labels. Keep Pixelify's look for big headings.
  - **Owner playtest, 2026-11-12** (`docs/screenshots/`): it is worse than C/O. Capital B reads
    as G or 8 ("Bill" → "Gill", "Back" → "Gack", "Go here next!" → "8o here next!"), and C
    reads as O at every size ("Crystal Caverns" → "Orystal Oaverns"). It shows on buttons, map
    labels and headings alike. If no Pixelify weight fixes B and C at button size, use
    `--font-body` for buttons, labels and names, and keep Pixelify only where a child never has
    to read the word to act (the logo, big titles). Check every capital and digit at the sizes
    used, and put a glyph sheet in the handoff.
- **Acceptance:**
  - [ ] Before and after screenshots of each affected screen in the handoff; baselines refreshed.

### M3-FIX-3 Placement test follow-ups (before Birch lessons ship)
- **Size/Tier:** S / B · **Review:** required (pedagogy)
- **Depends on:** M3-05; must merge before any non-Meadow lesson ships (M3-03)
- **Owns:** `src/engine/placement.ts`, `src/engine/placement-driver.ts`, `src/modes/placement/*`,
  `src/app/progress.ts` (`applyPlacement`), `tools/sim-placement.ts`, their tests
- **Spec:** from the M3-05 review (PR #154, review 5870060807).
  - **N1, rung key coverage:** a rung opens without really checking its new keys. In its first
    8 blocks only 41 % (top row) and 28 % (bottom row) use a new key. Make each rung's blocks
    cover its new keys before the 8-of-10 rule can open the next one.
  - **N2, the digits rung:** the whole-test WPM and accuracy average drags fast typists down.
    After the capitals rung they spend about 60 s on digits, so climbing higher lowers their
    score. Score each gate on the blocks typed at or below that biome's rung, or give the sim
    slower digits and Shift.
  - **N4, re-offering the test:** after a reload, or Pause → Quit mid-test, the test is never
    offered again. Offer it once more on the next visit.
  - **N5, a missing test:** stats from real lessons must win over the test's estimate.
  - **N6–N9, small fixes:**
    - a repeated `plays === 0` check (use `isTestedOut`);
    - the Sprout timer default has no test;
    - the 30 s floor is elapsed time, not active typing (fix the docs or the code);
    - the copy suggestions in the review.
- **Acceptance:**
  - [ ] Sim results documented again, with slower digits and Shift for the sim typists.
  - [ ] Pedagogy review passes.

### M3-FIX-4 Map labels and accessibility follow-ups
- **Size/Tier:** S / B · **Review:** required (a11y)
- **Depends on:** M3-FIX-1, M3-07; before the M3-08 text-size slider ships
- **Owns:** `src/ui/screens/map-logic.ts`, `src/ui/screens/WorldMap.tsx`, the map e2e, plus the
  small a11y files named below
- **Spec:**
  - **Whole island is the target** (owner playtest, 2026-11-12): a child clicked the Meadow
    island itself several times, and only the small nameplate worked. A click or tap on an
    island's model selects it the same way the nameplate does (raycast against the island
    meshes, or a hit box per island). Add a pointer cursor and a hover highlight. Keep the
    nameplate working, and keep keyboard selection the same.
  - **Map** (M3-FIX-1 review 5870192563):
    - **N1:** the last step of `layoutLabels` (map-logic.ts:297) never re-checks earlier labels
      and never keeps a moved label inside the bottom of the window. At 1024×600, text scale 2,
      veteran player, "meadow" overlaps "sparkstone" and "shore" overlaps "mines". Fix the solver
      and add that case to the e2e.
    - **N2:** the e2e must assert `data-mode="3d"`, so it can't pass on the flat fallback.
    - **N3:** typed letters should also clear the locked-island note.
    - **N4:** a second click on the same locked island restarts the note and announces it again.
  - **Accessibility** (M3-07 review 5870141189):
    - In Windows Contrast themes, typed and pending letters look the same; add a `GrayText` rule.
    - The HUD banner should ask the flash guard.
    - The shared flash guard resets on a clock from a different source.
    - The reduced-motion e2e must fail on the old code: tell shake apart from camera drift, and
      add an OS-setting change mid-game.
    - Toasts and announcements need separate live regions, so neither overwrites the other.
    - Results should read the motion setting live.
    - The `KeyCap` kit should default to `--font-body`.
    - Test the "Hear it again" hint at text scale 2.
- **Acceptance:**
  - [ ] An e2e clicks the centre of the Meadow island's model (not its label) and the lesson
    panel opens.
  - [ ] Each item fixed, or listed with a reason; a11y review passes.

### M3-FIX-5 Avatar onto the model runtime
- **Size/Tier:** S / B · **Review:** required (visual)
- **Depends on:** M3-09, M4-01
- **Owns:** `src/render/avatar.ts`, `src/content/cosmetics/base.ts`, `tests/unit/render/avatar.test.ts`
- **Spec:** M3-09 built the avatar's `VoxelModel` with its own reading of the type: `offset` as
  the box's min corner in model space, `pivot` as the joint in model space. M4-01's runtime and
  contracts §8.4 measure `pivot` from the box's min corner and `offset` from the parent's pivot.
  Convert the avatar data to §8.4, and draw the snapshot through `buildModel` instead of the
  avatar's own mesh code. Keep everything else the same:
  - the one shared renderer and the restored render target;
  - the per-skin PNG cache;
  - the flat portrait fallback;
  - the IP checks.
- **Acceptance:**
  - [ ] The avatar looks the same as before (baseline unchanged, or refreshed with a side-by-side
    in the handoff).

### M3-FIX-6 Letter groups that sound safe when read aloud (child safety, first priority)
- **Size/Tier:** S / A · **Review:** required (child safety)
- **Depends on:** none. Run it before every other card.
- **Owns:** `src/engine/generator.ts` (the syllable path only), a new pure
  `src/content/wordlists/spoken-blocklist.ts` (or `.txt` with a loader in the same folder),
  `tests/unit/engine/generator-spoken.test.ts`, plus any curated letter drills in
  `src/content/lessons/*.ts` and `src/content/wordlists/*.txt` that fail the new check
- **Spec:** owner playtest, 2026-11-12. The `syllables` generator joins letters at random, and
  read-aloud says the group as a word. "fak" sounded like the f-word. Nothing checks generated groups
  against the blocklist today, and the blocklist only matches spellings, not sounds.
  - Add a pure "spoken-alike" check. It rejects a group when its spelling, or its likely
    pronunciation, is close to a swear word, slur, body or toilet word. Cover at least: vowel swaps
    (fak, fuk, fek, fok), c/k/ck/q swaps, ph/f, doubled letters, a silent trailing e, and the short
    forms (sht, fk, dk). Normalise first (lower case, c→k, ck→k, ph→f, q→k, collapse doubles), then
    compare against a short list of normalised stems. Matching a stem anywhere inside the group
    counts.
  - The generator rejects such a group and draws again, inside the existing `syllableTries`
    budget, without changing the seeded stream for groups that pass. If it changes the stream
    anyway, say so in the handoff and refresh any replay or golden fixtures.
  - Run the same check over every fixed item that the read-aloud can speak: lesson drills, word
    lists, phrases and placement items. Fix or drop whatever fails.
  - Put the stem list in one place with a comment that it is for M6-08's content review. Keep it
    out of kid-facing UI and out of `t()`.
- **Acceptance:**
  - [ ] A property test (fixed seed, at least 10,000 groups for each allowed-key set the lessons
    use) finds no group that fails the check.
  - [ ] A table test lists at least 40 unsafe spellings, all rejected, and 40 near-misses that stay
    allowed (for example `fan`, `kit`, `sad`, `has`, `dish`).
  - [ ] Every fixed item in `src/content` passes, enforced by a test.

### M3-FIX-7 Curriculum: replay variety, skipping "No Peeking!", Mine review keys
- **Size/Tier:** S / B · **Review:** optional
- **Depends on:** M3-03
- **Owns:** `src/content/lessons/*.ts`, `src/content/wordlists/*.txt`, `src/engine/generator.ts`
  (the item-pick path only), `src/modes/mine/mine.ts` (one line), their tests
- **Spec:**
  - **Replay variety (owner playtest, 2026-11-12):** after finishing Meadow, the owner pressed
    "Play again" on a Meadow lesson, and every item was "ha ha". Find the cause, which could be the
    pool filter, a seed reused on replay, or a pool that leaves one item. Fix it, so that each
    lesson in every biome gets at least 5 distinct items per session when replayed.
  - The challenge "No Peeking!" lessons must be skippable before anything hides the keyboard.
  - Mine should weight `reviewKeys` (one line in `mine.ts`).
- **Acceptance:**
  - [ ] A test that replays every lesson 3 times with new seeds and checks for at least 5 distinct
    items per session.
  - [ ] A test that "No Peeking!" can be skipped.

### M3-FIX-8 My Badges scrolling and toast placement
- **Size/Tier:** S / B · **Review:** optional
- **Depends on:** M3-10
- **Owns:** the My Badges screen and its CSS, the toast component and its CSS, their tests
- **Spec:**
  - **Scrolling (owner playtest, 2026-11-12):** the badge list scrolls, but nothing shows that it
    does. The owner read "16 of 24" as a bug. Make the overflow obvious: a fade at the cut edge and
    a "More badges below" cue, or a layout that fits. Keyboard and screen-reader users must reach
    every badge.
  - A toast that arrives under a modal is never read. Hold it until the modal closes.
  - At text scale 2 the toast may cover the map corner.
- **Acceptance:**
  - [ ] At 1280×720 and at text scale 2, a screenshot shows the cue whenever badges are hidden.
  - [ ] A test that a toast queued under a modal is announced after the modal closes.

### M3-FIX-9 Import/export leftovers
- **Size/Tier:** S / B · **Review:** required (data safety)
- **Depends on:** M3-12
- **Owns:** the import/export screen and the `src/save/` import code, their tests
- **Spec:** from the M3-12 review:
  - Show which copy has an island (N4).
  - Make the `dateText` locale explicit (N5).
  - Two-tab safety: a `BroadcastChannel` message after each save, or a lock per player, so two
    tabs can't overwrite each other's progress.
- **Acceptance:**
  - [ ] A two-tab test (unit, with a fake channel) proves the stale tab reloads or refuses to save.

### M3-FIX-10 Placement small items
- **Size/Tier:** XS / C · **Review:** optional
- **Depends on:** M3-FIX-3
- **Owns:** `src/engine/placement*.ts`, the placement screen, their tests and docs
- **Spec:**
  - The docs say "Birch judged on home row", but the 60-key floor pools keys up to the words rung.
    Make the code and the docs agree.
  - The floor test should import the real constant, not keep its own copy.
  - Quitting the test and then picking yourself on the player screen offers the test again at
    once. Don't offer it again in the same visit.
  - Fix the stale comments.
- **Acceptance:**
  - [ ] Each item fixed, or listed in the handoff note with a reason.

### M3-GATE
`PLAN.md` Phase 3 acceptance (curriculum doc generated, sim plausibility, axe clean). Owner gets the word-list review dump (👤, can be deferred to M6-08 by the owner's choice). Tag `m3`.
