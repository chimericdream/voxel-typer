# Progress

A milestone checklist that mirrors the status board in [`docs/impl/task-graph.md`](impl/task-graph.md). **Live status is in GitHub issues**, one per card (`docs/impl/HANDOFF.md` §5): `gh issue list --milestone m<N>` and `gh pr list` show the current state. The orchestrator refreshes this file in each gate PR, so between gates it can lag behind.

Status values: `todo` · `ready` · `running` · `review` · `merged` · `blocked: reason` · `deferred`. A box is ticked once the card is merged (or, for a gate, passed). ✦ = assigned to Fable 5.2.

## M0: Foundations

- [x] **M0-01** Toolchain scaffold (M/B) — merged (PR #89)
- [x] **M0-02** Docs, agent conventions, copy lint (S/C) — merged (PR #90)
- [x] **M0-03** CI: test everything on every PR (M/B) — merged (PR #91)
- [x] **M0-04** Hello voxel (S/B) — merged (PR #94)
- [x] **M0-05** Container image + Proxmox deploy (M/B) — merged (PR #97)
- [x] **M0-FIX-1** CI hardening from the M0-03 review — merged (PR #96)
- [x] **M0-FIX-2** Purity enforcement: allow-list and banned globals — merged (PR #100)
- [x] **M0-GATE** Gate — passed 2026-11-11, tag `m0`

## M1: Engine and foundation lanes

- [x] **M1-01** ✦ Contracts into code (M/A) — merged (PR #101); contracts frozen
- [x] **M1-02** Seeded RNG (S/B) — merged (PR #107)
- [x] **M1-03** ✦ Typing session and matcher (L/A) — merged (PR #103)
- [x] **M1-04** Stats, stars, key-stat folding (M/B) — merged (PR #106, SRS follow-up #110)
- [x] **M1-05** Adaptive engine (M/A) — merged (PR #104)
- [x] **M1-06** Content generator (M/B) — merged (PR #111)
- [x] **M1-07** Replay harness and simulator (M/B) — merged (PR #115)
- [x] **M1-08** Input normalization (S/B) — merged (PR #114)
- [x] **M1-09** Save layer (M/B) — merged (PR #108)
- [x] **M1-10** Word-list pipeline (M/B) — merged (PR #112)
- [x] **M1-11** Keyboard layouts (S/C) — merged (PR #117)
- [x] **M1-12** i18n runtime (S/B) — merged (PR #105)
- [x] **M1-13** Voxel grid and mesher (M/A) — merged (PR #109)
- [x] **M1-14** Palette, recipes, atlas (M/A) — merged (PR #113)
- [x] **M1-FIX-1** Blocklist precision follow-up (S/B) — merged (PR #121)
- [x] **M1-GATE** Gate — passed 2026-11-11, tag `m1`

## M2: Vertical slice: Mine mode on Meadow (go/no-go)

- [x] **M2-01** Render core (M/A) — merged (PR #122)
- [x] **M2-02** Sky, clouds, day/night (M/A) — merged (PR #131)
- [x] **M2-03** Meadow diorama (M/A) — merged (PR #132)
- [x] **M2-04** Block registry v1 + loot (M/B) — merged (PR #118; gem ore recolored in #124)
- [x] **M2-05** FX (M/A) — merged (PR #130)
- [x] **M2-06** Audio synth and SFX (M/A) — merged (PR #125)
- [x] **M2-07** Voxel UI kit (M/A) — merged (PR #123)
- [x] **M2-08** Fonts and typography (S/B) — merged (PR #126)
- [x] **M2-09** On-screen keyboard + hands (M/B) — merged (PR #133)
- [x] **M2-10** App shell, routing, hooks (M/A) — merged (PR #129)
- [x] **M2-11** Screens v1 (M/B) — merged (PR #134, includes the rem double-scaling fix)
- [x] **M2-12** Meadow lessons 1–6 (S/A) — merged (PR #127)
- [x] **M2-13** ✦ ⛩ Mine mode (L/A) — merged (PR #141)
- [x] **M2-14** HUD (M/B) — merged (PR #137)
- [x] **M2-15** ⛩ Slice E2E + baselines (M/B) — merged (PR #142)
- [x] **M2-16** Playtest kit (S/C) — merged (PR #138)
- [x] **M2-FIX-2** Slice polish from the M2 reviews (M/B) — merged (PR #143)
- [x] **M2-FIX-3** Owner playtest fixes: age-aware stars, no extra space (M/B) — merged (PR #147)
- [x] **M2-FIX-4** Flowers as small sprigs, not full blocks (M/A) — merged (PR #149)
- [x] **M2-GATE** Go/no-go — **go with fixes**, 2026-11-11 (owner played the slice; decisions 78–86). Fixes: M2-FIX-3, M2-FIX-4

## M3: Curriculum, adaptation, meta screens

- [x] **M3-01** Curriculum validator + doc gen (S/B) — merged (PR #150)
- [x] **M3-02** Word lists biomes 1–4 (L/A) — merged early (PR #128)
- [x] **M3-03** Lessons biomes 1–4 (M/A) — merged (PR #171)
- [x] **M3-04** ✦ World map (L/A) — merged (PR #148)
- [x] **M3-05** Placement test (M/B) — merged (PR #154)
- [x] **M3-06** Remedial + recommendations (M/B) — merged (PR #196)
- [x] **M3-07** Accessibility features (M/B) — merged (PR #156)
- [x] **M3-08** Settings + parent gate (M/B) — merged (PR #166)
- [x] **M3-09** Profiles + avatar (M/B) — merged (PR #158)
- [x] **M3-10** Achievements v1 (M/B) — merged (PR #160)
- [x] **M3-11** Parent Dashboard v1 (L/B) — merged (PR #198)
- [x] **M3-12** Migrations + import/export UI (S/B) — merged (PR #170)
- [x] **M3-13** Progression sim study (M/A) — merged (PR #199)
- [x] **M3-14** ⛩ E2E + a11y sweep (M/B) — merged (PR #203)
- [x] **M3-FIX-1** World map polish (S/B) — merged (PR #155)
- [x] **M3-FIX-2** Pixel font legibility (S/B) — merged (PR #186)
- [x] **M3-FIX-3** Placement follow-ups (S/B) — merged (PR #168)
- [x] **M3-FIX-4** Map labels + a11y follow-ups (S/B) — merged (PR #189)
- [x] **M3-FIX-5** Avatar onto the model runtime (S/B) — merged (PR #193)
- [x] **M3-FIX-6** Letter groups safe when read aloud (S/A) — merged (PR #185)
- [x] **M3-FIX-7** Replay variety, optional No Peeking! (S/B) — merged (PR #187)
- [x] **M3-FIX-8** My Badges scroll cue + toasts (S/B) — merged (PR #190)
- [x] **M3-FIX-9** Import/export + two-tab safety (S/B) — merged (PR #194)
- [x] **M3-FIX-10** Placement small items + row floor (XS/C) — merged (PR #195)
- [x] **M3-FIX-11** Progression fixes from the sim study (M/B) — merged (PR #202)
- [x] **M3-GATE** Gate — passed 2026-11-13 without a child playtest (owner skipped it); tag `m3` waits for the owner's OK

## M4: Night Defense and Home Island Builder

- [x] **M4-01** Voxel model runtime (M/A) — merged (PR #157)
- [x] **M4-02** Model Lab (S/C) — merged (PR #169)
- [x] **M4-03** ✦ Mobs wave 1 (L/A) — merged (PR #172)
- [x] **M4-04** ✦ ⛩ Night Defense mode (L/A) — merged (PR #174)
- [x] **M4-05** Wave director (M/A) — merged (PR #167)
- [x] **M4-06** Island data + persistence (S/B) — merged (PR #159)
- [x] **M4-07** ✦ ⛩ Builder mode (L/A) — merged (PR #173)
- [ ] **M4-08** Blueprints, expansion, snapshot (M/B) — review (PR #204)
- [ ] **M4-09** Inventory screen (M/B) — review (PR #205)
- [ ] **M4-10** ⛩ No-failure invariants + E2E (M/B) — todo
- [x] **M4-FIX-1** Builder: digging keeps every block (S/B) — merged (PR #184)
- [x] **M4-FIX-2** Night Defense pacing (S/B) — merged (PR #188)
- [x] **M4-FIX-3** Night Defense for 5 WPM learners (S/B) — merged (PR #197)
- [ ] **M4-GATE** Gate — todo

## M5: Minecart, Bosses, Daily Quest, biomes 5–9

- [ ] **M5-01** ✦ ⛩ Minecart Run (L/A) — todo
- [ ] **M5-02** ⛩ Boss framework + DSL (M/A) — todo
- [ ] **M5-03** ✦ Boss designs + models (L/A) — todo
- [ ] **M5-04** Boss scripts (M/B) — todo
- [x] **M5-05** Content biomes 5–9 (L/A) — merged early (PR #136)
- [ ] **M5-06** Lessons biomes 5–9 (M/A) — todo
- [ ] **M5-07** ✦ Biomes 5–9 art + mobs wave 2 (L/A) — todo
- [ ] **M5-08** Daily Quest + torches (M/B) — todo
- [ ] **M5-09** Free Practice + custom lists (M/B) — todo
- [ ] **M5-10** Achievements, cosmetics, pets (M/B) — todo
- [ ] **M5-11** ⛩ M5 E2E (M/B) — todo
- [ ] **M5-GATE** Gate — todo

## M6: Polish, PWA, hardening, release

- [ ] **M6-01** Procedural music (M/A) — todo
- [ ] **M6-02** Juice pass (M/A) — todo
- [ ] **M6-03** Quality scaler + perf (M/A) — todo
- [ ] **M6-04** Lite 2D mode (L/B) — todo
- [ ] **M6-05** PWA (M/B) — todo
- [ ] **M6-06** CSP + no-network (S/B) — todo
- [ ] **M6-07** Pseudo-locale (S/C) — todo
- [ ] **M6-08** Content review pack 👤 (M/A) — todo
- [ ] **M6-09** Docs, release, hosting (M/C) — todo
- [ ] **M6-10** Perf/budget CI (M/B) — todo
- [ ] **M6-11** Deferred: classroom report — deferred (issue closed as not planned)
- [ ] **M6-GATE** Release — todo

## Gate notes

Each gate records its result here: the date, the reviewer's verdict, owner checks (👤) and any accepted debt with its reason.

### M3 — passed 2026-11-13, no child playtest (owner: "Skip the M3 playtest"); tag `m3` pending owner OK

- **Cards:** M3-01..14 merged, plus M3-FIX-1..11 and, from M4, M4-FIX-1..3. Owner playtest 1
  (2026-11-12, `docs/screenshots/`) produced seven bugs, all fixed (#184–#190); decisions 100–111.
- **PLAN Phase 3 acceptance:**
  - Curriculum doc generated and checked in CI (`docs/curriculum.md`, `gen-curriculum-doc --check`).
  - Sim plausibility (M3-13, refreshed in M3-FIX-11): a median average Miner finishes Meadow in about
    14 sessions (target 8–20) and biomes 1–4 in 56–62 (target 40–90); a CI test pins 40–90.
  - Axe clean on every menu screen in day, night and high contrast (M3-14), plus a keyboard-only full
    flow from a new profile to the Parent Dashboard. M3-14 was green on two CI runs in a row.
- **Reviews:** every review-required card had a fresh Opus reviewer; data safety (M3-FIX-9) had two
  reviews plus 240-run two-tab races.
- **Owner checks (👤, still open):**
  - Sprout's 2nd star at 80 % instead of 85 % (decision 80): the M3-13 and M3-FIX-11 studies put slow
    Sprouts' 1★ share at 41–59 %, 49 % after the mastery alternation (err0 × 0.7).
  - GrayText contrast in the Windows Contrast themes (M3-FIX-4).
  - The open questions from M4-07 (Builder Sprout words, damaged-island reset, test fixture) and the
    mob names (branding).
  - The child playtest itself (skipped; "60 fps on an integrated GPU" was moved here and is untested).
- **Accepted debt:**
  - Sim learner parameters are guesses; findings are ranges with an err0 sensitivity table.
  - A badge toast was once read about 20 s after Results on a cold preview server (lazy chunk); on the
    playtest-2 watch-list.

### M0 — passed 2026-11-11 (tag `m0`)

- **Cards:** M0-01..05 merged with handoff notes, plus two fix cards (M0-FIX-1 from the M0-03 review,
  M0-FIX-2 from the gate review). M0-01 (#89) merged before CI existed, so it has no `ci-ok`; every
  later PR merged on a green `ci-ok`. Accepted, since M0-01 is the PR that created the toolchain CI
  runs.
- **Clean clone:** `npm ci`, `npm run verify` (initial JS 126.4 KB gzip of 450 KB) and `npm run e2e`
  (2/2) pass on a fresh clone of `main` at 6d3ee95; `npm run dev` serves `/` (200). CI on `main` is
  green, including the Linux screenshot baseline.
- **PLAN Phase 0 acceptance:** dev, test, e2e and build pass on a clean checkout; the hello-voxel cube
  renders with a nearest-filtered procedural texture (pixel check plus Linux baseline). Bundle-size
  and `jsx-a11y` lint run in CI.
- **Branch protection:** on, verified after M0-03 (`ci-ok` required, strict, no force push or delete).
- **Publish:** `:edge` and `:sha-a6aa924` reached GHCR (amd64 + arm64) on the first merge after
  M0-05. Tag `m0` publishes the first `:stable`.
- **Review (fresh Opus reviewer, `cf84915..main`):** no blocking issues. Fixed in the gate: purity
  allow-list and banned globals (M0-FIX-2); `.env` git-ignored; `publish.yml` refuses non-exact tags
  (`v1.0.0-rc.1` would have moved `:stable`) and promotes the tested `:sha-` image instead of
  rebuilding; stale handoff boxes ticked.
- **Owner checks (👤):** running the build on Proxmox can wait until M2 (card allows it). Still open
  with the owner: turn on the dependency graph; Tailscale certificates, MagicDNS and `TS_AUTHKEY`
  before the M2 playtest.
- **Accepted debt:**
  - No Playwright image cache in CI: the pull costs about 20 s per shard; caching a multi-GB image
    would cost more.
  - Watchtower image not pinned → M6-06.
  - SPA fallback answers 200 for missing non-asset files, and old hashed chunks vanish after an image
    swap → M6-05 (service worker and update flow).
  - Base images (`node`, `nginx-unprivileged:alpine`) are tags, not digests, so a rebuild can differ
    from what CI tested; promotion now avoids this for `:stable` in normal cases → M6-06.
  - If the `tailscale` container restarts alone, `voxel-typer` keeps its old network namespace and
    `tailscale serve` fails until both are recreated (documented gotcha) → M6-05, ask the owner
    before changing the compose layout.
  - `tools/check-ui-literals.ts` checks only DOM text props, so `<Button label="Play">` passes →
    M2-07 extends it to the UI kit's text props.
  - The hello-voxel build on `:stable` has no not-affiliated footer, ignores
    `prefers-reduced-motion` and shows a blank page without WebGL. It is a dev demo the kids won't
    use; M2-10/M2-11 replace it.
  - README appendix proxy wording → M6-09.
