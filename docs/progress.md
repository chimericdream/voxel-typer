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
- [x] **M0-FIX-2** Purity enforcement: allow-list and banned globals — merged (PR #FIX2)
- [x] **M0-GATE** Gate — passed 2026-11-11, tag `m0`

## M1: Engine and foundation lanes

- [ ] **M1-01** ✦ Contracts into code (M/A) — todo
- [ ] **M1-02** Seeded RNG (S/B) — todo
- [ ] **M1-03** ✦ Typing session and matcher (L/A) — todo
- [ ] **M1-04** Stats, stars, key-stat folding (M/B) — todo
- [ ] **M1-05** Adaptive engine (M/A) — todo
- [ ] **M1-06** Content generator (M/B) — todo
- [ ] **M1-07** Replay harness and simulator (M/B) — todo
- [ ] **M1-08** Input normalization (S/B) — todo
- [ ] **M1-09** Save layer (M/B) — todo
- [ ] **M1-10** Word-list pipeline (M/B) — todo
- [ ] **M1-11** Keyboard layouts (S/C) — todo
- [ ] **M1-12** i18n runtime (S/B) — todo
- [ ] **M1-13** Voxel grid and mesher (M/A) — todo
- [ ] **M1-14** Palette, recipes, atlas (M/A) — todo
- [ ] **M1-GATE** Gate — todo

## M2: Vertical slice: Mine mode on Meadow (go/no-go)

- [ ] **M2-01** Render core (M/A) — todo
- [ ] **M2-02** Sky, clouds, day/night (M/A) — todo
- [ ] **M2-03** Meadow diorama (M/A) — todo
- [ ] **M2-04** Block registry v1 + loot (M/B) — todo
- [ ] **M2-05** FX (M/A) — todo
- [ ] **M2-06** Audio synth and SFX (M/A) — todo
- [ ] **M2-07** Voxel UI kit (M/A) — todo
- [ ] **M2-08** Fonts and typography (S/B) — todo
- [ ] **M2-09** On-screen keyboard + hands (M/B) — todo
- [ ] **M2-10** App shell, routing, hooks (M/A) — todo
- [ ] **M2-11** Screens v1 (M/B) — todo
- [ ] **M2-12** Meadow lessons 1–6 (S/A) — todo
- [ ] **M2-13** ✦ ⛩ Mine mode (L/A) — todo
- [ ] **M2-14** HUD (M/B) — todo
- [ ] **M2-15** ⛩ Slice E2E + baselines (M/B) — todo
- [ ] **M2-16** Playtest kit (S/C) — todo
- [ ] **M2-GATE** Go/no-go — todo

## M3: Curriculum, adaptation, meta screens

- [ ] **M3-01** Curriculum validator + doc gen (S/B) — todo
- [ ] **M3-02** Word lists biomes 1–4 (L/A) — todo
- [ ] **M3-03** Lessons biomes 1–4 (M/A) — todo
- [ ] **M3-04** ✦ World map (L/A) — todo
- [ ] **M3-05** Placement test (M/B) — todo
- [ ] **M3-06** Remedial + recommendations (M/B) — todo
- [ ] **M3-07** Accessibility features (M/B) — todo
- [ ] **M3-08** Settings + parent gate (M/B) — todo
- [ ] **M3-09** Profiles + avatar (M/B) — todo
- [ ] **M3-10** Achievements v1 (M/B) — todo
- [ ] **M3-11** Parent Dashboard v1 (L/B) — todo
- [ ] **M3-12** Migrations + import/export UI (S/B) — todo
- [ ] **M3-13** Progression sim study (M/A) — todo
- [ ] **M3-14** ⛩ E2E + a11y sweep (M/B) — todo
- [ ] **M3-GATE** Gate — todo

## M4: Night Defense and Home Island Builder

- [ ] **M4-01** Voxel model runtime (M/A) — todo
- [ ] **M4-02** Model Lab (S/C) — todo
- [ ] **M4-03** ✦ Mobs wave 1 (L/A) — todo
- [ ] **M4-04** ✦ ⛩ Night Defense mode (L/A) — todo
- [ ] **M4-05** Wave director (M/A) — todo
- [ ] **M4-06** Island data + persistence (S/B) — todo
- [ ] **M4-07** ✦ ⛩ Builder mode (L/A) — todo
- [ ] **M4-08** Blueprints, expansion, snapshot (M/B) — todo
- [ ] **M4-09** Inventory screen (M/B) — todo
- [ ] **M4-10** ⛩ No-failure invariants + E2E (M/B) — todo
- [ ] **M4-GATE** Gate — todo

## M5: Minecart, Bosses, Daily Quest, biomes 5–9

- [ ] **M5-01** ✦ ⛩ Minecart Run (L/A) — todo
- [ ] **M5-02** ⛩ Boss framework + DSL (M/A) — todo
- [ ] **M5-03** ✦ Boss designs + models (L/A) — todo
- [ ] **M5-04** Boss scripts (M/B) — todo
- [ ] **M5-05** Content biomes 5–9 (L/A) — todo
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
