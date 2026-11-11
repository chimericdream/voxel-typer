# Voxel Typer — Implementation Plan

A browser-based typing game for kids aged 6–13, set in a blocky, voxel-built world. Kids learn touch typing by mining, crafting and defending a block world with their keyboards.

This document is written for an implementing agent (Opus 5.5 / Fable 5.2). It is meant to be followed top to bottom. **For multi-agent execution, start at [`docs/impl/README.md`](docs/impl/README.md)**: it breaks this plan into task cards with frozen interface contracts, a dependency graph and review gates, and lists clarifications to this document (§8 there). Where it says **DECISION**, the choice is made; don't relitigate it. Where it says **OPEN**, use your judgement and record what you chose in `docs/decisions.md`.

---

## 1. Vision

> "Type to mine. Type to build. Type to survive the night."

Typing is the *only* verb. Every game mechanic (breaking blocks, fighting mobs, placing blocks, driving minecarts) is powered by correct keystrokes, and every mechanic is a vehicle for a specific, deliberate typing skill. The game should feel like a creative sandbox first and a lesson second. A kid should be able to say "I played for an hour" and a parent should be able to say "their WPM went from 8 to 22 this term".

### Design pillars

1. **Typing is the gameplay, not a gate in front of it.** No quiz screens between fun parts.
2. **Never punish, always reward.** Mistakes cost a little momentum, never progress, lives or items. There is no "game over", only "the sun came up".
3. **Voxel everything.** The world, the UI, the particles, the mobs, the fonts, the cursor. If it's on screen it's made of cubes or pixel-grid art.
4. **Real pedagogy under the hood.** Home-row-first curriculum, per-key adaptive practice, correct finger guidance, accuracy before speed.
5. **Safe by default.** No accounts, no chat, no ads, no tracking, no network needed. Data stays on the device.
6. **Wide age range, one game.** Age band changes pacing, text, UI size and goals — not the core fantasy.

### Legal/IP note (important)

"Minecraft-like" means *aesthetic and genre vocabulary* (blocky voxels, pixel textures, day/night, mining, crafting). **Do not** copy Mojang/Microsoft assets, textures, sounds, music, logos, fonts, or characters. No Creepers, Endermen, Steve, Notch-style names, or the Minecraft font. All mobs, blocks, textures, names and audio are original. Add a footer disclaimer: "Voxel Typer is an independent game and is not affiliated with Mojang or Microsoft."

---

## 2. Target players

| Band | Ages | Typing level | Needs |
|------|------|--------------|-------|
| **Sprout** | 6–8 | Hunt-and-peck or none | Big letters, on-screen keyboard with finger colors, single letters → short words, audio read-aloud of words, zero time pressure, tiny sessions (5–8 min) |
| **Miner** | 9–10 | Some | Words, short phrases, light timers, streaks, simple goals (accuracy %), crafting progression |
| **Builder** | 11–13 | Can type, wants speed | Sentences, punctuation, numbers, capitalization, WPM targets, leaderboards (local), boss fights, custom lists, "code-ish" text |

Age band is chosen on profile creation (can be changed any time). It sets *defaults* for: text size, keyboard overlay on/off, timer pressure, content difficulty, UI density, vocabulary list. Everything is overridable in Settings.

Reading level matters: Sprout word lists must use Dolch/Fry-style sight words and CVC words; no words a 6-year-old can't read.

---

## 3. Game design

### 3.1 The world

A single persistent **Home Island**: a small voxel diorama the player owns (≈ 48×48×32 blocks) that grows as they play. Around it is the **World Map**: a floating-island archipelago, each island a biome and a curriculum chapter.

Biomes (curriculum chapters, see §4):

1. **Meadow Home** — home row (`a s d f j k l ;`)
2. **Birch Forest** — top row
3. **Sandy Shore** — bottom row
4. **Frosty Peaks** — full alphabet, short words
5. **Deep Mines** — Shift & capitals, common words
6. **Mushroom Marsh** — numbers & number row
7. **Crystal Caverns** — punctuation (`. , ? ! ' "`) and full sentences
8. **Redstone-like tech biome: "Sparkstone Factory"** — symbols, `- _ ( ) : @ #`, simple "code-ish" strings (opt-in for Builder band)
9. **Sky Citadel** — mastery: speed + accuracy gauntlets, final boss

Each biome has: a lesson path (node map), 1 boss, 3 collectible "rare drops", a distinctive palette/sky/music loop, and unlockable building blocks for Home Island.

### 3.2 Core mechanics (game modes)

All modes share one typing engine (§6) and emit the same events (`CharCorrect`, `CharWrong`, `WordComplete`, `StreakChange`, `Pause`), so new modes are cheap.

1. **Mine (primary loop; teaches accuracy + key recall).**
   Target block floats in front of the camera showing a letter/word. Each correct key chips the block (crack-stage textures 0–9, particles, pickaxe swing). Complete → block breaks, items fly to inventory. Wrong key → block "wobbles" and a soft thud; no damage lost. Ore veins give bonus items for streaks.
2. **Night Defense (teaches speed + target switching).**
   Day: gather. Dusk: the player sees a short "wave" announcement. Night: original blocky mobs approach from the horizon along lanes; each carries a word. Typing the first letter of a word locks that mob (like Typing of the Dead / ZType); finish it to pop it. Mobs that reach the base only "bonk" the shield (shield regenerates at dawn); no loss of items. Wave size/speed scales from the player's measured WPM so it's always in the flow channel.
3. **Minecart Run (teaches rhythm + flow on sentences).**
   Rails scroll toward the player; text for a sentence sits along the track. Correct keystrokes accelerate the cart; errors slow it slightly. Branch switches at punctuation. This is the main Builder-band sentence trainer.
4. **Builder Mode (reward + creativity loop).**
   Items earned from the other modes are placed on Home Island by typing: type `OAK` to arm the oak block, `HOUSE` to stamp a blueprint, etc. Commands are real words — typing practice in a free-form creative context. Includes undo (`Backspace`/`Ctrl+Z`), a camera orbit, and screenshot export (PNG).
5. **Boss Fights (end of each biome, tests the chapter's keys).**
   Large multi-phase voxel boss (e.g. the **Cobble Colossus**, **Frost Wyrm**). Phases alternate: sentence "charge-up" (accuracy), minion words (speed), weak-point letters (precision on the chapter's new keys).
6. **Daily Quest.** One 3-minute seeded challenge per day (same for everyone via a date seed — no server). Streak calendar on Home Island (torches that light each day).
7. **Free Practice & Custom Lists.** Pick keys/lists/text, timed or untimed; paste your own text (spelling lists, class vocabulary). Parents/teachers can import a `.txt` list.
8. **Placement Test ("Find your level").** 90-second mining challenge on first launch that estimates starting biome and per-key baseline. Skippable.

**Co-op (stretch, Phase 6):** local two-player split lane on one keyboard is *out of scope* (key collisions); asynchronous "ghost" of friend's best run via exported file is OK.

### 3.3 Progression & rewards

- **Block Inventory** — each correct word drops block items typed by theme (dirt, oak, stone, ores, glass, wool colors, lanterns, etc., ~80 blocks at launch). Rarity by streak/accuracy, never by speed alone (so slower kids still get good loot).
- **Stars per lesson (1–3):** 1 = completion, 2 = accuracy ≥ 90%, 3 = accuracy ≥ 95% *and* above personal-target WPM. The speed target is **relative to the player's own baseline**, not a global bar.
- **Skins:** avatar parts (hat, pickaxe, cape, pets) unlocked by milestones. Pets (cube-cat, cube-parrot) follow the player and react to streaks.
- **Achievements** (~40): "First Ore", "Home Row Hero", "No Mistakes Minute", "10-day Torchlight", "Wrote a Whole Sentence"...
- **Home Island growth:** biome completion unlocks island expansion tiles.
- **No premium currency, no loot boxes, no timers-for-pay, ever.**

### 3.4 Game feel (the "juice" list; don't skip it)

Hit-stop on block break (40 ms), screen shake scaled to streak, particle cubes with physics, pitch-rising "streak" chime per correct char in a word, crack-stage textures, squash-and-stretch on UI, a rolling combo meter styled as a hotbar, day/night cycle with voxel clouds, ambient animal mobs (voxel chickens wandering, purely decorative), water shader with blocky waves, subtle post-processing (vignette, light bloom on lanterns) with a quality toggle.

---

## 4. Typing pedagogy & curriculum

This is what separates the product from a toy. Treat it as first-class.

### 4.1 Principles
- **Accuracy before speed.** Early lessons only reward accuracy. Speed targets appear after chapter 3.
- **Proper fingering.** On-screen keyboard colors each finger zone; a hand overlay highlights the next key's finger. Sprout band shows it by default; Builder can turn it off. Never *force* correct fingering (can't detect it from a keyboard) but strongly teach it.
- **Introduce few keys at a time**, cumulative review (spaced repetition).
- **Don't look down:** optional "hide keyboard" challenge lessons.
- **Short sessions, frequent wins.** Auto-suggest breaks at 15 min (parent-configurable), with a "take a stretch" mini-animation.

### 4.2 Lesson structure
A **lesson** = a seeded, deterministic generator + params:
```ts
interface Lesson {
  id: string;                    // "meadow-03"
  biome: BiomeId;
  newKeys: string[];             // keys introduced this lesson
  reviewKeys: string[];          // keys from earlier lessons to mix in
  contentKind: 'letters' | 'syllables' | 'words' | 'phrases' | 'sentences';
  length: { chars: number } | { seconds: number };
  mode: GameMode;                // which game mode hosts it
  targets: { accuracy: number; wpmRelative?: number };
}
```
Content comes from curated lists in `src/content/` filtered by *allowed character set* so lessons never ask for keys the learner doesn't know yet. Build a word-list pipeline (§9) that validates every word is typeable from a given key set and is age-appropriate.

### 4.3 Adaptive engine
Per-key stats (rolling): attempts, errors, median inter-key latency, last-seen time. A **weak-key weighting** function biases generation toward keys with high error rate or high latency (like Keybr's algorithm, original implementation), capped so ≥50% of content is "comfortable" keys. Bigram stats (e.g. `th`, `er`) tracked for Builder band. Spaced repetition for review keys. All pure functions of the stats; fully unit-tested.

### 4.4 Metrics (what we measure, what we show)
- **WPM** (standard: 5 chars = 1 word), **net WPM** (errors subtracted), **accuracy %**, **consistency** (std dev of key latency), **per-key heat map**, **streak length**.
- Kid-facing display shows *stars, streaks and personal bests* — not raw failure stats. The **Parent Dashboard** (behind a simple "type this word to enter" gate) shows charts: WPM over time, accuracy over time, weak keys heat map, minutes practised per day, curriculum progress, and exportable CSV.

### 4.5 Keyboard layouts & i18n
- **DECISION:** Ship `en-US` QWERTY first, but architect layouts as data (`src/content/layouts/*.json`): key positions, finger assignment, shifted characters. Include `en-GB`, and design for Dvorak/Colemak/AZERTY/QWERTZ as follow-ups. Use `KeyboardEvent.key` for matching characters (so layout-independent) and `KeyboardEvent.code` only for the on-screen keyboard's physical highlight.
- All UI strings through an i18n table from day one (`src/i18n/en.ts`), even though only English ships.

### 4.6 Accessibility & inclusion
- Dyslexia-friendly font toggle (OpenDyslexic-style bundled OFL font; verify license) in addition to the default pixel font; **the pixel font must be legible at kid sizes** — use it for headings/HUD, offer a clean sans for long words/sentences.
- Letter size slider; high-contrast mode; colorblind-safe finger palette (don't rely on color alone — add patterns/labels on the keyboard overlay).
- Reduced-motion mode (disables shake, hit-stop, parallax, flashing). Never flash more than 3 times/second.
- Optional text-to-speech for words (Web Speech API) for the Sprout band, plus a "hear it again" key.
- One-handed and "sticky" friendly: no required chords except Shift; tolerate key-repeat; ignore accidental modifier keys; never require Caps Lock state knowledge (show a "Caps Lock is on!" hint).
- Full keyboard navigation of menus; mouse/touch only for menu convenience. Screen-reader labels on menus (the in-world typing view is inherently visual; provide an audio-described alternative where cheap).
- Respect `prefers-reduced-motion` and `prefers-color-scheme` where relevant.

---

## 5. Art, audio & UI direction

### 5.1 Look
- Original **16×16 pixel-art texture atlas**, generated *procedurally in code* at startup (seeded noise + palette ramps → `OffscreenCanvas`), then uploaded with `NearestFilter`, no mipmaps bleeding. This avoids shipping binary art, avoids IP risk, and lets us do palette swaps per biome. Provide an `assets/textures/src/` folder where hand-drawn overrides (PNG) can replace any generated tile later.
- **Block-based characters and mobs**: defined as JSON voxel models (box parts with per-face UVs + animation rigs: idle, walk, hit, defeat). A tiny in-repo "Model Lab" dev page previews them.
- **Lighting:** baked-ish vertex AO on voxels (cheap, gives the signature look), one directional sun + hemisphere light, point lights for lanterns, simple shadow map on quality ≥ medium.
- **Camera:** gentle isometric-ish perspective with slow parallax drift; first-person "over-the-shoulder mining" view for Mine mode.
- **UI:** a voxel/pixel UI kit rendered in DOM+CSS (not canvas) for accessibility and crisp text: bevelled inventory slots, hotbar combo meter, chunky buttons with pressed states. 9-slice via CSS `border-image` with procedurally generated PNG data-URIs.
- **Palette:** per-biome palettes defined as data; global warm daytime palette, cool night. Verify WCAG AA contrast for text over 3D scene via a semi-opaque text plate.

### 5.2 Audio
- **DECISION:** Synthesize all SFX and music at runtime with the Web Audio API (no binary assets, no licensing risk): block break (filtered noise burst, material-specific), chime (pitch ladder pentatonic scale on streak), error thud, mob pop, UI clicks, ambient wind/birds.
- Music: procedural, loop-based, pentatonic generative layers per biome with day/night variants; intensity layer rises with streak. Volume sliders: master, music, SFX, voice.
- Autoplay policy: start `AudioContext` on first user gesture (the "Press any key to start" screen satisfies this).

### 5.3 Screens
Splash → Profile select/create (name, age band, avatar) → Placement test (skippable) → World Map ↔ Lesson Intro ↔ Mode scene ↔ Results → Home Island (Builder) → Inventory/Skins → Achievements → Parent Dashboard → Settings. Every screen has full keyboard flow; the game never *requires* a mouse after launch.

---

## 6. Technical architecture

### 6.1 Stack — **DECISIONS**
| Concern | Choice | Why |
|---|---|---|
| Platform | Web app, installable **PWA**, works offline | Zero-install in classrooms/Chromebooks, runs on any desktop keyboard device |
| Language | **TypeScript** (strict) | Safety for a large codebase |
| Build | **Vite** | Fast dev, simple static output |
| 3D | **Three.js** (+ custom chunk mesher) | Mature, small enough, good instancing; no engine lock-in |
| UI | **Preact** + CSS modules (or plain DOM + small signals lib) for menus/HUD | Tiny, fast; 3D scene stays outside the UI framework |
| State | Small typed store (Zustand-like or custom) with serializable state | Save/load, replays, tests |
| Persistence | **IndexedDB** (via `idb`) with a versioned schema + migrations; JSON export/import | Local-only, privacy-safe |
| Audio | Web Audio API, custom synth module | See §5.2 |
| Tests | **Vitest** (unit), **Playwright** (e2e + screenshot regression), property tests with **fast-check** for the engine | |
| Lint/format | ESLint + Prettier + `tsc --noEmit` in CI | |
| CI | GitHub Actions: typecheck, lint, unit, e2e (headless Chromium), build, bundle-size budget | |
| Package manager | npm (lockfile committed) | Node 26 / npm 11 present on the dev machine |

No backend. No analytics SDKs. No third-party network requests at runtime (fonts and everything else self-hosted/generated). Add a strict CSP in `index.html`.

### 6.2 Repository layout
```
voxel-typer/
  PLAN.md
  README.md
  docs/
    decisions.md        # running log of OPEN decisions you made
    curriculum.md       # human-readable lesson table (generated from data)
    art-guide.md
  src/
    main.ts
    app/                # app shell, router, screen state machine
    engine/             # PURE, framework-free typing engine (no DOM, no three)
      session.ts        # TypingSession: state machine, feed(keyEvent) -> events
      matcher.ts        # target matching, locking, backspace policy
      stats.ts          # WPM/accuracy/latency/per-key aggregation
      adaptive.ts       # weak-key weighting, spaced repetition
      generator.ts      # seeded lesson content generation
      rng.ts            # seeded PRNG (mulberry32/sfc32)
    input/              # KeyboardEvent normalization, IME/dead-key/modifier handling
    content/
      wordlists/        # curated .txt per band/tier + build-time validators
      layouts/          # keyboard layout JSON
      lessons/          # curriculum data (TS or JSON)
      blocks.ts         # block registry (ids, textures, rarity, tags)
      mobs/             # voxel model JSON + behaviours
      achievements.ts
    render/             # three.js scene, voxel mesher, atlas gen, particles, camera, post
    modes/              # mine/, night-defense/, minecart/, builder/, boss/, daily/, practice/
    audio/              # synth, sfx definitions, music generator
    ui/                 # screens + components (Preact), voxel UI kit, i18n bindings
    save/               # IndexedDB, schema, migrations, import/export
    i18n/
    a11y/
  tools/                # node scripts: word-list validator, atlas preview, curriculum doc gen
  tests/
    unit/  e2e/  fixtures/
  public/               # manifest, icons (generated), service worker
```

### 6.3 The key architectural rule
**The typing engine is a pure library.** `engine/` imports nothing from DOM, Three.js or UI. Input is `{ key, timestamp, modifiers }`; output is a stream of typed events. Game modes subscribe to events and render. This makes the educational core fully unit-testable, replayable (record a keystroke log → deterministic replay → regression tests), and portable.

```ts
// engine contract sketch
type KeyInput = { key: string; t: number; shift: boolean };
type EngineEvent =
  | { type: 'correct'; char: string; latencyMs: number }
  | { type: 'wrong';   expected: string; got: string }
  | { type: 'targetLocked'; targetId: string }
  | { type: 'targetComplete'; targetId: string; accuracy: number }
  | { type: 'streak'; length: number }
  | { type: 'sessionEnd'; summary: SessionSummary };

interface TypingSession {
  feed(input: KeyInput): EngineEvent[];
  setTargets(targets: Target[]): void;
  snapshot(): SessionState;       // serializable
}
```
Wrong-key policy is configurable per band: *stay* (must hit the right key; default Sprout/Miner), *skip-and-count* (advance, count error; Builder/practice), *backspace-required* (sentences).

### 6.4 Rendering the voxel world
- **Chunked mesher**: 16×16×16 chunks, greedy-meshing or culled-face meshing into `BufferGeometry` with per-vertex AO and texture-atlas UVs; rebuild only dirty chunks (Builder edits). Worker-offloaded meshing when chunk counts grow.
- **Instanced meshes** for dynamic small things (particles, items, mobs' parts) via `InstancedMesh`.
- Mine mode renders a single dramatic target block with high detail; the surrounding scenery is a static pre-meshed diorama per biome (generated from seeded 3D noise + hand-authored structure templates).
- **Performance budgets** (target: 2018-era Chromebook/iGPU): 60 fps at 1280×720 on "Medium"; ≤ 150 draw calls; ≤ 5 MB gzipped initial JS; first interactive < 3 s on a cold cache; auto quality scaler that drops shadows → post → render scale if frame time > 20 ms for 2 s.
- Render-on-demand when on static menus (don't burn battery).
- A WebGL-unavailable fallback: a 2D canvas "lite mode" renders the same lessons with flat sprites (generated from the same atlas). Don't let a missing GPU lock a kid out of practice.

### 6.5 Input handling (gotchas to design for)
- Use `keydown` and `event.key`; ignore `event.repeat`; ignore when `ctrlKey/metaKey/altKey` (except documented shortcuts); prevent default only for keys the game consumes (space, `'` and `/` quick-find in Firefox, Backspace, Tab).
- Handle dead keys/IME composition: ignore during `isComposing`.
- Use `performance.now()` for timing, not `Date.now()`.
- Window blur/visibility → auto-pause the session and stop the clock (no WPM penalty).
- Shift tracking via the event, not state, to avoid stuck modifiers after alt-tab.
- Caps Lock detection via `getModifierState('CapsLock')` for the hint banner.
- Tolerate touch devices: show a "keyboard required" message with an on-screen keyboard fallback marked experimental (tablet support is a stretch goal).

### 6.6 Save data
```ts
interface Profile {
  id: string; name: string; ageBand: 'sprout'|'miner'|'builder';
  createdAt: number; settings: Settings;
  progress: { lessons: Record<LessonId, LessonResult>; unlockedBiomes: BiomeId[] };
  keyStats: Record<string, KeyStat>; bigramStats?: Record<string, KeyStat>;
  inventory: Record<BlockId, number>; island: IslandSave; cosmetics: CosmeticSave;
  achievements: Record<AchievementId, number>;
  history: SessionSummary[];   // capped + compacted
  schemaVersion: number;
}
```
Autosave on every lesson completion and every 30 s in Builder. Versioned migrations with a test per version. Export/import as a single JSON file so families can move devices. Up to 8 local profiles (siblings sharing a computer).

### 6.7 Privacy & child safety (COPPA/GDPR-K minded)
No accounts, no PII collected, no network calls, no ads, no external links without a parent gate. Profile "name" is a nickname, stored locally. A "Privacy" screen states this plainly in kid-readable language. Parent gate for Settings → Danger zone (delete data) and external links.

---

## 7. Content plan

### 7.1 Word lists (build pipeline)
- Source lists must be **permissively licensed or authored by us** (e.g. generate from public-domain corpora; do not paste copyrighted lists). Record provenance in `src/content/wordlists/SOURCES.md`.
- `tools/validate-wordlists.ts` (runs in CI) asserts: only allowed characters per tier; length bounds; no profanity/slang/sensitive words (use a blocklist in-repo, err on the side of excluding); no duplicates; reading-level tags (`dolch`, `cvc`, `grade2`, `grade4`, `grade6+`).
- Themed lists for flavor: blocks & biomes, animals, tools, colors, space, food (kid-safe), plus lists for **home-row-only words** (`dad`, `sad`, `flask`, `salad`, `alaska`...), generated and hand-curated per key-set.
- Sentences: ~600 short, wholesome, original sentences with a "voxel world" narrative flavor, tagged by allowed keyset and length. Original authoring, no copying.

### 7.2 Curriculum
~**120 lessons** across 9 biomes (≈ 12–15 each), data-driven (`src/content/lessons/`). `docs/curriculum.md` is generated from data by `tools/gen-curriculum-doc.ts` so the table never rots. Each biome ends with a boss and a "mastery check" that unlocks the next biome; the player can always replay and the adaptive engine can inject remedial mini-lessons ("Your pinky wants practice!").

### 7.3 Mobs (original designs; ~14)
Examples: *Slimeling* (cube slime), *Moss Golem*, *Cave Bat* (3 voxel wings), *Frost Pup*, *Cactus Cat*, *Lantern Fish*, *Crystal Crab*, *Sandstorm Imp*; bosses: *Cobble Colossus*, *Frost Wyrm*, *Mushroom Monarch*, *Sparkstone Sentinel*, *Sky Hydra*. Each has idle/walk/hit/defeat animations (keyframed box transforms) and a "word flavor" (mobs in Frosty Peaks carry cold-themed words, etc.).

---

## 8. Phased delivery

Each phase ends with something playable, committed, tagged, and demonstrable. **Do not start a phase until the previous phase's acceptance criteria are green.** Commit small and often with conventional-commit messages; open a PR per phase if working on branches.

### Phase 0 — Foundations (½ day)
- Scaffold Vite + TS strict + Preact + Vitest + Playwright + ESLint/Prettier + CI workflow.
- `README.md`, `docs/decisions.md`, `CLAUDE.md` (project conventions for future agent sessions: commands, architecture rule §6.3, no-IP rule, testing expectations).
- Bundle-size and a11y lint (eslint-plugin-jsx-a11y) in CI.
- **Accept:** `npm run dev`, `npm test`, `npm run e2e`, `npm run build` all pass on a clean checkout; a "Hello voxel" Three.js cube renders with nearest-filtered procedural texture.

### Phase 1 — Typing engine (pure) (1–2 days)
- `engine/*` with full unit + property tests: matching, wrong-key policies, WPM/accuracy math, per-key stats, streaks, deterministic seeded generator, adaptive weighting, replay of recorded keystroke logs.
- CLI harness `tools/sim.ts`: simulate a synthetic typist (configurable speed/error profile) over a lesson to check difficulty curves without a browser.
- **Accept:** ≥ 95% line coverage on `engine/`; property tests prove: generator never emits chars outside allowed set; WPM matches hand-computed fixtures; replay is deterministic.

### Phase 2 — Vertical slice: Mine mode on Meadow Home (3–5 days)
- Procedural atlas, chunk mesher w/ AO, one biome diorama, day/night sky, camera, crack-stage block, particles, hit-stop/shake, Web Audio SFX, HUD (hotbar combo meter), on-screen keyboard with finger colors, input layer, results screen with stars, first 6 Meadow lessons, local profile + autosave.
- **Accept:** A 6-year-old (or a test user) can complete lesson 1 without instructions; 60 fps on Medium on integrated GPU; Playwright e2e plays a scripted lesson end to end; screenshot baseline recorded; keyboard-only flow from splash to results.

### Phase 3 — Curriculum, adaptation & meta (4–6 days)
- All lessons data for biomes 1–4, world map, placement test, adaptive remedial lessons, per-band settings, accessibility options (§4.6), achievements v1, Settings, profiles (multi), Parent Dashboard v1 (charts: WPM/accuracy over time, key heat map), save migrations + import/export.
- **Accept:** curriculum doc generated; sim tool shows a median synthetic learner progresses through biomes 1–4 in plausible session counts; axe-core a11y checks pass on all menu screens.

### Phase 4 — Night Defense + Home Island Builder (5–7 days)
- Mob models + animation rig + Model Lab page, lock-on targeting, waves scaled to measured WPM, shield mechanic, night lighting/lantern point lights. Builder mode: block placement by typing, blueprints, undo, camera orbit, PNG screenshot, island expansion, inventory UI.
- **Accept:** no-failure-state verified by test (can't lose items/progress); wave difficulty converges to target accuracy band 85–95% on simulated typists of 10/25/50 WPM; island save/load round-trips exactly.

### Phase 5 — Minecart Run, Bosses, Daily Quest, biomes 5–9 (5–8 days)
- Sentence-flow mode, boss framework (phase scripting DSL), biomes 5–9 content and art palettes, daily seeded quest + streak torches, custom list import, remaining achievements, pets/cosmetics.
- **Accept:** all 9 biomes completable; bosses tested via scripted keystroke logs; custom list import rejects invalid/oversized files gracefully.

### Phase 6 — Polish, PWA, hardening (4–6 days)
- Procedural music, final juice pass, quality scaler, WebGL-less lite mode, PWA offline + update flow, CSP, i18n scaffolding verified with a pseudo-locale, localization-length stress test, performance pass (profiling, worker meshing), content/sensitivity review of all text, README with screenshots/GIFs, release build.
- Stretch: Dvorak/Colemak/AZERTY layouts; tablet on-screen keyboard; async ghost sharing; teacher "classroom export" (CSV for many profiles).
- **Accept:** Lighthouse PWA + perf ≥ 90 on desktop profile; offline play verified in Playwright; bundle budget met; all budgets in §6.4 met on a throttled CPU (4× slowdown) run.

---

## 9. Testing strategy

1. **Unit/property tests** for everything in `engine/`, `save/`, content validators, adaptive logic. Treat the engine as safety-critical to learning outcomes.
2. **Keystroke-log replay tests**: record real sessions (`?record=1` dev flag), commit anonymized logs under `tests/fixtures/`, assert exact outputs.
3. **Simulated typists** (`tools/sim.ts`) for balance: fast/slow, accurate/sloppy, "pinky-weak" profiles. Assert stars/progress/difficulty targets stay in sane ranges.
4. **E2E (Playwright)**: scripted playthroughs of each mode using real `keyboard.type` with realistic delays; screenshot regression for the voxel scene at fixed seeds (software GL for determinism; allow small pixel tolerance).
5. **Accessibility**: axe-core in e2e on every menu screen; manual checklist for reduced-motion and keyboard-only.
6. **Performance**: Playwright trace with CPU throttle; budget assertions on frame time and bundle size in CI.
7. **Playtesting plan** (human, not automated): 3 kids per band, observe silently for 10 minutes, record where they stall. Feed findings into `docs/playtest-notes.md`. Include this as a real task for the owner; the implementer should leave a one-page facilitator script in `docs/`.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Scope is enormous | Strict phases; Phase 2 vertical slice is the go/no-go; modes share one engine; cut Minecart/Boss before cutting curriculum quality |
| "It's just a Minecraft clone" / IP exposure | §1 IP note; original art/audio/names; disclaimer; review all assets before release |
| Procedural art looks bad | Time-box atlas work; keep PNG override path; invest in palette ramps + AO + lighting rather than texture detail |
| Fun vs. learning imbalance | Adaptive difficulty; sims; playtests; keep typing as the verb, not a gate |
| Kids can't type fast enough for mob modes → frustration | No-failure design; waves scale to measured WPM; "calm mode" toggle removes timers entirely |
| WebGL perf on school Chromebooks | Budgets, quality scaler, lite 2D mode |
| Keyboard layout/IME edge cases | Layout-as-data, `event.key` matching, test matrix for dead keys |
| Word list safety | Blocklist + validator in CI + human review before release |
| Save data loss | Versioned migrations, export/import, autosave, corruption fallback that preserves the previous snapshot |

---

## 11. Out of scope (v1)
Accounts or cloud sync, multiplayer/real-time anything, chat, in-app purchases/ads, native mobile apps, languages other than English UI, voice recognition, user-generated shareable worlds on a server.

---

## 12. Instructions to the implementing agent

1. **Read this whole file first**, then create `CLAUDE.md` summarizing conventions so future sessions stay on track.
2. Work phase by phase. At the start of each phase write a short checklist in `docs/progress.md`; tick it off as you go; note deviations.
3. Keep the **engine pure** (§6.3). If you find yourself importing Three or the DOM in `engine/`, stop and refactor.
4. Write tests alongside code, not after. A phase isn't done until its acceptance criteria pass in CI-equivalent commands locally.
5. **Look at the game.** Run it, take screenshots with Playwright, and judge the aesthetic honestly: if it doesn't read as "blocky voxel world" at a glance, fix the lighting/palette/AO before adding features.
6. Prefer boring, small dependencies; justify each in `docs/decisions.md`. No runtime network requests.
7. Don't invent kid-facing copy carelessly: keep it warm, short, concrete, free of sarcasm and pressure language ("Almost! Try that key again" not "Wrong!").
8. When requirements conflict, priority order: **child safety/privacy > accessibility > learning effectiveness > fun/juice > visual polish > scope**.
9. Ask the owner (don't guess) only for: project name variants/branding, any paid asset or font purchase, publishing/hosting decisions, and anything that would send data off-device.
