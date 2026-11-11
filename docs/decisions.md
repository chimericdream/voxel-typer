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
47. **Tools load content through pure loaders (closes #45).** Each content folder has a Vite-only
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
