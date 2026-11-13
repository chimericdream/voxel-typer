# Decisions

A dated log of decisions, newest section last. **DECISION** means the choice is made; don't
reopen it without the owner. **ASK OWNER** marks the few things that still need the owner. Each entry
names its source.

The orchestrator owns this file (`docs/impl/contracts.md` §0). Workers write their decisions in their
handoff notes, and the orchestrator copies them here.

## 2026-11-10: execution plan (`docs/impl/README.md` §2 and §8)

### Model routing and workers (`README.md` §2)

1. **Model assignment (owner).** Fable 5.2 (✦ in `task-graph.md`) gets the 10 most complex cards:
   M1-01 contracts, M1-03 typing session, the four big modes M2-13 Mine, M4-04 Night Defense, M4-07
   Builder and M5-01 Minecart, the M3-04 world map, and the three art-direction cards M4-03 mobs,
   M5-03 bosses and M5-07 biomes 5–9 art. Opus 5.5 gets everything else: all other worker cards
   (including the large content cards M3-02 and M5-05), the orchestrator, and all reviewers.
   Escalation: if an Opus card fails review twice, re-run it on Fable and note it here. Don't move
   cards to Fable for any other reason without asking the owner.
2. **At most 3 workers at once (owner).** More would raise merge pressure on the few shared files.

### Clarifications and corrections to `PLAN.md` (`README.md` §8)

3. **§8.1 Phase sequencing.** `PLAN.md` §8's "don't start a phase until the previous one is green"
   applies to milestone gates and integration tasks. Leaf tasks whose dependencies are merged may
   start early (for example, the word-list pipeline runs in parallel with the engine).
   `task-graph.md` encodes this.
4. **§8.2 Bosses.** There are 9 boss slots, one per biome. The 5 named bosses go to Meadow (Cobble
   Colossus), Frosty Peaks (Frost Wyrm), Mushroom Marsh (Mushroom Monarch), Sparkstone Factory
   (Sparkstone Sentinel) and Sky Citadel (Sky Hydra). The other 4 use names the owner approved for
   now: Bramble Stag (Birch Forest), Tidecrab King (Sandy Shore), Lantern Mole (Deep Mines) and Prism
   Moth (Crystal Caverns). M5-03 designs them.
5. **§8.3 Bosses before M5.** Biomes 1–4 ship in M3, but the boss framework is M5. Until then each
   biome's final lesson is a mastery check in Mine mode. The boss lesson exists in data with
   `mode: 'boss'` and falls back to Mine (`contracts.md` §7.3).
6. **§8.4 Home row.** Meadow introduces `a s d f j k l ;` and then `g h` (index-finger stretch) in its
   last lessons, because without `g` and `h` there are too few real words for a whole biome.
   Bottom-row punctuation (`, . /`) stays in Crystal Caverns.
7. **§8.5 Sparkstone Factory is a side branch.** It unlocks from Crystal Caverns for any band, is
   suggested only to Builder band, and is not required to unlock Sky Citadel.
8. **§8.6 Lighthouse PWA score.** Lighthouse removed its PWA category in v12, so "Lighthouse PWA ≥
   90" can't be measured. M6 checks instead: the manifest is valid, the service worker registers, the
   app is installable (Chromium's `beforeinstallprompt` fires in Playwright), and offline play
   passes. Lighthouse performance ≥ 90 on desktop stays.
9. **§8.7 Bundle budget.** `PLAN.md`'s 5 MB gzipped initial JS is a hard ceiling. The working budget
   is ≤ 450 KB gzipped initial JS with game modes lazy-loaded (`contracts.md` §14). `npm run size`
   fails at the working budget.
10. **§8.8 Things an agent can't verify alone** (👤 in the gates): "a 6-year-old completes lesson 1
    without instructions", "60 fps on an integrated GPU", the human sensitivity review of content, and
    the playtests. Agents supply proxies (frame-time traces under 4× CPU throttle on SwiftShader, a
    facilitator script, a content dump for review) and ask the owner for the real check.
11. **§8.9 Fonts.** Defaults, each SIL OFL and self-hosted: Pixelify Sans (pixel headings and HUD),
    Atkinson Hyperlegible (body text) and OpenDyslexic (dyslexia toggle). M2-08 checks each license
    in the font's own repository, commits the license files to `public/fonts/LICENSES/`, and records
    the source here. A font whose license isn't OFL or similar is swapped for one that is, with the
    reason recorded. **ASK OWNER** before buying any font.
12. **§8.10 Running TypeScript tools.** `tools/*.ts` run through `tsx` (dev dependency), not Node's
    built-in type stripping, so source files can use normal extension-less imports.
13. **§8.11 Determinism hooks.** Fixed seeds, a frozen clock and a way to read game state are
    specified once in `contracts.md` §13 (URL debug params and `window.__vt`) and stripped from
    production builds.
14. **§8.12 Owner answers.** Agents open one PR per task (`README.md` §3). GitHub Actions tests as
    much as possible (M0-03). The game is self-hosted on the owner's Proxmox server for their kids.
    The repo is public, so Actions minutes aren't a constraint: keep the full CI matrix (sharded e2e
    on every PR, nightly 3× flake runs). The owner will make the GHCR package public when deployment
    starts (M0-05), so Watchtower needs no token.
15. **§8.13 Hosting.** The same pipeline as the owner's home dashboard: GitHub Actions builds a
    container image and pushes it to GHCR, and the Proxmox host runs it with Docker Compose (Debian
    LXC or small VM) while Watchtower pulls new images. It's pull-based, so the server needs no
    inbound access from GitHub.
    - Image `ghcr.io/chimericdream/voxel-typer`: static `dist/` served by an unprivileged web server
      (nginx or Caddy, alpine) with the M6-06 security headers and correct caching (hashed assets
      immutable; `index.html`, `sw.js` and the manifest `no-cache`).
    - Tags: `:edge` and `:sha-<sha>` on every merge to `main`; `:stable` and `:m<N>` (later
      `:v1.x.y`) on milestone and release tags. The kids' instance follows `:stable`. An optional
      second container on `:edge` is for the owner to preview.
    - Packaging lands early (M0-05), so the owner can host the M2 slice for the go/no-go playtest.
    - HTTPS is required: service workers and `crypto.randomUUID()` need a secure context. **The owner
      chose Tailscale** (a sidecar with `tailscale serve` HTTPS on a `*.ts.net` name), over a LAN
      reverse proxy with a DNS-01 certificate or Caddy's internal CA. The app must still work, minus
      offline and install, over plain HTTP: every secure-context API is feature-detected with a
      fallback (`contracts.md` §15).
    - Kids' devices on the LAN only, no ports exposed to the internet (`PLAN.md` §6.7).
16. **§8.14 Scope cuts (owner).** Not in v1, and not to be built unless the owner asks again:
    Dvorak/Colemak/AZERTY/QWERTZ layouts, tablet/touch on-screen keyboard input, and async "ghost"
    runs. Layouts stay data-driven, and en-US and en-GB still ship (M1-11). Touch devices get the
    friendly "keyboard required" message (`PLAN.md` §6.5) and nothing more. The classroom report
    (many profiles to CSV) is deferred, because a product for schools would bring its own design
    questions (accounts, sync, school privacy rules). Don't build it, but don't block it: keep the
    per-profile CSV export (M3-11) and the export-all JSON (M1-09) clean and documented.

## 2026-11-10: M0-01 toolchain scaffold and orchestrator

Sources: `docs/handoffs/M0-01.md` and the orchestrator's review of PR #89.

17. **Boundary tools use `oxc-parser`, not the TypeScript compiler API.** TypeScript 7.0.2 (the
    native compiler) has no stable JS compiler API, so `tools/check-*.ts` parse with `oxc-parser`. This
    differs from the M0-01 card; the orchestrator accepted it.
18. **Type-aware Oxlint is on** (`oxlint-tsgolint`). `typescript/no-unsafe-type-assertion` is strict:
    parse JSON into `unknown` and narrow it with type guards.
19. **How purity is enforced.** Oxlint handles imports, globals and properties natively.
    `tools/check-boundaries.ts` covers relative imports into forbidden folders, `@/…/../` specifiers,
    `globalThis`/`self`/`window` access to banned globals, and zero-argument `new Date()`/`Date()`.
    `idb` is also banned in pure zones. In Oxlint 1.93 a `*` in an import pattern matches one path
    segment, so the patterns use `/**` (review fix on PR #89).
20. **Pure zones may import `@/render/mesher/**` and `@/render/atlas/recipes` from any pure zone.**
    `BlockDef.faces` and `Profile.island` need it.
21. **Build tools are devDependencies.** The runtime dependencies are only `preact`,
    `@preact/signals`, `three` and `idb`.
22. **The e2e build goes to `dist-test/`** (`vite build --mode test`), separate from the production
    `dist/`.
23. **esbuild's postinstall script is denied** (`allowScripts`). Its binary comes from the optional
    platform dependencies.
24. **Oxfmt ignores `PLAN.md` and `docs/impl/**`**, the orchestrator-owned plan docs.
25. **Live task status is one GitHub issue per card,** with labels `status:*`, `model:*`, `tier-*`,
    `gate`, `owner` and `deferred`, and milestones m0–m6 (`HANDOFF.md` §5). M6-11 (classroom report)
    is closed as not planned.
26. **Open for M1-01:**
    - `src/render/atlas/painters.ts` must join the pure zone, because `recipes.ts` needs it.
    - `Material` should move from `src/audio/types.ts` into `src/types/core.ts`, because the pure
      `src/content/blocks/types.ts` may not import `@/audio`.

## 2026-11-10: M0-02 docs and copy lint

Source: `docs/handoffs/M0-02.md`.

27. **The copy lint is a script, `tools/check-ui-literals.ts`,** not an Oxlint JS plugin. Oxlint 1.93
    marks JS plugins as alpha and outside semver. The script uses `oxc-parser`, like
    `check-boundaries`, and runs at the end of `npm run lint`.
28. **What the copy lint flags** in `src/ui/**/*.{tsx,jsx}`: JSX text, string literals used as JSX
    children (including both branches of `?:` and either side of `&&`, `||`, `??`, and template
    literals), and string literals in the text props `title`, `alt`, `placeholder`, `aria-label`,
    `aria-description`, `aria-placeholder`, `aria-roledescription` and `aria-valuetext`. Text with no
    Unicode letter (numbers, punctuation, symbols, whitespace) is allowed. HTML entities are decoded
    first, so `&nbsp;` passes.

## 2026-11-11: M0-03 CI

Source: `docs/handoffs/M0-03.md`.

29. **`ci-ok` is the only required check.** It passes only when every other `ci.yml` job passed.
    Branch protection on `main`: strict (up to date), `ci-ok` from GitHub Actions, no force pushes or
    deletions.
30. **Snapshot commits get checks through a dispatch.** `update-snapshots.yml` ends with
    `gh workflow run ci.yml --ref <branch>`, because `workflow_dispatch` is the one event a
    `GITHUB_TOKEN` push may start. Baselines are made only on CI's Linux runner.
31. **Dependency review is skipped while the repo's dependency graph is off.** `npm audit --omit=dev`
    always runs. **ASK OWNER:** turn the dependency graph on; no CI change is needed.
32. **Content checks discover tools by name** (`tools/validate-*.ts`, `tools/i18n-keys.ts`,
    `tools/gen-curriculum-doc.ts` plus a dirty check on `docs/curriculum.md`), so later cards add a
    tool and CI picks it up.
33. **Coverage thresholds switch on at M1-GATE** through the repo variable `COVERAGE_THRESHOLDS`.
34. **No third-party actions** besides `actions/*`, `github/codeql-action` and (M0-05) `docker/*`.
    All are pinned to a full SHA with the version in a comment.
35. **`/update-snapshots` works only from the repo owner's comments,** never on `main` or fork PRs.
    Workers on Windows post it with `MSYS_NO_PATHCONV=1` or from PowerShell, because Git Bash
    rewrites the leading `/`.

## 2026-11-11: M0-04 hello voxel, M0-05 container image, M0-FIX-1 CI hardening

Sources: `docs/handoffs/M0-04.md`, `docs/handoffs/M0-05.md`, `docs/handoffs/M0-FIX-1.md`, and the
orchestrator's reviews of PRs #94, #96 and #97.

36. **Hello voxel is a throwaway** (`src/dev/hello-voxel.ts`): a `DataTexture` cube with unlit tinted
    faces, so the screenshot is exact. M2's atlas and render core replace it.
37. **The image is nginx, not Caddy:** `nginxinc/nginx-unprivileged:alpine` on 8080, non-root, with a
    read-only root filesystem. Security headers are set only at server level (per-path values through
    `map`), and a unit test enforces it. Only `/assets/` is `immutable`; everything else is
    `no-cache`. No Brotli (M6-06 may revisit it).
38. **Image tags:** `:edge` and `:sha-<short>` on each green CI run of `main` (`:edge` moves only to
    main's current head). `:stable` and `:<tag>` on an exact milestone tag (`m<N>`) or release tag
    (`v<X.Y.Z>`). Other tag names are refused. A tag **promotes** the `:sha-` image CI already
    published (`docker buildx imagetools create`), so `:stable` is the same image that ran as
    `:edge`. It rebuilds only if that `:sha-` image is missing (M0-GATE change).
39. **Deploy:** Docker Compose with a Tailscale sidecar (`network_mode: service:tailscale`,
    `tailscale serve` HTTPS on a `*.ts.net` name). Watchtower is scoped to `voxel-typer`, so it can't
    touch other projects' containers. Never turn on Tailscale Funnel. Roll back with
    `VOXEL_TYPER_TAG=m<N>` in `deploy/.env`. `.env` files are git-ignored (M0-GATE), because
    `deploy/.env` holds `TS_AUTHKEY`.
40. **Every workflow runs steps with bash** (`defaults.run.shell: bash`). Steps in container jobs
    otherwise run under `sh`, which broke the first `/update-snapshots` run on `set -o pipefail`.
41. **CI starts the image the way the server runs it:** `--read-only --tmpfs /tmp --cap-drop ALL
    --security-opt no-new-privileges`.
42. **`/update-snapshots` comments become dispatches,** and the whole update-and-push sequence runs
    under one per-branch concurrency group. The job that runs Playwright has a read-only token and no
    npm cache. Only `*.png` files cross to the job that pushes, which refuses symlinks.
43. **actionlint runs inside `ci.yml`,** so a broken workflow turns `ci-ok` red.

## 2026-11-11: M0 gate

44. **Purity enforcement becomes an allow-list (M0-FIX-2).** A pure-zone file may import only other
    pure-zone files, plus type-only imports from anywhere. Pure zones don't get the browser globals.
    The M0 review showed the old deny-list missed transitive imports (`src/engine` → `@/save/store` →
    `idb`) and globals such as `crypto` and `fetch`.
45. **Open for M1-01:** contracts §0 puts `import.meta.glob` aggregators in `src/content/*/index.ts`,
    but `tools/*.ts` run under tsx, which doesn't support `import.meta.glob`. M1-01 decides how tools
    such as `tools/sim.ts` and `tools/validate-*.ts` load content (for example, tools import the data
    modules directly, and only the app imports the aggregators).

## 2026-11-11: M1-01 contracts into code, and the contract freeze

Sources: `docs/handoffs/M1-01.md` and the reviewer's report on PR #101 (no blocking issues; every
type in §1–§18 matches `src/`).

46. **Contracts are frozen** as of M1-01 (9564af6), with the corrections below folded in before the
    freeze. From here, change a contract only through `README.md` §4.3.
47. **Tools load content through pure loaders (resolves decision 45).** Each content folder has a Vite-only
    `index.ts` aggregator (`import.meta.glob`, for the app) and a pure `load.ts` that takes
    already-loaded modules (`lessonsFromModules`, `blocksFromModules`). `tools/*.ts` feed the loaders
    with direct imports or `node:fs`. A test checks both paths give the same list.
    `src/content/collect.ts`, `src/content/*/load.ts` and `src/content/layouts/types.ts` are
    orchestrator-owned (contracts §0).
48. **`allowedKeysFor(lessons, lessonId, opts?)`** replaces `allowedKeysFor(lessonId)`. The old
    signature could only read the glob aggregator, so tools couldn't call it, and it had no input for
    "the profile unlocked sparkstone". The allowed set now explicitly includes the lesson's own
    `newKeys` (matching the `Lesson` comment "allowed = all keys up to this lesson").
49. **`src/types/` is a pure zone,** so pure code may import `BIOME_ORDER`. A test pins
    `BIOME_ORDER` to exactly the `BiomeId` union, in order.
50. **`Material` lives in `src/types/core.ts`** (contracts §1) and is re-exported from
    `src/audio/types.ts` (§12).
51. **Provisional types** `Palette`/`PaletteRampId` (owner M1-14), `LootTable` (M2-04) and `LiteCanvas`
    (M6-04) have minimal M1-01 shapes. The owner card sets the final shape without a contract change
    request (contracts §1 table).
52. **`fixedStepClock` advances on every `now()` call.** Under `?freeze`, only the frame loop calls
    `clock.now()`, once per frame, and passes the time down (contracts §13). M2-01 owns the loop.
53. **Mode modules export a named `mode: ModeModule`** from `src/modes/<folder>/index.ts`; the
    registry keys modes by `mode.id`. `resolveMode` falls back to `mine` and throws if `mine` is
    missing (true until M2-13). Discovery is injectable: `createModeRegistry(discovered, opts)`.
54. **M1-01 conventions for later workers:** stubs keep contract parameter names and mark them with
    `void`; placeholder modules (`engine/matcher.ts`, `engine/stars.ts`, `render/atlas/painters.ts`,
    `a11y/index.ts`) are `export {}` plus an Oxlint disable that the owner removes; tests import
    `src/` by relative path (type-aware Oxlint doesn't resolve `@/` under `tests/`);
    `types.test-d.ts` runs under `npm run typecheck`, not Vitest. M1-01 created some files that later
    cards own (`src/i18n/en/common.ts` → M1-12, `layouts/index.ts` → M1-11, `input/*` → M1-08,
    `save/*` → M1-09, and others in the handoff note); those cards replace the stubs.

## 2026-11-11: M1 engine and foundation lanes, and the M1 gate

Sources: the handoff notes in `docs/handoffs/M1-02.md` … `M1-14.md`, the review comments on their
PRs, and the orchestrator's rulings in those PRs.

55. **Delegation.** After the 5-hour cap, the owner briefly routed work to Codex and OpenCode, then
    stopped all non-Claude delegation. Workers and reviewers are Opus (Fable for ✦ cards), as in
    `HANDOFF.md` §6.
56. **Typing session rulings (M1-03, PR #103, written into contracts §3).** In `sequential`, a key fed
    when no target remains is ignored (no event, not a keystroke). Under `lockOn` + `stay`, Backspace
    while locked unlocks the target and resets its progress. `TargetView.marks` has
    `text.length + 1` entries while a trailing space is required. `consistency` uses the population
    standard deviation. A pause in progress never counts toward a target's duration.
57. **Stats and stars (M1-04, PRs #106 and #110).** `summarize` takes the session's
    `SummaryContext`. Stars stay additive as contracts §6 is written. Folding a session into key or
    bigram stats now reschedules SRS with `scheduleSrs`. M1-07 should still decide whether bigrams
    need a minimum-attempts threshold before an interval doubles.
58. **Adaptive engine (M1-05, PR #104; tuned in M1-07, PR #115).** `weakKeys` ties keep `allowed`
    order (digit keys included), and a non-positive target latency counts as "not slow". The
    simulator retuned `errorWeight` 6 → 10 and `latencyWeight` 1.5 → 1 (evidence in `docs/sim.md`).
    The §4 formula text keeps the starting values; `ADAPTIVE_CONSTANTS` is the source of truth.
59. **Content generator (M1-06, PR #111).** Rule priority: allowed set, then a small
    `BLOCKED_RUNS` list for random letters, then no char more than 3 times in a row, then the
    comfort cap. `capitalize: 'first'` capitalizes the first char of every target.
60. **Input (M1-08, PR #114; additive contract change to §9).** `InputCtx = { inPlay; band?; undo?;
    wantsEnter? }`. Cmd+Z (plain Meta+Z) is Undo like Ctrl+Z when `ctx.undo` is on; the Shift
    variants are not redo.
61. **Save layer (M1-09, PR #108; additive contract change to §15).** An older build never writes
    over a newer-schema record: `save` throws `NewerSaveError` and writes nothing, and `load` returns
    `null` instead of the older `prev`. `load` and `listProfiles` never reject on storage failures.
    `createIdbStore`/`createMemoryStore` take an optional `onProblem` callback (`restoredPrev`,
    `unreadable`, `newerVersion`, `storageError`) so the UI can tell families about a restored save.
    Records are migrated before they are validated. **Open for M3-12:** export leaves out newer or
    unreadable profiles without saying so; the export screen must list them. Autosave must catch
    `NewerSaveError`.
62. **Word lists (M1-10, PR #112).** The blocklist is strict and matches inflections and look-alike
    spellings. It also excludes everyday words such as kiss, ghost, monster, sword, gravy and
    hangman; the owner can loosen it at the M6-08 content read-through. The Dolch list was written
    from memory and checked against the standard list by the reviewer. **M1-FIX-1** fixes the false
    positives that block sentence content (contractions, numbers) and adds the missing terms.
63. **Voxel grid (M1-13, PR #109).** The grid rejects wrong-length data, non-integer sizes and ids
    outside 0–65535; `fromJSON` caps grids at `MAX_GRID_CELLS` (2^24) and sums run lengths before it
    allocates. **Open for M2-01:** confirm the AO quad-diagonal split looks right on screen.
64. **Atlas (M1-14, PR #113).** The orchestrator's visual review found the set original. It follows
    genre conventions closely in a few places (grass side "drips", 16 knit wool colors, ore specks,
    the `grass-block` id); flagged to the owner, not blocking. `atlas.html` is in the test build only.
65. **GitHub Actions outage (2026-11-11, ~20:18 UTC).** Runs queued with zero jobs. After local
    `npm run verify` on each branch merged with `main`, the owner admin-merged #112, #113, #115 and
    #116. #116 sets `DOCKER_BUILD_RECORD_UPLOAD: "false"` in `publish.yml`, so an artifact-service
    error can't fail a publish after the image is pushed.
66. **M1 gate.** Coverage thresholds are on for good (`src/engine/**` lines ≥ 95%; every engine
    module is at 98–100%). Timing tests use their relaxed bound when coverage is on (`VT_COVERAGE`),
    since instrumentation slows them down. Phase 1 acceptance (`PLAN.md` §8) holds: the generator
    safety property (2000 cases, M1-06), hand-computed WPM fixtures (M1-04), deterministic replay of
    every fixture log and a byte-identical sim run for a seed (M1-07).
67. **Delegation (2026-11-11, owner).** Workers and reviewers run on Claude only: Fable 5.2 for ✦
    cards, Opus 5.5 for the rest. Codex and OpenCode are not used for new tasks.
68. **Fonts (M2-08, PR #126).** Pixelify Sans from `github.com/eifetx/Pixelify-Sans@39df74a`,
    Atkinson Hyperlegible 1.393 from `github.com/googlefonts/atkinson-hyperlegible@1cb3116`,
    OpenDyslexic from `github.com/antijingoist/opendyslexic@1824da5`; all SIL OFL 1.1, shipped as
    the upstream WOFF2 files byte for byte (no subsetting, so OpenDyslexic's Reserved Font Name
    holds). **Every typing target, single letters included, uses `--font-body` (Atkinson):**
    Pixelify mirrors b/d and p/q and nearly merges 1/l. This overrides the M2-13 and M2-14 cards'
    "pixel font for single letters". Pixelify stays for headings and HUD chrome.
69. **Speech stays on the device (M2-06, PR #125).** `pickVoice` accepts only `localService`
    English voices and never falls back to the browser default; with none, `speak` does nothing.
    On Chrome for Linux and some Chromebooks that means no read-aloud, and "hear again" is hidden.
70. **Gem ore is rose, not teal (PR #124),** to keep clear of another game's iconic ore colour.
71. **Rendering (M2-01, PR #122; M2-02, PR #131).** The loop idles when nothing moves; camera drift
    is on only during live play. `dispose()` forces WebGL context loss. Day lighting is pinned by a
    test; night stays mid-navy so the HUD stays legible. `t01` means progress through the given
    time of day (default 0.3, pinned under `?freeze`).
72. **Water stays the `glass` Material (M2-03, PR #132):** no `'water'` in the union, so no contract
    change. The water wobble never wakes the loop and is off under reduced motion and `?freeze`.
73. **App shell (M2-10, PR #129).** One scene for the whole app. `dist/` must contain no `__vt` or
    fixture paths (`tools/check-dist-hooks.ts` runs after every build). The copy lint covers
    `src/app/**/*.tsx`. "Hear again" reaches the mode as the `app:hearAgain` bus event.
74. **Theme on `<html>` (M2-11, PR #134).** `:root[data-theme]` keeps `font-size: 100%` and the
    scaled base size moves to `<body>`; otherwise every `Nrem × --text-scale` kit size scaled twice.
75. **Kids never see a raw low score (M2-11 review, PR #134).** Results show "Good aim"/"Great aim"
    at 70 %+ for Miner and Builder and no aim line below that; Sprout sees stars only.
76. **HUD wrong-key channel (M2-14, PR #137).** A mode reports each engine `wrong` event with
    `reportWrongKey(ctx.hud, got)`, which writes `HudState.custom.wrongKey`; the on-screen keyboard
    gates repeats. One HUD message at a time; the Caps Lock hint wins over the banner.
77. **Content safety (M3-02 PR #128, M5-05).** Besides the blocklist: no explosion words (owner
    decides at M6-08), no drinking readings (checked across word pairs), no brand or product names.
    Meadow's keys spell only about 45 safe words, so its pools fall short of the size targets and
    are padded with g/h phrases, not invented words. **Owner question for M6-08:** "Alex" and
    "Steve" are blocked as nicknames (trademark terms).

78. **M2-GATE: go with fixes (owner, 2026-11-11).** The owner played the whole slice and found it
    fun. Their kids were asleep, so the child playtest moves to M3-GATE. The fixes are M2-FIX-3
    and M2-FIX-4; they run alongside M3 and M4.
79. **The stack stays, and local test load stays light (owner, 2026-11-11).** Three workers
    running verify plus repeated SwiftShader Playwright runs made the owner's PC nearly unusable,
    and the owner considered Unity. With nothing else running, the game measured 200+ fps in Edge
    (separate graphics card), so the browser stack stays. Rules:
    - **7:30am–12am local time:** at most 2 workers, no local e2e (CI does it), one `verify` per
      push.
    - **12am–7:30am:** up to 3 workers, local e2e allowed.

    "60 fps on an integrated GPU" is not yet shown; it moves to M3-GATE.

80. **Stars depend on the age band (owner, 2026-11-11; contract §6, additive).** 3 stars stays the
    top. `StarInput.band?` loosens the accuracy bars:
    - Sprout: 0.85 and 0.90, no speed check.
    - Miner: 0.88 and 0.93.
    - Builder: unchanged at 0.90 and 0.95.

    A missing band means Builder rules.

81. **A target finishes on its last character (owner, 2026-11-11).** Kids must not press space
    after the last word. Spaces between words still count. M2-FIX-3.
82. **Flowers are small sprigs (owner, 2026-11-11).** `BlockDef.shape?: "cube" | "sprig"`
    (additive). They are sub-voxel boxes inside the cell, not crossed billboards, which belong to
    another game's look. M2-FIX-4.
83. **Mine mode (M2-13, PR #141).** Keys are dropped until the Meadow has loaded, so tests wait for
    `__vt.session()?.active`. A word breaks on its trailing space; decision 81 changes this for the
    last word. The session clock starts when the first block shows, about 0.4 s after the first
    key. That slightly favours the child, so it stays.
84. **Slice polish (M2-FIX-2, PR #143).** Flowers got their own painters, the default avatar was
    redrawn (IP rule), the hotbar is dark oak, and the high-contrast HUD tells typed characters
    apart from pending ones.
85. **The slice e2e suite (M2-15, PR #142)** covers 5 flows, plus axe on 6 screens.
    - Draw calls and fps are logged, not asserted, on SwiftShader. Draw calls peaked at 21–28.
    - E2E waits count frames, not wall time, because CI's software renderer runs frames slowly.
    - Text checks are limited to `#app`, because toasts also go to a live region outside it.
86. **E2E flakes.** The `fx.spec` loop-idle check waits up to 45 s; CI needs 9–11 s. The pause flow
    times key and blur events on the page's own clock. One rerun of a failed CI job is allowed for
    a known flake; a second failure is a bug.
87. **World map layout (M3-04, PR #148).** The lesson path sits in a panel beside the island, not
    drawn on it: stars and numbers on voxel textures were hard to read. Escape on the map overview
    goes to "Who is playing?", following PLAN §5.3's screen order. This is an exception to the
    shell's "Escape goes back", which would return to the lesson just played.
88. **`CameraRig.moveTo(pose, { durationMs })` and `AppApi.scene()` are additions (M3-04).**
    They don't change a frozen contract: `AppApi` and `AppScene` aren't in contracts.md. A screen
    may draw in the shared scene through `AppApi.scene()`; there is still one WebGL context.
89. **Map islands use map-only voxel kinds (M3-04).** The block registry has only Meadow's blocks so
    far, so islands are painted from biome palettes, not registry blocks.
90. **Mine ignores a habit space between blocks (M2-FIX-3 review B1, PR #147).** With decision 81, a
    space with nothing of the current block typed is dropped, not counted as a slip. Mine lessons
    are about 20–33 % fewer keystrokes, because the length budget counted spaces. Before the
    M3-GATE playtest, reset dev profiles, because older sessions counted spaces in their WPM.
91. **Flower sprigs (M2-FIX-4, PR #149).** A sprig is four sub-voxel boxes (20 faces) inside its
    cell, turned a quarter by a fixed hash of (x, z). The mesher treats it as air for its
    neighbours, so it hides none of their faces and gives or takes no AO. `AtlasLookup.shape?` is
    an additive contract change (contracts §8.2). `splitByBucket` samples 1/64 of a block behind a
    face instead of half a block. The bloom stays 6/16 wide; to make flowers stand out more at
    overview, brighten the top tile first.
92. **Placement test (M3-05, PR #154).**
    - A 90 s Mine reskin with a key-set ladder: home row → top → bottom → words → capitals →
      digits. The gates are in `src/engine/placement.ts`.
    - Sprouts stop at Frosty Peaks and Miners at the Deep Mines.
    - Calm mode also ends at 90 s, with no clock shown (review B1).
    - Tested-out lessons are `plays === 0` behind `isTestedOut()` (contracts §6); there is no
      new field.
    - A biome with no lessons falls back to the furthest earlier island that has lessons.
    - Follow-ups are in M3-FIX-3, before Birch lessons ship.
93. **Accessibility (M3-07, PR #156).**
    - One app-wide reduced-motion flag (`src/a11y/motion.ts`); `'system'` follows the OS setting
      live.
    - At most 3 flashes per second, through `allowFlash()`.
    - `font: 'clean'` means no pixel font anywhere.
    - `Settings.fingerLabels?` is an additive contract change; M3-08 adds its toggle.
    - A plain F1 ("hear again") is always prevented, because it opened the browser's help page
      (review B1).
    - Screen names and results are announced; nothing is announced per keystroke.
    - Follow-ups are in M3-FIX-4.
94. **Curriculum validator (M3-01, PR #150).**
    - 13 rules, run by `npm test` and CI. One beyond the card: every biome has a phrases,
      sentences or practice lesson, to practise space.
    - `docs/curriculum.md` is generated and checked for staleness.
    - `IN_PROGRESS_BIOMES` (Meadow for now) turns the missing mastery lesson into a warning.
    - meadow-05's variety is 21 against a floor of 20, so don't remove home-row words.
95. **World map polish (M3-FIX-1, PR #155).**
    - The island line reads "0 of 6 done", with the star count after it.
    - Labels are laid out to stay on screen, wrap at a third of the window, and draw the focused
      label on top.
    - Clicking a locked island gives a kind note and a small wobble.
    - Follow-ups are in M3-FIX-4.
96. **Load-sensitive local tests.** With 3 workers running, the mesher benchmark (< 50 ms median)
    and the placement sim's same-report test (5 s timeout) can fail locally. Rerun them alone
    before calling it a failure. CI is the judge.
97. **Voxel model runtime (M4-01, PR #157).**
    - `buildModel` and `buildModelInstanced`. Instancing uses one `InstancedMesh` per part: 30 mobs
      cost 9 draw calls, or 18 on High with shadows.
    - A playing anim keeps the loop awake; an idle one never wakes it.
    - A non-positive or non-finite `speed` means no playback, and a bad `dtMs` counts as 0.
    - Hidden instances pause and cost no draw calls.
    - The shader patch throws if a three.js anchor is missing.
    - The units and frames are now contracts §8.4, and sizes are whole pixels.
    - Reduced motion holds looping anims still; one-shots still play, because game logic waits on
      `onEnd`.
98. **Profiles and avatar (M3-09, PR #158).**
    - Up to 8 profiles. Damaged and newer-game profiles count toward the 8.
    - Delete removes `:prev` too, and asks the child to type the name.
    - Rename, change group and delete go through `useGrownUpGate()`, which M3-08 replaces with the
      real gate.
    - The avatar is drawn once into a render target on the shared renderer and cached as a PNG per
      skin colour.
    - Its model data reads `VoxelModel` differently from §8.4, so M3-FIX-5 moves it onto the
      runtime.
99. **Island data (M4-06, PR #159).**
    - A 48×32×48 grid with a 24×16×24 starter plot and 6 rings of 2 cells: one per core biome
      after the Meadow. Sparkstone and Sky Citadel give other rewards.
    - Conservation: inventory plus island blocks stays constant through every edit and undo.
    - Starter terrain is a gift: digging it up refunds the block. So "collect N" achievements must
      count lifetime Mine loot, not current inventory.
    - Every M4-08 blueprint costs at least one block that only Mine loot gives.
    - M4-07 must never replace a damaged island with a fresh one.
100.  **Letter groups that sound safe read aloud (M3-FIX-6, PR #185; owner playtest 2026-11-12).**
      Read-aloud said the random group "fak", which sounded like a swear word. A pure check,
      `soundsUnsafe` (`src/content/wordlists/spoken-blocklist.ts`), normalises a group's likely
      pronunciation and rejects it if a stem appears anywhere inside; `x` as `ks` is covered
      (`fux`, `dix`, `kox`). Short runs that sit inside safe words (`hor`, `wee`, `sod`) live in the
      generator's `BLOCKED_RUNS` instead, which only applies to random letters. Every fixed item in
      `src/content` passes a test. The stem list is for M6-08's content review and never reaches
      the UI or `t()`. When unsure, add a stem: a false alarm costs one redraw.
101.  **No pixel font for text (M3-FIX-2, PR #186; owner playtest 2026-11-12).** Pixelify read B as
      G or 8, C as O, 5 as S and 0 as O at every weight and size the game uses. Every UI font is now
      Atkinson Hyperlegible; only the Splash logo keeps a blocky look (SVG voxel letters). Settings
      drops "Blocky"; a saved `font: 'pixel'` still loads and shows as Clear, so no schema change.
102.  **Digging keeps every block (M4-FIX-1, PR #184; owner playtest 2026-11-12).** A dug block
      always reaches the inventory and the hotbar. The hotbar replaces its least-recently-used slot,
      and its order is saved as the optional `island.palette` (contracts §15). The habit-space window
      depends on the band. Corner buttons open their tip on focus and long press.
103.  **Night Defense pacing (M4-FIX-2, PR #188; owner playtest 2026-11-12).** The field is never
      empty for more than `maxIdleMs` = 2.5 s (every band); dawn is the only exception. The first
      wave starts with dusk, so its first mob comes 1.2 s in, under the banner, and plates stay
      below the HUD message. Convergence numbers are unchanged. 5 WPM tuning is M4-FIX-3.
104.  **Replay variety and optional No Peeking! (M3-FIX-7, PR #187; owner playtest 2026-11-12).**
      "Play again" after Meadow gave only "ha ha": the comfort-cap fallback kept picking one item.
      Word-like items don't repeat within the last `min(4, ⌊candidates / 2⌋)` picks. Mine weights a
      lesson's review keys only when they are a real subset of its allowed keys, so weak-key practice
      stays on. "No Peeking!" is optional (contracts §6); the map stops pointing at a skipped one.
105.  **Grown-up settings and import/export (M3-08 PR #166, M3-12 PR #170).** The parent gate is a
      speed bump, not security. Settings is reachable from the map, and picture quality is wired to
      the scene. Import has no schema bump; `:prev` is a backup, not an undo, and "replace" is
      permanent.
106.  **Night Defense rules (M4-04, PR #174).** Provisional nights are `birch-08`, `shore-05` and
      `frosty-06` (M5-06 re-picks them). `lockOn` priority is spawn order. The 50 WPM sim pin is
      "mean in 90–97 %". Stars need half the visitors sent home for 2 and four fifths for 3.
      Results has an `extra.resultLines` hook; the `hands` HUD slice hides on Sprout nights; only
      root parts cast shadows by default. Mobs (M4-03): 87 draw calls for all types, 95 on High.
107.  **Builder rules (M4-07, PR #173).** One habit Space after an auto-run word is ignored (now a
      per-band window, decision 102). Builder records a practice session. A damaged island is never
      written. The map corner uses picture buttons at ≤ 1100 px.
