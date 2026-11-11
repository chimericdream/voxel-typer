# Orchestrator handoff

For the agent starting development (Opus 5.5, high effort). Read this first, then `README.md`, `contracts.md` and `task-graph.md` in this folder. `PLAN.md` at the repo root is the product design; read it in full once.

## 1. Kickoff prompt (the owner pastes this into the new session)

```
You are the orchestrator for Voxel Typer. Read docs/impl/HANDOFF.md, then follow it.
Start with the "First session checklist" in §4. Work autonomously within the rules
there; stop and ask me only at the points it lists.
```

## 2. State at handoff (2026-11-10)

- Repo `chimericdream/voxel-typer`, **public**, default branch `main`. Commits so far are docs only: `PLAN.md`, `docs/impl/*`, `.gitignore` (ignores `.idea/`). No code, no `package.json`, no CI.
- `main` is **not protected yet**. M0-03 turns protection on. Until then, still land every change through a PR.
- All owner decisions to date are in `README.md` §2 (models, 3 workers) and §8 (clarifications, PR flow, CI, Proxmox + Tailscale hosting, scope cuts). They are final. Don't re-ask them.
- Open owner items, asked only when their task comes up: make the GHCR package public (M0-05 deploy), turn on MagicDNS + HTTPS certificates in the tailnet and create a `TS_AUTHKEY` (M0-05 deploy), the M2 kid playtest, real-hardware fps checks (M2, M6), the content read-through (M6-08).

## 3. Environment facts (owner's dev machine)

| Thing | Value |
|---|---|
| OS / shells | Windows 11. Git Bash and PowerShell 5.1 both available. Prefer Bash for git/npm; PowerShell lacks `&&`. |
| Node / npm | 26.12.1 / 11.20.0 |
| gh | 2.96.0, logged in as `chimericdream`, **admin** on the repo, token scopes `repo`, `write:packages` |
| Git remote | SSH (`git@github.com:…`), so pushing `.github/workflows/*` works even though the gh token has no `workflow` scope. If a push of workflow files is ever rejected, ask the owner to run `gh auth refresh -s workflow`. |
| Docker | 29.9.2 available locally: use it for screenshot-accurate e2e (§6) and to test the image (M0-05) |
| Playwright | 1.65 resolvable via npx (M0-01 installs it as a dev dependency) |
| Shared memory | MemPalace hooks run in every session. File decisions there as they happen (`mempalace_add_drawer`, wing `wing_voxel_typer`, room `decisions`). |

## 4. First session checklist

1. Read the docs listed at the top. Run `git pull`, `gh auth status`, `node -v`.
2. **Create one GitHub issue per task card** (§5). Script it with `gh`, reading the status-board table in `task-graph.md`. Create labels first.
3. Start **M0-01** (Opus worker). M0 is mostly sequential: M0-01 → M0-03 + M0-02 → M0-05 + M0-04 → M0-GATE.
4. After M0-03 merges, confirm branch protection is on (`gh api repos/chimericdream/voxel-typer/branches/main/protection`).
5. Keep going wave by wave (`task-graph.md`), 3 workers at most.

## 5. Tracking status across sessions

This orchestrator will run across many sessions and context resets, so status must live outside the conversation. Once `main` is protected, the orchestrator can't push board updates directly, so **GitHub is the live status board**:

- **One issue per card**, title `<ID> <title>`, body = a link to the card (`docs/impl/tasks-*.md#<anchor>`) plus its dependencies as a task list of issue links.
- **Labels:** `m0` … `m6`; `model:fable` or `model:opus` (✦ cards are Fable); `tier-a/b/c`; `status:ready`, `status:running`, `status:review`, `status:blocked`; `gate`; `owner` (waiting on the owner).
- Each worker PR says `Closes #<issue>`. A merged PR closes the issue.
- A GitHub milestone per M0–M6, so `gh issue list --milestone m2 --state open` shows what's left.
- The `Status` column in `task-graph.md` and `docs/progress.md` get refreshed **in the gate PR** at the end of each milestone (a snapshot, not the live source).
- **Resuming in a new session:** `gh issue list --label status:running` and `gh pr list` show work in flight. Check each running worker's branch and PR before starting anything new, so work isn't duplicated.

## 6. Spawning workers in this harness

- **Agent tool:** pass `model: "fable"` for ✦ cards and `model: "opus"` for everything else. The orchestrator itself is Opus.
- **Isolation:** use the harness's worktree isolation (`isolation: "worktree"` on the Agent tool, or T3's `delegate_task` with a worktree), which replaces the manual `git worktree add` in `README.md` §3.1. The worker must still create branch `task/<ID>` from `origin/main`.
- **Brief:** `README.md` §5.1 is the template. Always paste the "Notes for downstream tasks" from the upstream handoff notes into it.
- **Background vs foreground:** run workers in the background when other slots have useful work, and wait on completion notifications. Don't poll.
- **Reviewers:** always a fresh Opus agent with the §5.2 brief, never the worker that wrote the code.
- **Effort:** the owner didn't set effort levels for workers. Use each agent's default. Don't raise effort on your own.

## 7. Autonomy

- **Merge on your own** when CI is green and the card's review (if required) shows no blocking issues. The owner approved the PR-per-task flow. They don't review each PR.
- **Stop and ask the owner** only for: 👤 gate items, the open items in §2, anything that would send data off the device or spend money, a **no-go** or "rethink" result at M2-GATE, a contract change a reviewer calls breaking, and a worker blocked twice on the same card.
- When you stop, say exactly what you need and what you'll do with each possible answer.

## 8. Things to watch (from planning)

- **The contracts are a first draft.** M1-01 (Fable) may correct mistakes in `contracts.md` **before** freezing. Its reviewer must check the corrections. After M1-01 merges, changes follow `README.md` §4.3.
- **Screenshots are made only on Linux.** Local `npm run e2e` on Windows skips screenshot assertions (`--ignore-snapshots` unless `CI` is set). For pixel checks locally, use `npm run e2e:docker`, which runs the suite in the same Playwright container CI uses. Both are set up in M0-01. Baselines still come only from the Update snapshots workflow.
- **Line endings:** M0-01 adds `.gitattributes` (`* text=auto eol=lf`, binary rule for `*.png`/`*.woff2`) so Windows checkouts don't fight Prettier or CI.
- **Long context:** M2-13, M4-04 and M5-01 are the largest cards. If a Fable worker's handoff says `partial`, split the rest into a follow-up card rather than re-running the whole card.
- **Tone and IP rules** (`README.md` §4.4–4.5) are where reviewers most often need to push back. Check them on every UI or content PR.
- **The owner's kids are the users.** When a trade-off isn't covered by the docs, use the priority order in `PLAN.md` §12.8.
