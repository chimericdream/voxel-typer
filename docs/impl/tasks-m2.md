# Tasks: M2 Vertical slice (Mine mode on Meadow Home)

**Goal:** one biome, one mode, six lessons, fully juiced, saved, keyboard-only from splash to results. This milestone is the **go/no-go** (`README.md` §7). Quality matters more than breadth here: if time is short, cut lessons 5–6 before cutting feel.

Field legend: see the top of `tasks-m0-m1.md`.

---

### M2-01 Render core
- **Size/Tier:** M / A · **Review:** required
- **Depends on:** M1-13, M1-14
- **PLAN refs:** §5.1 (lighting, camera), §6.4
- **Owns:** `src/render/scene.ts`, `src/render/loop.ts`, `src/render/quality.ts`, `src/render/chunks.ts`, `src/render/lights.ts`, `src/render/camera.ts`, `src/render/index.ts`, `tests/unit/dom/render-loop.test.ts`
- **Spec:**
  - `createSceneHandle(canvas, opts) → SceneHandle` (`contracts.md` §8). WebGL2 renderer, `antialias: false` (pixel look), pixel ratio `min(devicePixelRatio, quality === 'high' ? 2 : 1)`, sRGB output, ACES tone mapping off (keep colors flat and saturated; record the choice).
  - Loop: `requestAnimationFrame` while any `onFrame` subscriber is active or a camera tween/FX is running; otherwise render-on-demand via `requestRender()`. Clamp `dt` to 50 ms. `hitStop` makes subscribers receive `dt = 0` for its duration.
  - `chunks.ts`: splits a `VoxelGrid` into 16³ chunks, meshes each with `meshChunk`, builds one `BufferGeometry` per chunk, one shared `MeshLambertMaterial` (vertex colors × atlas) for opaque and one for transparent (sorted, `depthWrite: false`). `markDirty(x,y,z)` rebuilds the affected chunk(s) next frame (neighbors too when on a border).
  - Lights: one directional sun (shadow map only on `high`, 1024², tight frustum around the diorama) + `HemisphereLight`. Point lights for `light`-tagged blocks capped at 4 on medium, 8 on high, 0 on low (emissive tint instead).
  - Camera rig presets `mine` (close, slightly low, looking at a target block in front of a scenic backdrop) and `overview`; tweens with ease-in-out; slow parallax drift (±0.5°) disabled by reduced motion.
  - Quality presets table (low/medium/high: pixel ratio, shadows, point lights, post) in `quality.ts`.
  - Expose `renderer.info.render.calls` to `__vt` (via a getter the app wires in M2-10).
- **Acceptance:**
  - [ ] Dev page `scene.html?seed=1&freeze=1` shows a random test grid lit with AO; screenshot baseline.
  - [ ] Editing one voxel rebuilds only the touched chunk(s) (unit test on `chunks.ts` with a fake mesher counter).
  - [ ] Loop stops requesting frames when idle (test with fake rAF).
  - [ ] `dispose()` frees geometries/materials/textures (counts via `renderer.info.memory` return to baseline in an e2e check).

### M2-02 Sky, clouds and day/night
- **Size/Tier:** M / A · **Review:** required (visual)
- **Depends on:** M2-01
- **PLAN refs:** §3.4 (day/night, voxel clouds), §5.1 (palette)
- **Owns:** `src/render/sky.ts`, `src/render/clouds.ts`, `src/content/biomes/env.ts`, `src/content/biomes/meadow.ts` (env part), `tests/unit/render/env.test.ts`
- **Spec:** Gradient sky dome (shader with 3 stops: zenith, horizon, ground) driven by `TimeOfDay` + `t01`; square sun and moon (flat quads, pixel edges); voxel clouds as an `InstancedMesh` of flat boxes drifting slowly (stopped by `?freeze`/reduced motion); fog color matches horizon. Biome env data: sky stops per time of day, fog density, sun color/intensity, hemisphere colors, ambient particle (pollen in meadow). `setEnvironment` lerps over 2 s.
- **Acceptance:**
  - [ ] Screenshots of meadow at `day`, `dusk`, `night`, `dawn` (`?freeze=1`) committed; visual review passes.
  - [ ] Env data validated by a unit test (every biome id has all four times of day once M5 adds the rest; for now only meadow is required and others fall back to meadow).

### M2-03 Meadow diorama
- **Size/Tier:** M / A · **Review:** required (visual)
- **Depends on:** M2-01, M2-04
- **PLAN refs:** §6.4 (diorama from noise + templates)
- **Owns:** `src/content/worldgen/noise.ts`, `src/content/worldgen/diorama.ts`, `src/content/worldgen/templates/*.ts`, `src/content/biomes/meadow.ts` (worldgen part), `tests/unit/worldgen/*.test.ts`
- **Spec:**
  - Pure worldgen: `generateDiorama(biome, seed, size) → VoxelGrid`. Heightmap from 2-octave value noise, terraced; grass on top, dirt 3 deep, stone below; a pond with water blocks; templates (oak tree ×3 variants, flower patches, a fence, a small path, rocks) placed with a seeded Poisson-disk sampler; a clear "stage" area in front of the Mine camera where the target block floats.
  - Size ≈ 64×24×64 (fits the draw-call budget at 16³ chunks after culling of empty chunks).
  - Water: a separate transparent mesh with a simple vertex wobble shader on top faces (disabled under reduced motion).
- **Acceptance:**
  - [ ] Same seed ⇒ identical grid (hash pinned).
  - [ ] The stage area is always clear (property over 50 seeds).
  - [ ] Draw calls for the diorama ≤ 60 at Medium (e2e via `__vt`).
  - [ ] Visual review: it reads as a cosy blocky meadow at a glance.

### M2-04 Block registry v1 and loot table
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M1-14
- **PLAN refs:** §3.3 (inventory, rarity), §5.1
- **Owns:** `src/content/blocks/terrain.ts`, `wood.ts`, `stone.ts`, `ores.ts`, `flora.ts`, `src/content/loot/meadow.ts`, `src/content/loot/types.ts`, `src/engine/loot.ts`, `src/i18n/en/blocks.ts`, `tests/unit/content/blocks.test.ts`, `tests/unit/engine/loot.test.ts`
- **Spec:**
  - ~30 blocks for Meadow and general use: grass, dirt, coarse-dirt, stone, cobble, gravel, sand, clay, oak-log, oak-planks, oak-leaves, birch-log (placeholder for M3), copper-ore, coal-like "char-ore", gem-ore ("meadowstone"), flowers ×4 (cross-shaped billboard blocks are out of scope; flowers are small cubes on top tiles), glass, lantern (light), mossy-cobble, brick, wool ×4 colors. All names original and kid-friendly; `typedName` one word, a–z only, ≤ 8 chars, no collisions.
  - Loot table: per biome, weighted entries by rarity. Rarity odds: `common` base; `uncommon` if streak ≥ 10 or target accuracy 1.0; `rare` if streak ≥ 25 (Sprout: 15); `epic` only on ore-vein bonus at streak ≥ 40 (Sprout: 25). Count = 1 + floor(wordLen / 4). **Speed never matters.**
  - `rollLoot` per `contracts.md` §18.
- **Acceptance:**
  - [ ] Registry invariants test: unique `id`, unique `num` within ranges, unique typeable `typedName`, every `nameKey` exists in i18n, recipes render.
  - [ ] Loot property: for any inputs, increasing streak never lowers expected rarity; speed is not an input at all (type-level check).

### M2-05 FX: particles, hit-stop, shake, float text
- **Size/Tier:** M / A · **Review:** required (feel)
- **Depends on:** M2-01
- **PLAN refs:** §3.4
- **Owns:** `src/render/fx/*.ts`, `tests/unit/dom/fx.test.ts`
- **Spec:** `FxApi` (`contracts.md` §8). Particles: pooled `InstancedMesh` (max 512 instances), each a small cube sampling the block's atlas tile, simple gravity + bounce on y = ground, fade by scale, lifetime 600–1200 ms. Hit-stop via the loop (M2-01). Shake: trauma model (`trauma += intensity`, offset = trauma² × noise, decays 1.5/s). Float text: DOM overlay positioned by projecting world coords (crisp text; uses UI kit font). Reduced motion: no shake, no hit-stop, particles reduced to 6 with no bounce, float text fades only.
- **Acceptance:**
  - [ ] Pool never exceeds max; 1000 bursts in a stress test keep instance count ≤ 512.
  - [ ] Reduced-motion flags verified in unit tests.

### M2-06 Audio synth and SFX
- **Size/Tier:** M / A · **Review:** required (feel)
- **Depends on:** M1-01 (can start in the M1 wave)
- **PLAN refs:** §5.2
- **Owns:** `src/audio/*.ts`, `src/dev/audio-lab.ts`, `audio-lab.html` (dev only), `tests/unit/dom/audio.test.ts`
- **Spec:** `contracts.md` §12. One `AudioContext`, buses with `GainNode`s, a compressor on master. SFX built from oscillators + filtered noise buffers (generated once, seeded): `break` per material (stone = short noise burst through bandpass ~1.2 kHz + low thump; wood = resonant knock; glass = high sine pings; dirt = soft lowpassed crunch, etc.), `chip` (quiet tick, pitch by crack stage), `chime` (pentatonic ladder by `pitchStep`), `thud` (gentle low sine, never harsh), `pop`, `click`, `star`, `levelUp`. Max 12 voices; voice stealing oldest. `speak` uses `speechSynthesis` with a kid-appropriate rate (0.85) and the first `en-*` voice; no-op otherwise. `audio-lab.html` has a button per SFX/material for listening.
- **Acceptance:**
  - [ ] Unit tests with a mocked `AudioContext` (hand-rolled fake) confirm bus routing, voice cap and `unlock()` idempotence.
  - [ ] Reviewer listens in `audio-lab.html` (or, if it can't hear, inspects the node graphs) and confirms the error `thud` is soft and non-punishing.

### M2-07 Voxel UI kit
- **Size/Tier:** M / A · **Review:** required (visual)
- **Depends on:** M0-01, M1-12, M1-14 (for palette ramps)
- **PLAN refs:** §5.1 (UI), §4.6
- **Owns:** `src/ui/kit/*.tsx`, `src/ui/kit/*.module.css`, `src/ui/kit/bevel.ts`, `src/ui/theme/tokens.css`, `src/ui/theme/themes.ts`, `src/dev/ui-kit.tsx`, `ui-kit.html` (dev only), `tests/unit/ui/kit.test.tsx`
- **Spec:**
  - Components: `Button` (chunky, pressed state on keydown/active, focus ring visible and thick), `Panel` (bevelled), `Slot` (inventory cell with count badge), `Hotbar` (9 slots), `ProgressBar` (segmented blocks), `Toast`, `Dialog` (focus trap, `Escape` closes), `Tabs`, `Toggle`, `Slider`, `Stars` (1–3 voxel stars, animated fill), `KeyCap`.
  - 9-slice bevels: `bevel.ts` paints small canvases (from palette ramps) and returns PNG data-URIs used in `border-image`. Generated once at startup, cached.
  - Design tokens as CSS custom properties: colors (warm day theme, cool night theme, high-contrast theme), spacing scale, `--text-scale` multiplier, fonts (`--font-pixel`, `--font-body`). Text on the 3D scene always sits on a semi-opaque plate; contrast ≥ 4.5:1 checked by a unit test that computes WCAG ratios for every token pair used for text.
  - All interactive components are keyboard-operable and have roles/labels.
  - `ui-kit.html` shows every component in every theme.
- **Acceptance:**
  - [ ] Contrast test passes for day, night and high-contrast themes.
  - [ ] Axe passes on `ui-kit.html` (e2e).
  - [ ] Visual review: reads as a chunky voxel/pixel UI; text is readable at Sprout size.

### M2-08 Fonts and typography
- **Size/Tier:** S / B · **Review:** required (license)
- **Depends on:** M0-01
- **PLAN refs:** §4.6, `README.md` §8.9
- **Owns:** `public/fonts/**`, `public/fonts/LICENSES/*`, `src/ui/theme/fonts.css`, `docs/fonts.md`
- **Spec:** Self-host Pixelify Sans, Atkinson Hyperlegible and OpenDyslexic as WOFF2 (Latin subset is enough). Verify each license **from the font's own repository** and copy the license text. `font-display: swap`; preload only the pixel font. Document sizes and sources in `docs/fonts.md`. Check Pixelify Sans legibility for `a/d/b/q/l/I/1` at 24 px; if any pair is confusable, use Atkinson for single-letter targets and record that.
- **Acceptance:**
  - [ ] Each font's license file is committed and named in `docs/fonts.md` with its source URL.
  - [ ] No network font requests in e2e (assert via request interception).

### M2-09 On-screen keyboard and hand overlay
- **Size/Tier:** M / B · **Review:** required (a11y)
- **Depends on:** M1-11, M2-07
- **PLAN refs:** §4.1 (fingering), §4.6 (colorblind patterns)
- **Owns:** `src/ui/keyboard/*.tsx`, `*.module.css`, `src/i18n/en/keyboard.ts`, `tests/unit/ui/keyboard.test.tsx`
- **Spec:** Renders a `LayoutDef`. Each finger zone has a color **and** a pattern (stripes/dots/checks/solid as CSS backgrounds) **and** a tiny finger label on hover/toggle, so color isn't the only cue. Highlights the next key (from `HudState.nextKey` → `codeFor`), including Shift when needed (the opposite-hand Shift, as taught). Bumps on F/J. Optional hand overlay: two blocky hands (SVG pixel art) with the active finger raised/lit. Flash on wrong key is a gentle wobble, not red flashing. Scales with `--text-scale`. Hidden entirely when `showKeyboard` is off.
- **Acceptance:**
  - [ ] For every printable char, the highlighted key and finger match the layout (table test).
  - [ ] Shift highlight uses the opposite hand.
  - [ ] Screenshot in each theme; readable in grayscale (reviewer converts screenshot to grayscale and confirms zones are distinguishable).

### M2-10 App shell, routing, input routing, test hooks
- **Size/Tier:** M / A · **Review:** required
- **Depends on:** M1-08, M1-09, M1-12, M2-07
- **PLAN refs:** §5.3, §6.5, §4.1 (break reminder)
- **Owns:** `src/main.ts`, `src/app/*.ts(x)` (except `events.ts`, `clock.ts` which exist), `src/app/routes.ts`, `src/app/debug.ts`, `src/app/test-hooks.ts`, `src/app/play-host.ts`, `src/ui/screens/Pause.tsx`, `src/i18n/en/app.ts`, `tests/unit/app/*.test.ts`
- **Spec:**
  - Screen state machine with typed routes (`splash`, `profiles`, `profileCreate`, `map`, `lessonIntro`, `play`, `results`, `island`, `inventory`, `achievements`, `settings`, `parent`, `privacy`; unimplemented routes show a friendly "coming soon" panel). `routes.ts` is append-only.
  - `play-host.ts`: given a lesson/mode id, resolves the mode (`registry`), builds `ModeContext`, mounts the shared `<canvas>` (one renderer for the whole app, reused across screens), forwards `typed` inputs to `ModeInstance.input`, handles `pause` (shows Pause overlay; Escape again or Enter resumes), drives `frame`, calls `dispose` on exit, collects `ModeResult`, updates the profile (progress, key stats fold, inventory, history, unlocks) and autosaves, then routes to `results`.
  - Global: Caps Lock watcher → `HudState.capsLock`; break reminder after `settings.breakReminderMin` of active play shows a kind "stretch break" overlay at the next target boundary (never mid-word).
  - Debug params and `window.__vt` per `contracts.md` §13; production build tree-shakes them (verify with a grep of `dist/` in an e2e or tool check).
  - Footer disclaimer text from `PLAN.md` §1 on splash and privacy screens.
- **Acceptance:**
  - [ ] Unit test: input routing sends `typed` to the mode only in `play`, and controls to menus otherwise.
  - [ ] Results update the profile exactly once per finished lesson (no double-save on rapid Enter).
  - [ ] `dist/` contains no `__vt` string.

### M2-11 Screens v1
- **Size/Tier:** M / B · **Review:** required (copy)
- **Depends on:** M2-10, M2-07
- **PLAN refs:** §5.3, §2
- **Owns:** `src/ui/screens/Splash.tsx`, `Profiles.tsx`, `ProfileCreate.tsx`, `LessonIntro.tsx`, `Results.tsx`, `Privacy.tsx`, `ComingSoon.tsx`, their CSS modules, `src/i18n/en/screens.ts`, `tests/unit/ui/screens/*.test.tsx`
- **Spec:**
  - Splash: logo built from voxel letters (CSS/SVG pixel art, original), "Press any key to start" (this unlocks audio), small privacy link, disclaimer.
  - Profile create: nickname (validated against blocklist, 1–16 chars, typed — it's typing practice too), age band picker with friendly descriptions, avatar skin color pick (4–6 options). Keyboard only.
  - Lesson intro: lesson title, the new keys as big `KeyCap`s with finger hints, a one-line goal ("Find the F and J bumps!"), Start.
  - Results: stars animate in one by one with `star` SFX, loot slots fill, personal-best badge, warm message chosen by outcome (never negative), buttons: Again / Next / Map. Raw accuracy shown as "Great aim: 94%" style for Miner/Builder, stars only for Sprout.
  - Privacy: kid-readable statement per `PLAN.md` §6.7.
- **Acceptance:**
  - [ ] Every screen keyboard-operable (unit tests with Testing Library-style queries on happy-dom, or e2e).
  - [ ] Copy review: every string in `screens.ts` follows `README.md` §4.4; Sprout-facing strings at a first-grade reading level.

### M2-12 Meadow content and lessons 1–6
- **Size/Tier:** S / A · **Review:** required (pedagogy)
- **Depends on:** M1-06, M1-10
- **PLAN refs:** §4.1, §4.2, §7.1, `README.md` §8.4
- **Owns:** `src/content/lessons/meadow.ts` (lessons 1–6), `src/content/wordlists/home-row.txt` (extend), `src/content/wordlists/meadow-*.txt`, `src/i18n/en/lessons-meadow.ts`, `tests/unit/content/meadow.test.ts`
- **Spec:** Lessons: 01 `f j` letters (intro, find the bumps); 02 `d k` + review `f j`; 03 `s l` letters → syllables; 04 `a ;` letters/syllables; 05 home-row words; 06 home-row words longer, short review. All in `mode: 'mine'`, accuracy targets 0.85, no `wpmRelative`. Sprout length ~25–40 chars; Builder ~60–80.
- **Acceptance:**
  - [ ] Each lesson generates ≥ 20 distinct targets over 10 seeds using only allowed keys (test).
  - [ ] A pedagogy reviewer confirms order and lengths are reasonable for a 6-year-old.

### M2-13 Mine mode
- **Size/Tier:** L / A · **Review:** required (feel + visual)
- **Depends on:** M1-03, M1-04, M1-05, M1-06, M2-01, M2-02, M2-03, M2-04, M2-05, M2-06, M2-10, M2-14
- **PLAN refs:** §3.2.1, §3.4, §4.1
- **Owns:** `src/modes/mine/**`, `src/i18n/en/mine.ts`, `tests/unit/modes/mine/*.test.ts`
- **Spec:**
  - Builds the session (`sequential`, policy per band/lesson), generates targets with `generateTargets` + `keyWeights` from the profile's key stats.
  - Scene: diorama backdrop, camera `mine` preset, a large floating target block in the stage area (block type chosen from the loot table's biome set, slow bob/rotate), the word shown in the HUD word display above it (crisp DOM text; per-char marks). For single-letter targets, also paint the glyph onto the block face (pixel font rendered to a small canvas texture).
  - Per correct char: crack stage advances (`floor(9 × typed / len)`), `chip` SFX pitched by stage, pickaxe swing (a simple voxel arm+pickaxe model in the lower-right, 120 ms swing), tiny particle puff.
  - Target complete: `hitStop(40)`, `burst` (count scaled by word length), `break` SFX by material, shake scaled by streak (capped), loot rolled and items fly to the hotbar (DOM animation from projected point to slot), next block slides in.
  - Wrong key: block wobbles (rotation spring), soft `thud`, the on-screen key wobbles, HUD banner "Almost! Try that key again" at most once per 5 s. **No damage, no lost progress.**
  - Streak: chime ladder per correct char in the current word; ore-vein bonus (a glowing ore block) appears every 15 streak (Sprout 10) and drops extra loot.
  - `hearAgain` speaks the current word (Sprout, TTS on).
  - On session end, `finish({ summary, loot, stars })`.
  - Pure parts (crack stage mapping, ore-vein schedule, loot fly queue) in `src/modes/mine/logic.ts` with tests.
- **Acceptance:**
  - [ ] Unit tests for `logic.ts`.
  - [ ] E2E (M2-15) plays meadow-01 and meadow-05 via `keyboard.type` with delays and reaches Results with ≥ 1 star.
  - [ ] Draw calls ≤ 150 at Medium.
  - [ ] Visual + feel review (screenshots of mid-word, break moment, results) passes.

### M2-14 HUD
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M2-07, M2-09, M2-10
- **PLAN refs:** §3.4 (hotbar combo meter), §4.6
- **Owns:** `src/ui/hud/*.tsx`, `src/ui/hud/bridge.ts` (implementation), `src/i18n/en/hud.ts`, `tests/unit/ui/hud.test.tsx`
- **Spec:** `contracts.md` §10. Word display (big, per-char marks: typed chars darken, the next char underlined and bouncing gently, wrong char shown with a wavy underline + pattern, not just red), combo hotbar, progress bar, banner, Caps Lock hint ("Caps Lock is on! Tap it to turn it off."), timer (hidden for Sprout/calm), on-screen keyboard mounted at bottom. Word display uses `--font-body` for words ≥ 4 chars and pixel font for single letters (unless M2-08 decided otherwise).
- **Acceptance:**
  - [ ] Mark rendering test for all four mark kinds.
  - [ ] HUD updates at 60 Hz don't re-render unrelated components (signal granularity test or render count check).

### M2-15 Vertical-slice E2E and baselines
- **Size/Tier:** M / B · **Review:** optional · **E2E:** yes
- **Depends on:** M2-11, M2-13, M2-14
- **PLAN refs:** §8 Phase 2 accept, §9.4, §9.5
- **Owns:** `tests/e2e/slice/*.spec.ts`, `tests/e2e/helpers/*.ts`, screenshot baselines under `tests/e2e/__screenshots__/slice/`
- **Spec:**
  - Helper `typeLikeAKid(page, text, { wpm, errorRate, seed })` that sends real key presses with realistic delays and occasional wrong neighbors.
  - Flows: (1) fresh launch → press key → create Sprout profile by typing → lesson 1 → results, keyboard only; (2) lessons 1–6 back to back on a Miner fixture; (3) pause/blur/resume doesn't change summary WPM; (4) reload persists stars and inventory; (5) screenshot baselines at fixed seed: splash, lesson intro, mid-word, results.
  - Axe on splash, profiles, profile create, lesson intro, results, pause.
  - Draw-call and FPS read via `__vt` with a soft assertion (logged) on SwiftShader.
- **Acceptance:**
  - [ ] All flows green twice in a row (flake check).

### M2-16 Playtest kit
- **Size/Tier:** S / C · **Review:** optional
- **Depends on:** M2-11
- **PLAN refs:** §9.7
- **Owns:** `docs/playtest-facilitator.md`, `docs/playtest-notes.md` (template)
- **Spec:** One-page facilitator script: setup (fresh profile, sound on), what to say ("This is a game you play with the keyboard. I can't help, but I'd love to watch"), what to watch (first 60 s, where they stall, whether they find F/J, reactions to mistakes), 3 questions afterwards (kid-friendly), a notes table. How to get the build in front of the kid: the Proxmox deployment from `deploy/README.md` (preferred), or `npm run build && npx vite preview` on a laptop.
- **Acceptance:**
  - [ ] Fits on one printed page.

### M2-FIX-2 Slice polish from the M2 reviews
- **Size/Tier:** M / B · **Review:** required (visual + a11y)
- **Depends on:** M2-13 (so the fixes can be seen in the real slice)
- **Owns:** the files named below, each a small change in another card's area
- **Spec:** non-blocking items collected from the M2 reviews. Fix them, or record why not.
  - Diorama (M2-03 review): the overview frames the island low and to the right with an empty
    front lawn (`camera.ts` framing); leaves read darker and bluer than the grass; flowers read as
    berry bushes (give flowers their own texture recipe); a fence post fills the left of the Mine
    view.
  - Sky (M2-02 review): dawn and dusk overview backgrounds are hard to tell apart; the fog never
    shows and the overview background is the ground colour, not the horizon; the dispose test only
    checks removal; the cross-fade e2e has no upper bound. The Meadow pollen particle is data only;
    render it or drop it.
  - UI kit (M2-07 review): the high-contrast hotbar's selected outline is 1.88:1 (its test checks
    the wrong neighbour); night empty stars are 1.2–1.6:1; Toggle ✓/✕ is cramped at scale 1; a
    Toast may not announce on first mount; a disabled "Locked" button can't be reached by keyboard;
    flat bevels.
  - HUD (M2-14): in high contrast `text` and `textMuted` are both white, so typed and pending
    characters differ only by the cursor's position.
  - FX (M2-05 review N4): changing biome while chips are alive re-uploads the old atlas texture.
  - Avatar (M2-11 review N5): the default avatar (8×8 head, flat brown hair band) is close to a
    famous default character; pick a different default look (IP rule).
- **Acceptance:**
  - [ ] Each item fixed, or listed in the handoff with a reason.
  - [ ] Baselines regenerated through the Update snapshots workflow; visual + a11y review passes.

### M2-FIX-3 Owner playtest fixes: age-aware stars, no extra space
- **Size/Tier:** M / B · **Review:** required (pedagogy + code)
- **Depends on:** M2-GATE
- **Owns:** `src/engine/stars.ts`, `tests/unit/engine/stars.test.ts`, the Mine-mode call site
  (`src/modes/mine/mine.ts`), the end-of-target handling wherever it lives (find it first), and
  the Results layout CSS
- **Spec:** from the owner's own play of the slice (2026-11-11) and the M2-15 handoff.
  - **Stars by age band** (decision 80; contract change approved, `contracts.md` §6). `StarInput`
    gains an optional `band?: AgeBand`. When it is missing, today's rules apply unchanged.

    | Band | 2nd star: accuracy ≥ | 3rd star: accuracy ≥ | 3rd star speed check |
    |---|---|---|---|
    | sprout | max(0.85, target − 0.05) | 0.90 | none |
    | miner | max(0.88, target − 0.02) | 0.93 | as now |
    | builder | max(0.90, target) | 0.95 | as now |

    `target` is `lesson.targets.accuracy`. Mine mode passes `ctx.band`. The mastery rule (≥ 2
    stars) stays. A pure table test covers every band at each boundary.
  - **No extra space at the end.** The owner had to press space after the last word of some
    words and phrases before the target finished. A target must finish on its last character.
    Spaces *between* words still count. Find where the trailing space comes from (the generator
    padding targets, the matcher, or Mine mode's "a word breaks on its trailing space"), fix it
    at the source, and test it. If the fix needs a frozen-contract change, stop and send a
    Contract change request.
  - **Results at 1280×720** (M2-15 handoff): the button row sits on the bottom edge and the
    "Next lesson" focus ring is clipped. Give it room.
  - **FX atlas swap** (`src/render/fx/index.ts`): the atlas-swap check also drops chips made before
    any atlas loaded. Drop them only when a previous atlas existed.
- **Acceptance:**
  - [ ] Star table tests per band; existing star tests still pass with no band.
  - [ ] A test proves a lesson's last word finishes without a trailing space.
  - [ ] Results buttons and focus ring fully visible at 1280×720 (baseline refreshed through the
    Update snapshots workflow).

### M2-FIX-4 Flowers as small sprigs, not full blocks
- **Size/Tier:** M / A · **Review:** required (visual + code; the mesher is a pure zone)
- **Depends on:** M2-GATE
- **Owns:** `src/content/blocks/types.ts` (the new optional field), `src/content/blocks/flora.ts`,
  `src/render/mesher/*`, `src/render/atlas/painters.ts` (flower painters), mesher tests
- **Spec:** the owner saw the Meadow's flowers as full-size blocks. Make each flower a small
  plant inside its cell: a thin stem and a small bloom built from a few sub-voxel boxes, about
  ⅜ of a block wide and ⅝ tall, bloom in the flower's colour. **Not** crossed billboard quads:
  that look belongs to a famous game (IP rule). Approved additive contract change: `BlockDef`
  gains `shape?: "cube" | "sprig"` (missing = cube). A sprig cell never culls its neighbours'
  faces and casts no AO. Keep flowers out of Mine mode's breakable set. Draw calls must not
  grow: sprigs go in the chunk mesh, with the chunk's material.
- **Acceptance:**
  - [ ] Mesher unit tests: sprig geometry, no face culling against sprigs, determinism.
  - [ ] Meadow baselines refreshed through the Update snapshots workflow; draw calls unchanged.
  - [ ] Visual review: flowers read as flowers at overview and play distance.

### M2-GATE (go/no-go)
Orchestrator + reviewer + 👤 owner.
- `PLAN.md` Phase 2 acceptance. "A 6-year-old completes lesson 1 without instructions" and "60 fps on integrated GPU" are 👤: the orchestrator tells the owner the `:edge` image is ready to deploy on Proxmox (or the owner promotes it by tagging `m2` once the automated checks pass), hands over the playtest kit, and **waits for the result**.
- Visual review (`README.md` §5.3) of the slice. If it doesn't read as a voxel world at a glance, fix lighting/palette/AO first (new `M2-FIX-*` tasks).
- Decision recorded in `docs/progress.md`: **go**, **go with fixes**, or **stop and rethink**. Tag `m2`.
