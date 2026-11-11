# Tasks: M0 Foundations, M1 Engine + foundation lanes

Card fields: **Size** S/M/L · **Tier** A/B/C (`README.md` §2) · **Review** required/optional · **E2E** whether `npm run e2e` must pass · **Depends on** task IDs that must be merged first · **PLAN refs** sections of `PLAN.md` to read · **Owns** files this task creates/changes · **May touch** shared files under `contracts.md` §0 rules · **Reads** extra context.

---

## M0 Foundations

### M0-01 Toolchain scaffold
- **Size/Tier:** M / B · **Review:** optional · **E2E:** yes (smoke only)
- **Depends on:** —
- **PLAN refs:** §6.1, §6.2, §12
- **Owns:** `package.json`, `package-lock.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, `index.html`, `src/main.ts`, `tools/check-bundle-size.ts`, `tools/run.ts`, `tests/unit/smoke.test.ts`, `tests/e2e/smoke.spec.ts`
- **Spec:**
  - `npm init`, then install current stable versions of: `vite`, `typescript`, `preact`, `@preact/preset-vite`, `@preact/signals`, `three`, `@types/three`, `idb`; dev: `vitest`, `@vitest/coverage-v8`, `happy-dom`, `fast-check`, `fake-indexeddb`, `@playwright/test`, `@axe-core/playwright`, `eslint`, `typescript-eslint`, `eslint-plugin-jsx-a11y`, `eslint-config-prettier`, `prettier`, `tsx`. Record exact versions in the handoff note.
  - `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `jsxImportSource: "preact"`, path alias `@/*` → `src/*` (mirrored in Vite and Vitest).
  - ESLint flat config with **purity zones**: for `src/engine/**`, `src/content/**`, `src/render/mesher/**`, `src/render/atlas/recipes.ts`, `src/save/schema.ts`, `src/save/migrations.ts`: `no-restricted-imports` for `three`, `preact*`, `@/ui/*`, `@/render/*` (except mesher/recipes from each other), `@/audio/*`, `@/app/*`; `no-restricted-globals` for `window`, `document`, `navigator`, `localStorage`, `indexedDB`; `no-restricted-properties` for `Date.now`, `Math.random`, `performance.now`. Add a test file `tests/unit/purity.test.ts` that writes nothing but runs ESLint's Node API on a fixture that violates each rule and asserts errors (so the zones can't silently break).
  - Vitest: default environment `node`; files under `tests/unit/dom/**` and `tests/unit/ui/**` use `happy-dom`. Coverage thresholds configurable per folder (start with `src/engine/**: 95` lines, enabled in M1-GATE).
  - Playwright: Chromium only, `launchOptions.args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']`, `webServer` runs `vite preview` on a fixed port after `vite build --mode test`, viewport 1280×720, `expect.toHaveScreenshot` tolerance `maxDiffPixelRatio: 0.01`.
  - Scripts per `README.md` §4.1. `npm run tool -- <name>` maps to `tsx tools/<name>.ts`.
  - `tools/check-bundle-size.ts`: reads `dist/.vite/manifest.json` (enable `build.manifest`), gzips the entry chunk plus its static imports and every lazy chunk, compares against `contracts.md` §14, prints a table, exits 1 on breach.
  - `index.html`: `lang="en"`, viewport meta, a placeholder CSP meta (`default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:`) — tightened in M6-06.
  - `.nvmrc` pins Node major 26. `engines` in `package.json` says `>=26`.
  - `.gitattributes`: `* text=auto eol=lf`, and `binary` for `*.png`, `*.woff2`, `*.ico`. Prettier `endOfLine: "lf"`. The owner develops on Windows; CI is Linux.
  - Screenshots are compared only on Linux (`README.md` §3.7): `playwright.config.ts` sets `ignoreSnapshots: !process.env.CI`, and `npm run e2e:docker` runs the suite inside the `mcr.microsoft.com/playwright` image matching the installed version, with `CI=1`, for local pixel checks.
- **Acceptance:**
  - [ ] Clean clone → `npm ci` → `npm run verify` passes.
  - [ ] `npm run e2e` passes a smoke test that loads `/` and finds `#app`.
  - [ ] The purity test proves each banned import/global/property errors inside a pure folder and is allowed outside.
  - [ ] `npm run size` prints the budget table.

### M0-02 Docs, agent conventions, copy lint
- **Size/Tier:** S / C · **Review:** optional · **E2E:** no
- **Depends on:** M0-01
- **PLAN refs:** §1, §12
- **Owns:** `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `.github/pull_request_template.md`, `docs/decisions.md`, `docs/progress.md`, `docs/handoffs/.gitkeep`, `docs/art-guide.md` (stub), `eslint.config.js` (copy-lint rule only)
- **Spec:**
  - `CLAUDE.md`: commands table, the purity rule (`PLAN.md` §6.3 + `contracts.md` zones), the IP rule, the priority order (`PLAN.md` §12.8), "contracts are frozen; see docs/impl/README.md §4.3", copy tone rule, where handoff notes go. Under 120 lines.
  - `docs/decisions.md`: a dated log. Seed it with every item in `docs/impl/README.md` §8.
  - `docs/progress.md`: a milestone checklist mirroring `task-graph.md`.
  - Copy lint: forbid JSX text literals and string literals in `title`/`aria-label`/`placeholder` props inside `src/ui/**` (a small local ESLint rule in `tools/eslint-rules/no-ui-literals.js` is fine; allow punctuation-only and numbers).
  - Record the owner's answers from `README.md` §8.12–8.13 (PR per task, CI-heavy testing, Proxmox self-hosting) in `docs/decisions.md`.
  - `.github/pull_request_template.md` mirroring the handoff-note headings (`README.md` §6), and `CONTRIBUTING.md` (short: the PR flow from `README.md` §3, for humans and agents).
- **Acceptance:**
  - [ ] Lint fails on `<p>Hello</p>` in a `src/ui` fixture and passes on `<p>{t('x.y')}</p>`.
  - [ ] `docs/decisions.md` contains all `README.md` §8 items.

### M0-03 CI: test everything on every PR
- **Size/Tier:** M / B · **Review:** required · **E2E:** n/a
- **Depends on:** M0-01
- **PLAN refs:** §6.1 (CI), §9
- **Owns:** `.github/workflows/ci.yml`, `.github/workflows/update-snapshots.yml`, `.github/workflows/nightly.yml`, `.github/workflows/actionlint.yml`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `docs/ci.md`
- **Spec:** the owner wants GitHub Actions to test as much as possible. Every check below is a **separate job** with a stable name, so it can be a required status check. Jobs added before the code they test exists must pass trivially (for example, "no e2e specs yet") and tighten automatically once files appear; later tasks never need to edit CI just to turn their tests on.
  - **`ci.yml`** on `pull_request` and `push` to `main`, with `concurrency` cancelling superseded runs on the same PR:
    | Job | What it runs |
    |---|---|
    | `typecheck` | `npm run typecheck` |
    | `lint` | ESLint (incl. purity zones and copy lint) + Prettier check |
    | `unit` | `npm run test:cov`; uploads the coverage report; fails on the per-folder thresholds; posts a coverage summary to the job summary |
    | `content` | word-list validator, curriculum validator + `docs/curriculum.md` staleness check, i18n missing/unused keys, block/mob/model JSON schema checks (each a no-op until its tool exists) |
    | `build` | `npm run build` + `npm run size`; uploads `dist/` as an artifact for the e2e jobs; writes the bundle-size table to the job summary and as a sticky PR comment (one comment, updated in place) |
    | `e2e` | Playwright in the official `mcr.microsoft.com/playwright` container matching the installed `@playwright/test` version, **sharded ×3** against the `build` artifact; includes axe checks and screenshot comparisons; uploads the HTML report + traces on failure |
    | `docker` | builds the container image (M0-05) without pushing, then starts it and curls `/` and `/sw.js` to check status codes and headers |
    | `deps` | `npm audit --omit=dev --audit-level=high` and GitHub's `dependency-review-action` on PRs |
    | `codeql` | GitHub CodeQL for JavaScript/TypeScript |
    | `ci-ok` | needs all of the above; the single required check for branch protection |
  - **`update-snapshots.yml`**: `workflow_dispatch` with a `branch` input (and a `/update-snapshots` PR comment trigger restricted to the repo owner and the orchestrator's account): runs Playwright with `--update-snapshots` in the same container and commits changed PNGs to that branch. This is the only way baselines are made (`README.md` §3.7).
  - **`nightly.yml`** (cron, plus manual): full e2e run **3× in a row** to detect flakes (reports flaky test names in the job summary and opens/updates a single "Flaky tests" issue); simulator studies (`tools/sim*.ts`, once they exist) with results attached as artifacts; Lighthouse and perf budgets (M6-10, no-op until then).
  - **`actionlint.yml`**: lints workflow files on PRs that touch `.github/`.
  - `dependabot.yml`: weekly npm and GitHub Actions updates, grouped (dev deps in one PR); Docker base image updates once M0-05 lands.
  - Cache npm and the Playwright container layer. Pin third-party actions to a full commit SHA with the version in a comment.
  - **Branch protection** on `main` (the owner asked for PRs, so this is in scope): via `gh api`, require `ci-ok`, require branches up to date, no force pushes, no deletions. Allow the repo admin to bypass (for emergencies). If the token lacks admin rights, write the exact `gh api` command in the handoff note for the owner to run.
  - `docs/ci.md`: one table of jobs, what each catches, how to re-run, how to update snapshots.
- **Acceptance:**
  - [ ] `actionlint` passes on all workflows.
  - [ ] This task's own PR shows every job green, and the bundle-size comment appears.
  - [ ] A throwaway PR with a deliberate type error, a lint error and a failing unit test shows `typecheck`, `lint` and `unit` red, and `ci-ok` red (close it without merging).
  - [ ] Branch protection is on, or the owner has the command to turn it on.

### M0-05 Container image and Proxmox deployment
- **Size/Tier:** M / B · **Review:** required (security headers)
- **Depends on:** M0-01, M0-03
- **PLAN refs:** §6.1, §6.7, `README.md` §8.13
- **Owns:** `Dockerfile`, `.dockerignore`, `deploy/nginx.conf` (or `deploy/Caddyfile`), `deploy/docker-compose.yml`, `deploy/.env.example`, `deploy/README.md`, `.github/workflows/publish.yml`, `tests/deploy/headers.test.ts`
- **Spec:**
  - Multi-stage `Dockerfile`: `node:26-alpine` builds with `npm ci && npm run build`; the final stage is an unprivileged static server (`nginxinc/nginx-unprivileged:alpine` or `caddy:alpine`; record which and why) holding only `dist/` and the config. Runs as non-root, read-only root filesystem compatible, listens on 8080, `HEALTHCHECK` on `/`.
  - Server config: SPA fallback to `index.html`; `Cache-Control: public, max-age=31536000, immutable` for hashed assets, `no-cache` for `index.html`, `sw.js`, `manifest.webmanifest`; gzip/brotli for text; security headers (`Content-Security-Policy` from `index.html` mirrored as a header, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` denying camera/mic/geolocation, `Cross-Origin-Opener-Policy: same-origin`, `frame-ancestors 'none'` in the CSP header). M6-06 tightens these; this task sets them up.
  - **`publish.yml`**: on push to `main` → build and push `ghcr.io/chimericdream/voxel-typer:edge` and `:sha-<short>`; on tags `m*` and `v*` → push `:stable` and the tag name. Multi-arch `linux/amd64` (+ `arm64` if cheap). Uses `GITHUB_TOKEN` with `packages: write`. Adds OCI labels (source, revision, version). Only runs after `ci.yml` succeeds for that commit (`workflow_run` or a reusable-workflow `needs`).
  - `deploy/docker-compose.yml` modelled on the owner's home-dashboard setup: the `voxel-typer` service on `:stable`, **Watchtower** polling GHCR (interval 5 min, label-scoped to this service, cleanup old images), an optional commented `voxel-typer-edge` service on `:edge` for previews, and a **Tailscale sidecar** (owner's choice): the `voxel-typer` service uses `network_mode: service:tailscale`, and the sidecar terminates HTTPS with `tailscale serve` (a `serve.json` mounted via `TS_SERVE_CONFIG`, proxying `https://${TS_CERT_DOMAIN}` to `http://127.0.0.1:8080`) on a tailnet device named `voxel-typer`. Reuse the owner's home-dashboard compose layout where it fits. Known gotchas to handle in the README: the tailnet needs MagicDNS and HTTPS certificates enabled; with the shared network namespace the game is reachable only over the tailnet, not by LAN IP; check that `${TS_CERT_DOMAIN}` is substituted by the current Tailscale image, and hardcode the tailnet name if not; each kid's device needs the Tailscale app (school-managed Chromebooks may not allow it, so mention that). Keep a short appendix on the reverse-proxy alternative in case that changes later. No secrets in the repo: `.env.example` lists `TS_AUTHKEY` (an auth key tagged for this device) and similar.
  - `deploy/README.md`: step-by-step for Proxmox (create a Debian LXC with nesting enabled, or a small VM; install Docker; copy `deploy/`; `docker compose up -d`; make the GHCR package public or create a read-only PAT; how to check Watchtower picked up an update; how to roll back by pinning `:m<N>`; how to back up nothing (all game data lives in the kids' browsers, so remind parents about the in-game export)).
  - `tests/deploy/headers.test.ts` parses the server config and asserts the cache and security header rules (so a config edit can't silently drop them); the `docker` CI job checks the live headers.
- **Acceptance:**
  - [ ] `docker` CI job green: image builds, serves `/` with 200 and the security headers, `sw.js` (once it exists) with `no-cache`.
  - [ ] After merge, `publish.yml` pushes `:edge` to GHCR (visible in the run log).
  - [ ] The owner can follow `deploy/README.md` to run the hello-voxel build on Proxmox (👤, may wait until M2 is worth showing).

### M0-04 Hello voxel
- **Size/Tier:** S / B · **Review:** optional · **E2E:** yes
- **Depends on:** M0-01, M0-03 (its screenshot baseline is generated by the Update snapshots workflow)
- **PLAN refs:** §5.1, §8 Phase 0 accept
- **Owns:** `src/main.ts` (replace placeholder), `src/dev/hello-voxel.ts`, `tests/e2e/hello-voxel.spec.ts`, its screenshot baseline
- **Spec:** a spinning cube with a 16×16 procedurally painted texture (simple 2-tone noise, seeded), `NearestFilter`, no mipmaps, on a sky-blue background. Rotation stops under `?freeze=1`. This file is throwaway; M2-10 replaces `main.ts`.
- **Acceptance:**
  - [ ] Screenshot test at `?freeze=1&seed=1` passes; pixels show hard texel edges (no blur).

### M0-GATE
Orchestrator. `PLAN.md` Phase 0 acceptance list + `README.md` §7. Branch protection active; every M0 task merged through a green PR. Tag `m0` (this publishes the first `:stable` image).

---

## M1 Engine + foundation lanes

M1-01 runs alone first. After it merges, everything else in M1 can run in parallel (see `task-graph.md` waves).

### M1-01 Contracts into code
- **Size/Tier:** M / A · **Review:** required · **E2E:** no
- **Depends on:** M0-01
- **PLAN refs:** §6.2, §6.3
- **Owns:** every file named in `contracts.md` code blocks, as **types plus stubs** (`throw new Error('not implemented: <fn>')`), plus: `src/app/events.ts` (fully implemented emitter), `src/app/clock.ts` (implemented), `src/modes/registry.ts` (implemented glob discovery + fallback rule), `src/content/lessons/index.ts`, `src/content/blocks/index.ts`, `src/i18n/en/index.ts` (glob/aggregate scaffolds), `src/types/core.ts`, `tests/unit/contracts/*.test.ts`
- **Spec:**
  - Copy every interface and type from `contracts.md` exactly. Add TSDoc comments that restate the rules in prose (for example, the policy semantics in §3.2), so workers see them on hover.
  - Implement the emitter, clocks and registry; stub everything else.
  - Add a **type-level test** file (`tests/unit/contracts/types.test-d.ts` with Vitest `expectTypeOf`) for the trickiest shapes: `EngineEvent` narrowing, `ModeContext`, `HudState`.
  - Folder skeletons with `index.ts` barrels for `engine`, `input`, `save`, `render`, `audio`, `ui`, `modes`, `content`, `i18n`, `a11y`.
- **Acceptance:**
  - [ ] `npm run verify` passes with stubs.
  - [ ] Every type in `contracts.md` exists in `src/` (reviewer checks section by section).
  - [ ] `resolveMode('defense')` returns the mine module stub (registry test with a fake glob).
  - [ ] Orchestrator marks `contracts.md` **frozen** in its header after merge.

### M1-02 Seeded RNG
- **Size/Tier:** S / B · **Review:** optional
- **Depends on:** M1-01
- **Owns:** `src/engine/rng.ts`, `tests/unit/engine/rng.test.ts`
- **Spec:** `contracts.md` §2. sfc32 seeded via splitmix32; cyrb53 for strings; `fork(label)` = `createRng(hashString(seed + ':' + label))`.
- **Acceptance:**
  - [ ] Golden values pinned for `createRng(42)` and `createRng('voxel')` (first 10 `next()` outputs).
  - [ ] Property: `int(a,b)` always within bounds; `shuffle` is a permutation; `weightedPick` never picks a zero-weight item; empirical distribution of `weightedPick` within 2% of weights over 100k draws (fixed seed).
  - [ ] `fork` streams differ from parent and from each other, and are reproducible.

### M1-03 Typing session and matcher
- **Size/Tier:** L / A · **Review:** required
- **Depends on:** M1-01
- **PLAN refs:** §3.2, §6.3, §6.5
- **Owns:** `src/engine/session.ts`, `src/engine/matcher.ts`, `tests/unit/engine/session.*.test.ts`, `tests/fixtures/logs/*.json` (hand-written)
- **Reads:** `contracts.md` §3 (all of it, carefully)
- **Spec:**
  - Implement `createSession`, `restoreSession`, `view`, `snapshot`, every policy × targeting combination, pause/resume, `time` end condition, `removeTarget`, case-insensitive mode.
  - `matcher.ts` holds pure per-target state transitions (`applyKey(targetState, input, policy) → { state, events }`), so `session.ts` is orchestration only.
  - The session keeps the summary accumulators (calls into `stats.ts` helpers once M1-04 lands; until then, keep counters locally behind a small internal interface so M1-04 can plug in without touching `session.ts` signatures). Coordinate via the handoff note.
  - Snapshot includes the full log; `restoreSession(snapshot())` must produce identical `view()` and identical future events.
- **Acceptance:**
  - [ ] Table-driven tests for each row of the policy rules in `contracts.md` §3.2–3.3, including: repeated wrong keys under `stay`; backspace past a wrong char under `backspace`; target can't complete with wrong chars under `backspace`; lockOn tie-breaks; lockOn miss (`targetId: null`); backspace-to-unlock; removing a locked target; space between sequential targets; first-char latency `null`; latency reset after resume.
  - [ ] Property tests (fast-check): for any random key stream and targets, (a) `correct + errors === keystrokes`, (b) no event references an unknown target, (c) `restoreSession(snapshot())` then the same remaining inputs yields identical events, (d) pausing for any duration doesn't change WPM computed over active time.
  - [ ] Feeding after `end` throws; a `time` session emits exactly one `sessionEnd`.
  - [ ] ≥ 95% line coverage for both files.

### M1-04 Stats, stars and key-stat folding
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M1-01
- **PLAN refs:** §3.3, §4.4
- **Owns:** `src/engine/stats.ts`, `src/engine/stars.ts`, `tests/unit/engine/stats.test.ts`, `tests/unit/engine/stars.test.ts`, `tests/fixtures/stats/*.json`
- **Spec:** `contracts.md` §3.5, §3.6, §6 (stars). Provide `createAccumulator()` used by the session (the plug-in interface agreed with M1-03), `summarize(acc, activeMs) → SessionSummary`, `foldSummaryIntoKeyStats`, `computeStars`, `baselineNetWpm(history)`.
- **Acceptance:**
  - [ ] At least 6 hand-computed fixtures (in a JSON file with the arithmetic written in a `"why"` field) for gross/net WPM, accuracy, consistency, including `activeMs < 1000` and zero keystrokes.
  - [ ] `foldSummaryIntoKeyStats` is pure (input objects deep-equal before/after) and caps the latency ring at 30.
  - [ ] Star rules tested at each threshold boundary (0.8999/0.90, 0.9499/0.95, baseline with < 3 summaries).

### M1-05 Adaptive engine
- **Size/Tier:** M / A · **Review:** required
- **Depends on:** M1-01 (uses `KeyStat` type only; can run parallel to M1-04)
- **PLAN refs:** §4.3
- **Owns:** `src/engine/adaptive.ts`, `tests/unit/engine/adaptive.test.ts`
- **Spec:** `contracts.md` §4. Constants live in an exported `ADAPTIVE_CONSTANTS` object so M1-07 can tune them.
- **Acceptance:**
  - [ ] Monotonic properties: more errors on key k (all else equal) never lowers `w(k)`; slower median never lowers `w(k)`; focus keys always ≥ 3.
  - [ ] `weakKeys` excludes focus keys and keys outside `allowed`.
  - [ ] SRS schedule follows the three accuracy rules and caps at 32.

### M1-06 Content generator
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M1-01, M1-02
- **PLAN refs:** §4.2
- **Owns:** `src/engine/generator.ts`, `tests/unit/engine/generator.test.ts`
- **Spec:** `contracts.md` §5.
- **Acceptance:**
  - [ ] Property: for any allowed set (non-empty, from a–z ; and space) and any seed, output chars ⊆ allowed ∪ {space}. This is the key safety property; run 2000 cases.
  - [ ] Same params + same seed ⇒ identical output.
  - [ ] Comfort cap holds (≥ 50% chars from bottom-half-weight keys) on 500 random cases, except where the allowed set has < 4 keys (documented).
  - [ ] `letters` never repeats a char > 3 in a row; `{seconds, estWpm}` length conversion matches the formula.

### M1-07 Replay harness and typist simulator
- **Size/Tier:** M / B · **Review:** optional
- **Depends on:** M1-03, M1-04, M1-05, M1-06
- **PLAN refs:** §8 Phase 1, §9.2, §9.3
- **Owns:** `src/engine/replay.ts`, `tools/sim.ts`, `tools/sim/typist.ts`, `tests/unit/engine/replay.test.ts`, `tests/unit/sim/*.test.ts`, `docs/sim.md`
- **Spec:**
  - `replay(snapshot) → { events, summary }` (thin wrapper over `restoreSession`).
  - Synthetic typist (`typist.ts`, pure, takes an `Rng`): profile `{ wpm, errorRate, perKeyErrorMult?: Record<string, number>, jitter: number, learnRate?: number }`. Inter-key latency lognormal around `12000 / wpm` ms; errors pick a neighbor key from the layout (M1-11 data if merged, else a hardcoded QWERTY neighbor map) with probability `errorRate × mult`; under `stay`/`backspace` the typist corrects like a human (Backspace then retype) after a 150–400 ms "notice" delay.
  - `npm run tool -- sim --lesson <id|adhoc> --typist slow|avg|fast|pinkyweak --runs 50 --seed 1` prints a table: stars distribution, median accuracy, net WPM, adaptive weights after N sessions.
  - Tune `ADAPTIVE_CONSTANTS` so a "pinky-weak" typist's `;` and `a` weights rise to the top-2 within 5 sessions, without starving other keys. Record final constants and evidence in `docs/sim.md`.
- **Acceptance:**
  - [ ] Replay of every fixture log in `tests/fixtures/logs/` reproduces stored expected summaries exactly.
  - [ ] Sim run is deterministic for a seed (two runs, byte-identical output).
  - [ ] Pinky-weak tuning evidence in `docs/sim.md`.

### M1-08 Input normalization
- **Size/Tier:** S / B · **Review:** optional
- **Depends on:** M1-01
- **PLAN refs:** §4.6 (one-handed/sticky), §6.5
- **Owns:** `src/input/*.ts`, `tests/unit/dom/input.test.ts`
- **Spec:** `contracts.md` §9 exactly.
- **Acceptance:**
  - [ ] Tests (happy-dom, synthetic `KeyboardEvent`s) for each rule: repeat, composing, Dead, ctrl/meta/alt ignore, AltGraph pass-through, Ctrl+Z → `Undo` only when the ctx asks for it, Escape/Enter/Tab/arrows mapping in menus vs play, smart-quote normalization, blur/visibility → pause, `preventDefault` called exactly for the listed keys in play.

### M1-09 Save layer
- **Size/Tier:** M / B · **Review:** required (data loss risk)
- **Depends on:** M1-01
- **PLAN refs:** §6.6, §6.7
- **Owns:** `src/save/*.ts` (becomes orchestrator-owned for `schema.ts`, `migrations.ts`, `settings.ts` after merge), `tests/unit/save/*.test.ts`, `tests/fixtures/saves/v1.json`, `tests/fixtures/profiles/*.json`
- **Spec:** `contracts.md` §15. IDB via `idb`: object store `profiles` (key = id) holding the current and `<id>:prev` records. Write path: validate → write prev ← current → write current, in one transaction. Load path: parse → validate (hand-written structural validator, no dependency) → migrate → on any failure try `prev` → on failure return `null` and report. `history` compaction: when > 500, fold oldest into `weekly`. Export/import with size cap (5 MB), id collision handling (imported profile gets a new id and "(2)" suffix), max 8 profiles.
  - Fixture profiles for e2e: `fresh-sprout`, `fresh-builder`, `meadow-done-miner`, `pinky-weak` (Miner whose `a` and `;` key stats show high error rates), `veteran-builder` (all biomes unlocked, history of 200 sessions).
- **Acceptance:**
  - [ ] Round trip: `save` then `load` deep-equals.
  - [ ] Corrupt current record ⇒ `load` returns the `prev` snapshot.
  - [ ] Import rejects: wrong `app` field, > 5 MB, invalid structure, 9th profile; reports reasons; never throws.
  - [ ] Compaction keeps totals (minutes, sessions) equal before/after.
  - [ ] `defaultSettings(band)` matches `PLAN.md` §2 defaults (Sprout: keyboard + hands on, calm mode on, text scale 1.5, TTS on; Miner: keyboard on, hands off; Builder: keyboard off).

### M1-10 Word-list pipeline
- **Size/Tier:** M / B · **Review:** required (child safety)
- **Depends on:** M1-01
- **PLAN refs:** §2 (reading level), §7.1
- **Owns:** `tools/validate-wordlists.ts`, `src/content/wordlists/pools.ts`, `src/content/wordlists/loader.ts`, `src/content/wordlists/SOURCES.md`, `src/content/wordlists/blocklist.txt`, `src/content/wordlists/README.md`, `tests/unit/content/wordlists.test.ts`, starter lists: `src/content/wordlists/sight-dolch.txt`, `home-row.txt`
- **Spec:**
  - File format: one item per line, `# tags: band=sprout reading=dolch theme=animals` header lines, `#` comments. Items are lowercase unless the pool is tagged `case=mixed`.
  - `loader.ts` turns `?raw` imports (Vite) / `fs` reads (tools) into `WordPool` objects. The runtime bundle must not include the validator or blocklist.
  - Validator checks: allowed char set per pool tag; length bounds per band (sprout 1–5, miner 1–8, builder 1–14 for words; phrases ≤ 30, sentences ≤ 90 chars); duplicates within and across pools of the same band; blocklist hits (whole-word and substring for a "strict" sublist); trademark/IP terms; reading-level tag present; every non-ASCII char rejected.
  - Blocklist: profanity, slurs, violence/weapons beyond cartoon level, scary/sensitive topics, brand names, IP terms from `README.md` §4.5. Err on excluding. Keep it in-repo, plain text, with a comment header explaining it is a safety filter.
  - Dolch sight words are public domain (published 1936/1948); cite that in `SOURCES.md`. `home-row.txt`: authored by us, every word typeable with `a s d f g h j k l ;` (e.g. *ad, add, ads, all, ask, dad, fad, fall, flag, flask, gal* (exclude: slang), *glad, glass, had, half, hall, has, hash* (exclude: confusing), *jag* (exclude), *lad, lag, lash* (exclude: violence), *sad, salad, shall, slag* (exclude) …). Apply judgment and the blocklist.
  - CI: `npm test` runs the validator over all lists.
- **Acceptance:**
  - [ ] Validator fails on seeded bad fixtures (a blocklisted word, a non-ASCII char, a too-long Sprout word, a duplicate, a missing reading tag) with clear file:line messages.
  - [ ] `home-row.txt` has ≥ 40 items, all typeable with the Meadow key set, all validator-clean.
  - [ ] Runtime bundle size unaffected by the blocklist (checked in `npm run size` output).

### M1-11 Keyboard layouts as data
- **Size/Tier:** S / C · **Review:** optional
- **Depends on:** M1-01
- **PLAN refs:** §4.5
- **Owns:** `src/content/layouts/en-US.json`, `en-GB.json`, `src/content/layouts/index.ts`, `tests/unit/content/layouts.test.ts`
- **Spec:** `contracts.md` §16. Standard touch-typing finger map (Q/A/Z/1 = L5 … P/;/'/[ and beyond = R5, space = T). Include number row, punctuation, and shifted symbols.
- **Acceptance:**
  - [ ] Every printable ASCII char 0x20–0x7E (en-US) resolves via `codeFor` and `fingerFor`; en-GB differences (`"`/`@` swap, `£`, `#` key) tested.

### M1-12 i18n runtime
- **Size/Tier:** S / B · **Review:** optional
- **Depends on:** M1-01
- **PLAN refs:** §4.5
- **Owns:** `src/i18n/index.ts`, `src/i18n/format.ts`, `src/i18n/en/common.ts`, `tests/unit/i18n/*.test.ts`, `tools/i18n-keys.ts`
- **Spec:** `contracts.md` §11. Missing key in dev ⇒ returns `⟦key⟧` and warns once; in production returns the English text or the key's last segment. `tools/i18n-keys.ts` scans `src/**` for `t('…')` calls and reports missing/unused keys; the unit test runs it.
- **Acceptance:**
  - [ ] Interpolation, plural (`one`/`other`), and escaping tests.
  - [ ] Unused/missing key detection works on a fixture.

### M1-13 Voxel grid and chunk mesher (pure)
- **Size/Tier:** M / A · **Review:** required
- **Depends on:** M1-01
- **PLAN refs:** §5.1 (AO), §6.4
- **Owns:** `src/render/mesher/*.ts`, `tests/unit/mesher/*.test.ts`
- **Spec:** `contracts.md` §8.2. Culled faces between opaque blocks; transparent blocks (glass, leaves, water) mesh faces against air and against different transparent types only. Per-vertex AO with values {0,1,2,3} → brightness {1.0, 0.8, 0.65, 0.5}, written into `colors`; flip quad diagonal when `ao0 + ao3 > ao1 + ao2`. Faces at chunk borders look up neighbors in the full grid (not just the chunk). RLE for `toJSON`.
- **Acceptance:**
  - [ ] Single block ⇒ 6 quads (24 vertices, 36 indices). Two adjacent blocks ⇒ 10 quads. Fully enclosed block ⇒ contributes 0 quads.
  - [ ] AO fixtures: corner in an L-shape gets the expected values (hand-computed, documented in the test).
  - [ ] RLE round trip on random grids (property test); a 48×32×48 island of mostly air encodes to < 5% of raw size.
  - [ ] Meshing a 64×32×64 random terrain takes < 50 ms in Node (benchmark test, generous bound, skipped on CI if flaky; record numbers in the handoff note).

### M1-14 Palette, texture recipes and atlas
- **Size/Tier:** M / A · **Review:** required (visual)
- **Depends on:** M1-01, M1-02
- **PLAN refs:** §5.1, §1 (IP note)
- **Owns:** `src/render/atlas/recipes.ts`, `src/render/atlas/painters.ts`, `src/render/atlas/palettes.ts`, `src/render/atlas/build.ts`, `assets/textures/src/README.md`, `src/dev/atlas-preview.ts`, `atlas.html` (dev-only page, excluded from prod build), `tests/unit/atlas/*.test.ts`, `tests/e2e/atlas.spec.ts`
- **Spec:**
  - Palette = named ramps of 4–6 colors (`grass`, `dirt`, `stone`, `oak`, `birch`, `sand`, `snow`, `water`, `leaf`, `ore-copper`, `ore-gem`, `crystal`, `mushroom`, `spark`, `cloud`, `wool-*` …). Each biome gets a palette variant (hue/sat shift) defined as data.
  - Painters are pure functions writing RGBA into a `Uint8ClampedArray(16*16*4)`. Use value noise from the seeded RNG; quantize to the ramp (the "pixel art" look comes from ramp quantization plus a 1-px darker edge on planks/bricks).
  - Crack stages 0–9 as alpha overlays with progressively larger fracture lines (rendered as a second material layer in Mine mode, not baked into blocks).
  - `build.ts` packs tiles into a 2^n atlas with 1-px gutters, applies PNG overrides if present (`import.meta.glob('/assets/textures/src/*.png')`), returns a `THREE.CanvasTexture` with `NearestFilter`, `generateMipmaps = false`, `colorSpace = SRGBColorSpace`.
  - `atlas.html` shows every tile at 8× zoom with its block id and a palette strip. Visual review (README §5.3).
- **Acceptance:**
  - [ ] Painters deterministic for a seed (hash of output pinned for 3 recipes).
  - [ ] Atlas UVs land inside tiles (no gutter sampling) for every tile — unit test on `uv()`.
  - [ ] Screenshot of `atlas.html?seed=1` committed as baseline; visual reviewer says the set reads as original pixel-art blocks and doesn't imitate another game's textures.

### M1-GATE
Orchestrator. `PLAN.md` Phase 1 acceptance (coverage ≥ 95% on `src/engine/**`; generator safety property; WPM fixtures; deterministic replay). Turn on the engine coverage threshold in `vitest.config.ts`. Tag `m1`.
