# Tasks: M5 Minecart Run, Bosses, Daily Quest, biomes 5–9

**Goal:** the full curriculum and every mode. If the schedule slips, `PLAN.md` §10 says to cut Minecart and Bosses **before** curriculum quality: M5-05/M5-06/M5-07 come first in priority.

Field legend: see the top of `tasks-m0-m1.md`.

---

### M5-01 Minecart Run mode
- **Size/Tier:** L / A · **Review:** required (feel)
- **Depends on:** M2-13, M4-01
- **PLAN refs:** §3.2.3
- **Owns:** `src/modes/minecart/**`, `src/content/worldgen/rails.ts`, `src/i18n/en/minecart.ts`, `tests/unit/modes/minecart/*.test.ts`
- **Spec:**
  - A sentence (or several) is laid along the track as floating letter tiles ahead of the cart (camera `rail` preset, behind and above the cart). The active sentence is also in the HUD word display (crisp text is the source of truth; tiles are decoration).
  - Speed model (pure, `logic.ts`): cart speed eases toward `k × liveWpm` with a floor (never stops; minimum crawl) and a gentle slowdown per error; scenery scrolls by distance. A rhythm meter rewards steady inter-key timing (`consistency`), not raw speed.
  - At punctuation marks (`, . ? !`) the track **branches**: the branch taken depends on the streak through that clause (high streak → scenic branch with a gem cave; otherwise a meadow branch). Both are fun; neither is a penalty.
  - Sentences policy: `backspace` (Builder) / `stay` (Miner). Length by band.
  - Biome scenery uses the current biome's palette and templates (tunnels for Mines, ice bridge for Frosty, etc.) generated in chunks ahead of the cart and recycled behind.
- **Acceptance:**
  - [ ] Speed model unit tests: never negative, never zero while typing, monotone in live WPM, bounded slowdown.
  - [ ] E2E: a Builder fixture finishes a 3-sentence run.
  - [ ] Feel review.

### M5-02 Boss framework and phase DSL
- **Size/Tier:** M / A · **Review:** required
- **Depends on:** M4-01, M4-04 (lockOn patterns), M2-13
- **PLAN refs:** §3.2.5
- **Owns:** `src/modes/boss/**` (framework only), `src/engine/boss-script.ts` (pure), `tests/unit/engine/boss-script.test.ts`
- **Spec:**
  - A boss script is data: `{ bossId, intro: MessageKey, phases: Phase[], outro: MessageKey }`. Phase kinds: `charge` (one sentence, sequential, accuracy-focused; boss winds up an attack that is "blocked" by finishing the sentence), `minions` (N lockOn words on small adds, speed-focused, director-scaled like Defense), `weakpoints` (single letters/bigrams from the chapter's `newKeys`, appearing on glowing blocks on the boss body; precision-focused). Each phase has an HP chunk; the boss's health bar is blocky segments.
  - The runtime interprets scripts, swaps engine sessions per phase (one summary aggregated over all phases), triggers model anims (`hit`, phase transitions), and ends with a friendly **defeat** (the boss shrinks, becomes a friendly pet-sized version, waves goodbye). No losing: if the learner struggles, the boss gets "tired" (slower phases) after 2 minutes.
  - Script validator: every phase's text typeable with the lesson's allowed keys.
- **Acceptance:**
  - [ ] Script interpreter fully tested with scripted keystroke logs (`PLAN.md` Phase 5 accept).
  - [ ] "Tired" fallback guarantees the encounter ends within 6 minutes for a 5-WPM simulated typist.

### M5-03 Boss designs and models (9)
- **Size/Tier:** L / A · **Review:** required (visual + IP)
- **Depends on:** M4-01, M4-02
- **PLAN refs:** §7.3, `README.md` §8.2
- **Owns:** `src/content/mobs/bosses/*.{model.json,ts}`, `src/i18n/en/bosses.ts`
- **Spec:** Cobble Colossus (meadow), Frost Wyrm (frosty), Mushroom Monarch (marsh), Sparkstone Sentinel (sparkstone), Sky Hydra (citadel), plus 4 original designs with owner-approved names: Bramble Stag (birch), Tidecrab King (shore), Lantern Mole (mines), Prism Moth (caverns). The owner may rename them later, so display names live only in i18n. Large (20–40 parts), readable silhouettes, weak-point attachment points named in the model, `idle`/`windup`/`hit`/`phase`/`defeat`/`friendly` animations. Friendly, not scary (Sprout players fight them too).
- **Acceptance:**
  - [ ] Model Lab screenshots of all 9; visual + IP review passes; reviewer confirms none are frightening.

### M5-04 Boss encounter scripts (9)
- **Size/Tier:** M / B · **Review:** optional (pedagogy review required)
- **Depends on:** M5-02, M5-03, M5-06
- **Owns:** `src/content/bosses/*.ts`, `src/i18n/en/boss-lines.ts`, `tests/unit/content/bosses.test.ts`
- **Spec:** One script per biome that tests that chapter's keys (Mines boss: capitals; Marsh: numbers; Caverns: punctuation; Sparkstone: symbols). Band-scaled lengths. Wire each biome's `boss` lesson to its script.
- **Acceptance:**
  - [ ] Each script validated; each beaten by the scripted log fixture for slow and fast typists.

### M5-05 Content for biomes 5–9 (lists, phrases, sentences)
- **Size/Tier:** L / A · **Review:** required (child safety, reading level, originality)
- **Depends on:** M1-10, M3-02 (may start before M2-GATE; `task-graph.md` rule 4)
- **PLAN refs:** §7.1, `README.md` §8.4–8.5
- **Owns:** `src/content/wordlists/{mines,marsh,caverns,sparkstone,citadel}-*.txt`, `src/content/sentences/*.txt`, `src/content/wordlists/pools.ts` (append), `SOURCES.md` (append), `docs/review/content-m5.txt`
- **Spec:**
  - Mines: capitalized words, names of places/things in the voxel world (original), Title Case phrases. Marsh: numbers in context ("5 red mushrooms", "Room 12"), number-row drills. Caverns: punctuation in sentences. Sparkstone (opt-in Builder): symbols `- _ ( ) : @ # / = + *`, "code-ish" strings that are wholesome and readable (`light_on()`, `#blocks: 12`, `mine-cart-3`), no real programming jargon that confuses. Citadel: mastery sentences.
  - **~600 original sentences** across bands and biomes, with a light "voxel world" narrative (the island, the lantern, the friendly mobs), tagged by required key set and length. Written in batches of 50 with self-review; avoid repetition of the same sentence template (validator checks that no 4-word sequence repeats more than 5 times across the set).
  - Many sentences are also needed for earlier biomes' Minecart and Builder-band lessons where the key set allows (from Frosty on, all letters exist; punctuation-free sentences there).
- **Acceptance:**
  - [ ] Validator clean, including the new n-gram repetition rule.
  - [ ] Reviewer reads 100 random sentences: safe, kind, readable, not dull.

### M5-06 Lessons for biomes 5–9
- **Size/Tier:** M / A · **Review:** required (pedagogy)
- **Depends on:** M5-05, M3-01
- **PLAN refs:** §4, §7.2
- **Owns:** `src/content/lessons/{mines,marsh,caverns,sparkstone,citadel}.ts`, `src/i18n/en/lessons-*.ts`
- **Spec:** Mines 13 (Shift taught as "opposite-hand pinky holds Shift"; `caseInsensitiveFor` empty from here on), Marsh 13, Caverns 14, Sparkstone 12, Citadel 13; total curriculum ≈ 120. Modes now mixed: Defense lessons every few lessons from Birch onward (update earlier biome files too, in a separate commit, now that Defense exists), Minecart for sentence lessons, boss at the end of each biome. Citadel ends with a final gauntlet: Minecart → Defense → final boss.
- **Acceptance:**
  - [ ] Curriculum validator clean; `docs/curriculum.md` regenerated; total lessons 115–125.
  - [ ] `tools/sim-progression.ts` rerun over all biomes, results appended to `docs/sim.md`.

### M5-07 Biomes 5–9 art: palettes, skies, dioramas, mobs wave 2
- **Size/Tier:** L / A · **Review:** required (visual + IP)
- **Depends on:** M2-02, M2-03, M4-03
- **PLAN refs:** §3.1, §5.1, §7.3
- **Owns:** `src/content/biomes/{birch,shore,frosty,mines,marsh,caverns,sparkstone,citadel}.ts` (env + worldgen parts not yet present), `src/content/worldgen/templates/*` (new templates), `src/content/blocks/biome-*.ts` (new blocks, nums 400–599), `src/content/loot/*.ts`, `src/content/mobs/{wave-2 ids}.*`, `src/i18n/en/blocks-biomes.ts`, screenshot baselines
- **Spec:** Every biome gets: palette variant, sky stops for 4 times of day, ambient particle, fog, diorama generator config + 3–5 templates, 6–10 new blocks, a loot table, and the music key hint for M6-01. Six more mobs (to reach 14) for biomes that lack them. Underground biomes (Mines, Caverns) use cave dioramas lit by crystals/lanterns rather than sky. Sparkstone: original "spark" tech look (copper pipes, glowing panels) — do not resemble any existing game's redstone circuitry.
- **Acceptance:**
  - [ ] Screenshot per biome (day + night) committed; visual + IP review passes; draw-call budget met in each.

### M5-08 Daily Quest and torch calendar
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M2-13, M4-04, M5-01, M4-07
- **PLAN refs:** §3.2.6
- **Owns:** `src/modes/daily/**`, `src/engine/daily.ts` (pure), `src/i18n/en/daily.ts`, `tests/unit/engine/daily.test.ts`
- **Spec:** `dailyPlan(localDate, band, unlockedBiomes) → { seed, mode, params }` (pure): seeded by `dailySeed`, rotates among Mine/Defense/Minecart, 3 minutes, content limited to the learner's allowed keys (so two kids get the same *structure*, different safe text if their key sets differ). Streak torches: a row of torch blocks on Home Island, one lit per day played (local date), last 14 days. Missing a day never "breaks" anything visible in a punishing way; the torch just stays unlit.
- **Acceptance:**
  - [ ] Same date + same band + same keys ⇒ same plan (test). Local-date handling across midnight and DST tested with fixed epochs.

### M5-09 Free Practice and custom lists
- **Size/Tier:** M / B · **Review:** required (safety of imported text)
- **Depends on:** M2-13, M1-10
- **PLAN refs:** §3.2.7
- **Owns:** `src/modes/practice/**`, `src/ui/screens/Practice.tsx`, `src/content/custom-import.ts`, `src/i18n/en/practice.ts`, `tests/unit/content/custom-import.test.ts`
- **Spec:** Pick keys (on-screen keyboard toggle grid), or a pool, or custom text; timed (1/2/5 min) or untimed; pick the mode (Mine or Minecart). Custom text: paste or `.txt` import (≤ 50 KB, ≤ 2000 lines), normalized (smart quotes → ASCII, tabs → spaces, collapse whitespace), non-ASCII chars stripped with a visible note, blocklist applied (blocked words silently skipped and counted: "3 words were skipped"), stored per profile (max 10 lists). Behind the parent gate for import (`PLAN.md`: parents/teachers import).
- **Acceptance:**
  - [ ] Import rejects oversized, binary, and empty files gracefully (`PLAN.md` Phase 5 accept); fuzz test with random bytes never throws.

### M5-10 Achievements (to ~40), cosmetics and pets
- **Size/Tier:** M / B · **Review:** optional (copy + IP review)
- **Depends on:** M3-10, M4-01, M3-09
- **PLAN refs:** §3.3
- **Owns:** `src/content/achievements/{modes,biomes,builder,daily}.ts`, `src/content/cosmetics/*.ts`, `src/content/mobs/pets/*.{model.json,ts}`, `src/render/pet.ts`, `src/i18n/en/cosmetics.ts`
- **Spec:** ~20 more achievements (Defense, Minecart, Boss, Builder, Daily torches: 10-day Torchlight, etc.). Cosmetics: hats, pickaxes, capes, unlocked by milestones (never purchasable). Pets: cube-cat, cube-parrot, + 2 more; follow the player avatar in Mine/Builder, cheer on streak milestones, nap when idle.
- **Acceptance:**
  - [ ] Each achievement tested; every cosmetic reachable (test walks unlock conditions).

### M5-11 M5 E2E
- **Size/Tier:** M / B · **Review:** optional · **E2E:** yes
- **Depends on:** M5-01, M5-04, M5-06, M5-07, M5-08, M5-09, M5-10
- **Owns:** `tests/e2e/m5/*.spec.ts`
- **Spec:** Every biome's first lesson and boss load; `veteran-builder` fixture plays a Minecart run, a boss, a daily quest; custom list import flow; full-curriculum "completable" check runs at the data level (every lesson reachable from Meadow by unlock rules).
- **Acceptance:**
  - [ ] All green twice.

### M5-GATE
`PLAN.md` Phase 5 acceptance (all 9 biomes completable, bosses tested by scripted logs, import rejects bad files) + visual review of all biomes. Tag `m5`.
