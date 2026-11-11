# Voxel Typer: Execution Plan

`PLAN.md` says **what** to build and why. This folder says **how to build it with a team of agents**: who does what, in what order, against which interfaces, and how each piece of work is checked.

The plan is written for an **orchestrator** agent that splits the work into tasks and hands them to **worker** sub-agents (Opus 5.5, Fable 5.2, or similar). A single agent can also follow it alone by doing the tasks in graph order.

## File index

| File | What's in it | Who reads it |
|---|---|---|
| [`HANDOFF.md`](HANDOFF.md) | Start-of-development handoff: kickoff prompt, current state, environment, status tracking in GitHub issues, how to spawn workers, autonomy rules | Orchestrator, first |
| `README.md` (this file) | Roles, workflow, conventions, brief templates, definition of done, clarifications to `PLAN.md` | Everyone, first |
| [`contracts.md`](contracts.md) | Frozen TypeScript interfaces between modules, formulas, file-ownership rules | Every worker, before writing code |
| [`task-graph.md`](task-graph.md) | Dependency DAG, parallel waves, status board | Orchestrator |
| [`tasks-m0-m1.md`](tasks-m0-m1.md) | M0 Foundations, M1 Engine + foundation lanes | Workers on those tasks |
| [`tasks-m2.md`](tasks-m2.md) | M2 Vertical slice: Mine mode on Meadow (go/no-go) | ″ |
| [`tasks-m3.md`](tasks-m3.md) | M3 Curriculum, adaptation, meta screens | ″ |
| [`tasks-m4.md`](tasks-m4.md) | M4 Night Defense + Home Island Builder | ″ |
| [`tasks-m5.md`](tasks-m5.md) | M5 Minecart, Bosses, Daily Quest, biomes 5–9 | ″ |
| [`tasks-m6.md`](tasks-m6.md) | M6 Polish, PWA, hardening, release | ″ |

Milestones M0–M6 map one-to-one onto `PLAN.md` §8 Phases 0–6.

---

## 1. Roles

### Orchestrator (one agent, long-lived)
- Owns `main`, `docs/progress.md`, `docs/decisions.md`, `task-graph.md`'s status board, and the files marked **orchestrator-owned** in `contracts.md` §0. Live status is tracked in GitHub issues, one per card (`HANDOFF.md` §5). The files are snapshots refreshed at each gate.
- Picks the next ready tasks from the graph (all dependencies merged), writes a brief for each (template in §5), and spawns workers.
- Reviews each worker's pull request against the task card's acceptance list, waits for CI to pass, and merges it (§3).
- Runs the **milestone gate** at the end of each milestone (§7) and records the result in `docs/progress.md`.
- Never writes big features itself. It does write small fixes, merge-conflict resolutions, and registry/index glue.

### Worker (one per task, short-lived)
- Gets one task card and nothing else to do. It reads `PLAN.md` sections named on the card, `contracts.md`, and the files under "Reads".
- Works in its own git worktree on branch `task/<ID>` (for example `task/M1-04`).
- Creates or changes only the files under "Owns" on its card, plus the shared files under "May touch", following the rules in `contracts.md` §0.
- Finishes with a handoff note (§6), a clean `npm run verify`, and a **pull request** to `main` (§3).
- If the card is wrong or a contract can't hold, the worker **stops and reports**. It does not quietly change a contract (see §4.3).

### Reviewer (optional, per task or per milestone)
- A fresh agent that did not write the code. It gets the task card, the diff, and the reviewer brief (§5.2).
- Used for every task marked **Review: required** and for every milestone gate.

### Owner (the human)
- Answers the questions listed in `PLAN.md` §12.9, approves milestone gates that need human eyes (marked 👤), and runs the playtests in `PLAN.md` §9.7.

---

## 2. Model routing

Every task card has a **Size** (S ≈ under 300 changed lines, M ≈ 300–1000, L ≈ over 1000 or heavy judgment) and a **Tier**:

| Tier | Meaning | Route to |
|---|---|---|
| **A** | Architecture, aesthetics, pedagogy, game feel, or anything where "is this good?" is the hard part | The strongest model available (Opus 5.5 or Fable 5.2, whichever the owner prefers for judgment work) |
| **B** | Well-specified feature work against frozen contracts | Either model |
| **C** | Mechanical: data entry, glue, config, docs generation | Either model; cheapest acceptable |

Tier A tasks are marked **Review: required**.

**DECISION (owner, 2026-11-10): model assignment.** The owner wants to try Fable 5.2 on the hardest work without spending it on routine tasks:

| Model | Gets |
|---|---|
| **Fable 5.2** (marked ✦ in `task-graph.md`) | The 10 most complex cards: **M1-01** contracts (everything builds on them), **M1-03** typing session, the four big modes **M2-13** Mine, **M4-04** Night Defense, **M4-07** Builder, **M5-01** Minecart, the **M3-04** world map, and the three art-direction cards **M4-03** mobs, **M5-03** bosses, **M5-07** biomes 5–9 art |
| **Opus 5.5** | Everything else: all other worker cards (including the large content-writing cards M3-02 and M5-05), the orchestrator, and all reviewers (a reviewer should be a different agent from the author anyway) |

Escalation: if an Opus card fails review twice, re-run it on Fable and note it in `docs/decisions.md`. Don't move cards to Fable for any other reason without asking the owner.

**DECISION (owner): at most 3 workers at once.** More would raise merge pressure on the few shared files.

---

## 3. Git workflow

**DECISION (owner):** every task lands through a **pull request**, and GitHub Actions tests as much as possible on every PR (`tasks-m0-m1.md` M0-03). `main` is protected: no direct pushes, CI must pass.

```
main ─┬─ task/M1-02 (worktree ../vt-wt/M1-02) ── PR #n ── CI green ── squash-merge ─┐
      ├─ task/M1-03 (worktree ../vt-wt/M1-03) ── PR #m ── CI green ── squash-merge ─┤
      └─ ...                                                                        └─ tag m1 at gate
```

1. **Create the worktree** (orchestrator): `git fetch && git worktree add ../vt-wt/<ID> -b task/<ID> origin/main`, then `npm ci` inside it.
2. **Commits** (worker): conventional commits, one subject per logical change, task ID in the scope:
   `feat(M1-04): weak-key weighting`. Small commits are fine.
3. **Open the PR** (worker): run `npm run verify` locally, `git push -u origin task/<ID>`, then
   `gh pr create --base main --title "<type>(<ID>): <card title>" --body-file docs/handoffs/<ID>.md`.
   Label it with its milestone (`m1` …) and `tier-a`/`tier-b`/`tier-c`. Mark it **draft** if the handoff status is `blocked` or `partial`.
4. **CI and review** (orchestrator): wait for every required check (M0-03) to pass. Then review against the card (or spawn a reviewer for **Review: required** cards; the reviewer posts findings as a PR review with `gh pr review`). Fixes go on the same branch, by the same worker if it's still alive, otherwise by a new worker briefed with the review.
5. **Merge** (orchestrator): `gh pr merge <n> --squash --delete-branch`, using the PR title as the commit subject. Then `git worktree remove ../vt-wt/<ID>`. If `main` moved and the PR conflicts, the orchestrator rebases the branch (`git rebase origin/main`, force-push with `--force-with-lease`) and waits for CI again.
6. **Lockfile conflicts:** never hand-merge `package-lock.json`. Take `main`'s copy, re-apply the task's `package.json` change, and run `npm install`.
7. **Screenshot baselines** are generated on CI's Linux runner, never on a dev machine (fonts and GL differ between OSes). A PR that adds or changes baselines runs the **Update snapshots** workflow on its branch (M0-03), which commits the new PNGs to the PR. Reviewers look at the PNG diff in the PR.
8. **Milestone tag and release:** after the gate passes, `git tag m<N> && git push origin m<N>`. Pushing a milestone tag publishes the `:stable` container image that the kids' server runs (§8.13).

A single agent working alone still opens one PR per task. It can skip worktrees.

---

## 4. Conventions every worker follows

### 4.1 Commands (created in M0-01; all must work on a clean checkout)

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | Oxlint + `oxfmt --check` + `tools/check-*.ts` guard scripts |
| `npm run format` | Oxfmt (writes changes) |
| `npm test` | Vitest unit + property tests (Node environment by default) |
| `npm run test:cov` | Vitest with v8 coverage |
| `npm run e2e` | Playwright (headless Chromium, SwiftShader GL). Skips screenshot comparisons outside CI |
| `npm run e2e:docker` | Same suite in the Linux Playwright container, with screenshot comparisons (matches CI) |
| `npm run verify` | `typecheck && lint && test && build && size` (the merge gate) |
| `npm run size` | `tools/check-bundle-size.ts` against budgets in `contracts.md` §14 |
| `npm run tool -- <name> [...args]` | Runs `tools/<name>.ts` via `tsx` |

### 4.2 Code rules
- TypeScript strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any` without a `// reason:` comment. No `enum` (use string-literal unions).
- **`src/engine/`, `src/render/mesher/`, `src/render/atlas/recipes.ts`, `src/content/`, `src/save/schema.ts`, `src/save/migrations.ts` are pure.** They import no DOM, no `three`, no Preact. Oxlint enforces this with `no-restricted-imports` and `no-restricted-globals`, backed by `tools/check-boundaries.ts` for anything Oxlint can't express (set up in M0-01).
- Pure modules take time and randomness as parameters. They never call `performance.now()`, `Date.now()` or `Math.random()`. Lint bans those three in pure folders.
- **Lint and format use the Oxc stack (Oxlint, Oxfmt). The owner strongly prefers it: never add ESLint, Prettier or their plugins.** Missing checks become small `tools/check-*.ts` scripts.
- All kid-facing text goes through `t()` (see `contracts.md` §11). A lint rule (M0-02) flags string literals in JSX text.
- Each new runtime dependency gets a line in the handoff note: name, why, gzip size. Prefer none.
- No network requests at runtime. Ever. Fonts are self-hosted under `public/fonts/`.
- Tests go next to the work: `tests/unit/<area>/*.test.ts`. Property tests use `fast-check` and a fixed `seed` reported on failure.

### 4.3 When a contract doesn't fit
Contracts in `contracts.md` are frozen once M1-01 merges. If a worker needs a change:
1. Stop. Write the proposed diff to the contract and the reason in the handoff note under **Contract change request**.
2. The orchestrator decides. If it approves, it edits `contracts.md` and the shared type file on `main` in its own commit (`chore(contracts): …`), then tells any in-flight workers affected.
3. Additive changes (a new optional field, a new event variant that existing `switch` statements can ignore) can be approved fast. Breaking changes need a reviewer.

### 4.4 Kid-facing copy
Warm, short, concrete, no sarcasm, no pressure words. "Almost! Try that key again", never "Wrong!". Sprout-band strings use words a 6-year-old can read. Copy-heavy tasks list "Copy review" in their acceptance items.

### 4.5 IP rule (repeat of `PLAN.md` §1)
No Mojang/Microsoft assets, names, textures, sounds, fonts, mobs or characters. Don't name things after them ("creeper", "enderman", "redstone", "nether", "steve" are all banned in code identifiers and content). The word-list validator's blocklist includes these terms so they can't slip into content.

---

## 5. Brief templates

### 5.1 Worker brief (the orchestrator fills in the `<…>` parts)

```
You are a worker on the Voxel Typer project, task <ID>: <title>.

Working directory: <absolute worktree path>   Branch: task/<ID>

Read first, in this order:
1. docs/impl/README.md §4 (conventions) and §6 (handoff note format)
2. docs/impl/contracts.md (all of it; it is the law for module boundaries)
3. The task card for <ID> in docs/impl/<tasks file>
4. PLAN.md sections: <list from the card>
5. Files listed under "Reads" on the card

Do exactly what the card says. Create/modify only files under "Owns", plus
"May touch" files under the rules in contracts.md §0.

Definition of done: every acceptance item on the card is true, `npm run verify`
passes, and (if the card says so) `npm run e2e` passes. Commit on your branch
with conventional commits scoped (<ID>). Write docs/handoffs/<ID>.md, push the
branch and open a PR as described in docs/impl/README.md §3.3. Do not merge it.
If CI fails on the PR, fix it on the branch until it is green, then report the
PR URL and its check status.

If a contract can't hold or the card is ambiguous in a way that changes behavior,
stop and put it in the handoff note under "Contract change request" or
"Questions". Do not work around a contract silently.

Relevant context from finished tasks:
<paste "Notes for downstream tasks" from upstream handoff notes>
```

### 5.2 Reviewer brief

```
You are reviewing task <ID> on Voxel Typer. You did not write this code.

Read docs/impl/contracts.md, the task card <ID>, and the PR diff (`gh pr diff <n>`).
Check the PR's CI results (`gh pr checks <n>`), including screenshot diffs in the
Playwright report artifact when baselines changed.
Post your findings as a PR review (`gh pr review <n> --request-changes` or `--comment`).

Report, most severe first:
1. Acceptance items on the card that are NOT met (quote the item).
2. Contract violations (imports across forbidden boundaries, changed shared types,
   impure code in pure folders, files outside "Owns").
3. Correctness bugs with a concrete failing input.
4. Child-safety, privacy, accessibility or IP problems (PLAN.md §1, §4.6, §6.7).
5. Only then: simplifications worth doing now.
Do not report style nits that lint already covers. Say "no blocking issues" if so.
```

### 5.3 Visual review brief (for Tier A render/art/feel tasks)

```
Run the dev build, open <URL with ?seed=…&freeze=1>, and take Playwright screenshots
at 1280×720 of: <list>. Look at them and answer honestly:
- At a glance, does this read as a blocky voxel world with original pixel textures?
- Is every piece of text readable for a 6-year-old (size, contrast over the scene)?
- Does anything look like a copy of an existing game's assets?
- What single change would most improve it?
Attach the screenshots' paths in your report.
```

---

## 6. Handoff note format (`docs/handoffs/<ID>.md`)

The handoff note is committed with the task **and** used as the PR body, so the reviewer and the orchestrator read the same thing.

```md
# <ID> <title>
Status: done | blocked | partial
## What changed
- bullet list of modules/files, one line each
## Acceptance
- [x] each acceptance item from the card, ticked, with the test/command that proves it
## Decisions
- OPEN choices made, one line each with the reason (orchestrator copies to docs/decisions.md)
## New dependencies
- name@version: why, gzip size
## Notes for downstream tasks
- anything a later task must know (APIs added beyond the contract, gotchas, TODOs left on purpose)
## Contract change request / Questions
- (empty if none)
```

---

## 7. Milestone gates

Each milestone ends with a **gate task** (`M<N>-GATE`) owned by the orchestrator:

1. All task cards in the milestone are merged and their handoff notes are present.
2. `npm run verify` and `npm run e2e` pass on `main` from a clean clone (`git clone` into a temp dir, `npm ci`, run both).
3. The milestone's acceptance list from `PLAN.md` §8 is checked item by item. Items marked 👤 need the owner. The orchestrator prepares what the owner needs (screenshots, a build link, the playtest script) and asks.
4. A reviewer runs §5.2 over the whole milestone diff (`git diff m<N-1>..main`), and §5.3 for M2, M4, M5 and M6.
5. Findings are either fixed (new small tasks `M<N>-FIX-<n>`) or written down in `docs/progress.md` as accepted debt with a reason.
6. Tag `m<N>`. Update `docs/progress.md`.

**M2 is go/no-go.** If the M2 gate shows the core loop isn't fun or doesn't look like a voxel world, the orchestrator stops and reports to the owner before starting M3.

---

## 8. Clarifications and corrections to `PLAN.md`

These were found while planning the execution. They are **DECISIONS** unless marked **ASK OWNER**. M0-02 copies them into `docs/decisions.md`.

1. **Phase sequencing.** `PLAN.md` §8 says not to start a phase until the previous one is green. For multi-agent work, that rule now applies to **milestone gates and integration tasks**. Leaf tasks whose dependencies are merged may start early (for example, the word-list pipeline runs in parallel with the engine). The graph in `task-graph.md` encodes this.
2. **Bosses.** §3.1 says each of the 9 biomes has a boss, but §7.3 names only 5. There are **9 boss slots**. The 5 named bosses go to Meadow (Cobble Colossus), Frosty Peaks (Frost Wyrm), Mushroom Marsh (Mushroom Monarch), Sparkstone Factory (Sparkstone Sentinel) and Sky Citadel (Sky Hydra). The other 4 use names the owner approved for now: **Bramble Stag** (Birch Forest), **Tidecrab King** (Sandy Shore), **Lantern Mole** (Deep Mines) and **Prism Moth** (Crystal Caverns). M5-03 designs them.
3. **Bosses before M5.** Biomes 1–4 ship in M3 but the boss framework is M5. Until then, each biome's final lesson is a **mastery check** in Mine mode, and the boss lesson exists in data with `mode: 'boss'` and falls back to Mine (see the mode fallback rule, `contracts.md` §7.3).
4. **Home row.** Meadow introduces `a s d f j k l ;` and then `g h` (index-finger stretch) in its last lessons. Without `g` and `h`, there are too few real words for a whole biome. Bottom-row punctuation (`, . /`) stays in Crystal Caverns, as `PLAN.md` says.
5. **Sparkstone Factory is a side branch.** It unlocks from Crystal Caverns for any band, is suggested only to Builder band, and is **not** required to unlock Sky Citadel.
6. **Lighthouse PWA score.** Lighthouse removed its PWA category in v12, so "Lighthouse PWA ≥ 90" can't be measured. M6 replaces it with: manifest valid, service worker registered, installable (Chromium `beforeinstallprompt` fires in Playwright), and offline play passes. Lighthouse **performance** ≥ 90 on desktop stays.
7. **Bundle budget.** `PLAN.md` allows up to 5 MB gzipped initial JS. That's a hard ceiling. The working budget is tighter (`contracts.md` §14): **≤ 450 KB gzipped initial JS**, game modes lazy-loaded. `npm run size` fails at the working budget.
8. **Things an agent can't verify alone** (marked 👤 in the gates): "a 6-year-old completes lesson 1 without instructions", "60 fps on an integrated GPU", the human sensitivity review of content, and the playtests. Agents supply proxies (frame-time traces under 4× CPU throttle on SwiftShader, a facilitator script, a content dump for review) and ask the owner for the real check.
9. **Fonts.** Default choices, each SIL OFL and self-hosted: **Pixelify Sans** (pixel headings/HUD), **Atkinson Hyperlegible** (body text, long words and sentences), **OpenDyslexic** (dyslexia toggle). M2-08 verifies each license from the font's own repository, commits the license files to `public/fonts/LICENSES/`, and records the source in `docs/decisions.md`. If any license is not OFL or similar, swap it for one that is and record why. No font is bought (buying is an **ASK OWNER** item).
10. **Running TypeScript tools.** `tools/*.ts` run through `tsx` (dev dependency), not Node's built-in type stripping, so source files can use normal extension-less imports.
11. **Determinism hooks.** Tests need fixed seeds, a frozen clock and a way to read game state. These are specified once in `contracts.md` §13 (URL debug params and `window.__vt`), stripped from production builds.
12. **Owner answers (2026-11-10):** agents open a PR per task (§3); GitHub Actions should test as much as possible (M0-03); the game is self-hosted on the owner's Proxmox server for their kids (§8.13). The repo is **public**, so Actions minutes aren't a constraint: keep the full CI matrix (sharded e2e on every PR, nightly 3× flake runs). Model assignment and the 3-worker cap are in §2. The owner will make the GHCR package public when deployment starts (M0-05), so Watchtower needs no token.
13. **Hosting (DECISION).** The same pipeline as the owner's home dashboard: GitHub Actions builds a container image and pushes it to GHCR; the Proxmox host runs it with Docker Compose (Debian LXC or small VM) and **Watchtower** pulls new images. It's pull-based, so the server needs no inbound access from GitHub. Specifics:
    - Image `ghcr.io/chimericdream/voxel-typer`: a static `dist/` served by an unprivileged web server (nginx or Caddy, alpine), with the security headers from M6-06 and correct caching (hashed assets immutable; `index.html`, `sw.js` and the manifest `no-cache`).
    - Tags: `:edge` + `:sha-<sha>` on every merge to `main`; `:stable` + `:m<N>` (later `:v1.x.y`) on milestone/release tags. **The kids' instance follows `:stable`**, so they only get builds that passed a milestone gate. An optional second container on `:edge` is for the owner to preview.
    - Packaging lands early (M0-05), so the owner can host the M2 slice for the go/no-go playtest.
    - **HTTPS is required, not optional.** Service workers (offline play, install), and `crypto.randomUUID()` only work in a secure context. Plain `http://192.168.x.x` would silently lose offline support. **Owner chose (a), Tailscale, on 2026-11-10.** The options were: (a) a Tailscale sidecar with `tailscale serve` HTTPS on a `*.ts.net` name, like the home dashboard (the kids' devices need Tailscale); (b) an existing reverse proxy on the LAN with a real domain and a DNS-01 Let's Encrypt certificate (no client setup; recommended if the owner has a domain); (c) Caddy's internal CA (each kid device must trust the root cert). Separately, the app must still work, minus offline/install, if it's ever opened over plain HTTP: every secure-context API is feature-detected, with a fallback (`contracts.md` §15 note).
    - Kids' devices on the LAN only. No ports exposed to the internet. This fits `PLAN.md` §6.7.
14. **Scope cuts (owner, 2026-11-10).** Not in v1, and not to be built unless the owner asks again: Dvorak/Colemak/AZERTY/QWERTZ layouts, tablet/touch on-screen keyboard input, and async "ghost" runs. Layouts stay data-driven (`PLAN.md` §4.5) and en-US + en-GB still ship (M1-11), since that costs almost nothing. Touch devices get the friendly "keyboard required" message from `PLAN.md` §6.5 and nothing more. The **classroom report** (many profiles → CSV) is **deferred**: the owner may later turn this into a product for schools, which would bring its own design questions (accounts, sync, school privacy rules) that conflict with v1's local-only design. Don't build it, but don't make choices that block it: keep the per-profile CSV export (M3-11) and the export-all JSON (M1-09) clean and documented.

---

## 9. Definition of done (every task)

- Every acceptance item on the card is true and named in the handoff note with its proof.
- `npm run verify` passes locally, and every required CI check passes on the PR. If the card says **E2E**, the e2e checks are among them.
- No new lint suppressions without a `// reason:` comment.
- No kid-facing literal strings outside `src/i18n/`.
- No files changed outside "Owns" / "May touch".
- Handoff note written.
- Tier A tasks: reviewer reports no blocking issues.
