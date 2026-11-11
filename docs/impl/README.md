# Voxel Typer: Execution Plan

`PLAN.md` says **what** to build and why. This folder says **how to build it with a team of agents**: who does what, in what order, against which interfaces, and how each piece of work is checked.

The plan is written for an **orchestrator** agent that splits the work into tasks and hands them to **worker** sub-agents (Opus 5.5, Fable 5.2, or similar). A single agent can also follow it alone by doing the tasks in graph order.

## File index

| File | What's in it | Who reads it |
|---|---|---|
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
- Owns `main`, `docs/progress.md`, `docs/decisions.md`, `task-graph.md`'s status board, and the files marked **orchestrator-owned** in `contracts.md` §0.
- Picks the next ready tasks from the graph (all dependencies merged), writes a brief for each (template in §5), and spawns workers.
- Reviews each worker's output against the task card's acceptance list, runs `npm run verify` on the rebased branch, and merges it.
- Runs the **milestone gate** at the end of each milestone (§7) and records the result in `docs/progress.md`.
- Never writes big features itself. It does write small fixes, merge-conflict resolutions, and registry/index glue.

### Worker (one per task, short-lived)
- Gets one task card and nothing else to do. It reads `PLAN.md` sections named on the card, `contracts.md`, and the files under "Reads".
- Works in its own git worktree on branch `task/<ID>` (for example `task/M1-04`).
- Creates or changes only the files under "Owns" on its card, plus the shared files under "May touch", following the rules in `contracts.md` §0.
- Finishes with a handoff note (§6) and a clean `npm run verify`.
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

Tier A tasks are marked **Review: required**. If a Tier B task fails review twice, re-run it at Tier A.

Recommended concurrency is **3–4 workers at once**. More than that raises merge pressure on the few shared files and the gain flattens out.

---

## 3. Git workflow

```
main ─┬─ task/M1-02 (worktree ../vt-wt/M1-02) ── merge --no-ff ─┐
      ├─ task/M1-03 (worktree ../vt-wt/M1-03) ── merge --no-ff ─┤
      └─ ...                                                    └─ tag m1 at gate
```

1. **Create the worktree** (orchestrator): `git worktree add ../vt-wt/<ID> -b task/<ID> main`, then `npm ci` inside it.
2. **Commits** (worker): conventional commits, one subject per logical change, task ID in the scope:
   `feat(M1-04): weak-key weighting`. Small commits are fine. Never rewrite `main`.
3. **Merge** (orchestrator): `git rebase main` on the task branch, then `npm run verify` (plus `npm run e2e` when the card asks for it), then `git merge --no-ff task/<ID>`, then `git worktree remove`.
4. **Lockfile conflicts:** never hand-merge `package-lock.json`. Take `main`'s copy, re-apply the task's `package.json` change, and run `npm install`.
5. **Milestone tag:** after the gate passes, `git tag m<N>`.
6. **Pushing and PRs:** ask the owner once, at M0, whether to push `main` after each merge and whether they want a PR per task or per milestone. Record the answer in `docs/decisions.md`. Until then, work locally.

A single agent working alone can skip worktrees and do the tasks in order on a branch per milestone.

---

## 4. Conventions every worker follows

### 4.1 Commands (created in M0-01; all must work on a clean checkout)

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint + Prettier check |
| `npm test` | Vitest unit + property tests (Node environment by default) |
| `npm run test:cov` | Vitest with v8 coverage |
| `npm run e2e` | Playwright (headless Chromium, SwiftShader GL) |
| `npm run verify` | `typecheck && lint && test && build && size` (the merge gate) |
| `npm run size` | `tools/check-bundle-size.ts` against budgets in `contracts.md` §14 |
| `npm run tool -- <name> [...args]` | Runs `tools/<name>.ts` via `tsx` |

### 4.2 Code rules
- TypeScript strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any` without a `// reason:` comment. No `enum` (use string-literal unions).
- **`src/engine/`, `src/render/mesher/`, `src/render/atlas/recipes.ts`, `src/content/`, `src/save/schema.ts`, `src/save/migrations.ts` are pure.** They import no DOM, no `three`, no Preact. ESLint enforces this with `no-restricted-imports` and `no-restricted-globals` (set up in M0-01).
- Pure modules take time and randomness as parameters. They never call `performance.now()`, `Date.now()` or `Math.random()`. ESLint bans those three in pure folders.
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
with conventional commits scoped (<ID>). Then write docs/handoffs/<ID>.md.

If a contract can't hold or the card is ambiguous in a way that changes behavior,
stop and put it in the handoff note under "Contract change request" or
"Questions". Do not work around a contract silently.

Relevant context from finished tasks:
<paste "Notes for downstream tasks" from upstream handoff notes>
```

### 5.2 Reviewer brief

```
You are reviewing task <ID> on Voxel Typer. You did not write this code.

Read docs/impl/contracts.md, the task card <ID>, and the diff (`git diff main...task/<ID>`).
Run `npm run verify` (and `npm run e2e` if the card requires it).

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
2. **Bosses.** §3.1 says each of the 9 biomes has a boss, but §7.3 names only 5. There are **9 boss slots**. The 5 named bosses go to Meadow (Cobble Colossus), Frosty Peaks (Frost Wyrm), Mushroom Marsh (Mushroom Monarch), Sparkstone Factory (Sparkstone Sentinel) and Sky Citadel (Sky Hydra). M5-03 designs 4 more original bosses for Birch Forest, Sandy Shore, Deep Mines and Crystal Caverns.
3. **Bosses before M5.** Biomes 1–4 ship in M3 but the boss framework is M5. Until then, each biome's final lesson is a **mastery check** in Mine mode, and the boss lesson exists in data with `mode: 'boss'` and falls back to Mine (see the mode fallback rule, `contracts.md` §7.3).
4. **Home row.** Meadow introduces `a s d f j k l ;` and then `g h` (index-finger stretch) in its last lessons. Without `g` and `h`, there are too few real words for a whole biome. Bottom-row punctuation (`, . /`) stays in Crystal Caverns, as `PLAN.md` says.
5. **Sparkstone Factory is a side branch.** It unlocks from Crystal Caverns for any band, is suggested only to Builder band, and is **not** required to unlock Sky Citadel.
6. **Lighthouse PWA score.** Lighthouse removed its PWA category in v12, so "Lighthouse PWA ≥ 90" can't be measured. M6 replaces it with: manifest valid, service worker registered, installable (Chromium `beforeinstallprompt` fires in Playwright), and offline play passes. Lighthouse **performance** ≥ 90 on desktop stays.
7. **Bundle budget.** `PLAN.md` allows up to 5 MB gzipped initial JS. That's a hard ceiling. The working budget is tighter (`contracts.md` §14): **≤ 450 KB gzipped initial JS**, game modes lazy-loaded. `npm run size` fails at the working budget.
8. **Things an agent can't verify alone** (marked 👤 in the gates): "a 6-year-old completes lesson 1 without instructions", "60 fps on an integrated GPU", the human sensitivity review of content, and the playtests. Agents supply proxies (frame-time traces under 4× CPU throttle on SwiftShader, a facilitator script, a content dump for review) and ask the owner for the real check.
9. **Fonts.** Default choices, each SIL OFL and self-hosted: **Pixelify Sans** (pixel headings/HUD), **Atkinson Hyperlegible** (body text, long words and sentences), **OpenDyslexic** (dyslexia toggle). M2-08 verifies each license from the font's own repository, commits the license files to `public/fonts/LICENSES/`, and records the source in `docs/decisions.md`. If any license is not OFL or similar, swap it for one that is and record why. No font is bought (buying is an **ASK OWNER** item).
10. **Running TypeScript tools.** `tools/*.ts` run through `tsx` (dev dependency), not Node's built-in type stripping, so source files can use normal extension-less imports.
11. **Determinism hooks.** Tests need fixed seeds, a frozen clock and a way to read game state. These are specified once in `contracts.md` §13 (URL debug params and `window.__vt`), stripped from production builds.
12. **ASK OWNER at M0:** push/PR policy (§3.6); GitHub Actions minutes are OK to use; hosting target for M6 (GitHub Pages is the default assumption, decided at M6-09).

---

## 9. Definition of done (every task)

- Every acceptance item on the card is true and named in the handoff note with its proof.
- `npm run verify` passes on the rebased branch. If the card says **E2E**, `npm run e2e` passes too.
- No new lint suppressions without a `// reason:` comment.
- No kid-facing literal strings outside `src/i18n/`.
- No files changed outside "Owns" / "May touch".
- Handoff note written.
- Tier A tasks: reviewer reports no blocking issues.
