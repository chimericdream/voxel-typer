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
