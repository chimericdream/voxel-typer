# Contributing

Most of the work on Voxel Typer is done by AI agents, one task card at a time, with the owner
reviewing. The same flow applies to humans. The full version, with roles, brief templates and
milestone gates, is in [`docs/impl/README.md`](docs/impl/README.md) §3.

## The flow

1. **Pick a card.** Each piece of work is a task card in `docs/impl/tasks-*.md` with a GitHub issue
   of the same name. Start a card only when everything in its **Depends on** list is merged.
2. **Branch.** Work on `task/<ID>` from `origin/main`, in its own git worktree if several tasks run
   at once:

   ```sh
   git fetch && git worktree add ../vt-wt/<ID> -b task/<ID> origin/main
   cd ../vt-wt/<ID> && npm ci
   ```

3. **Stay in your lane.** Change only the files the card lists under **Owns** and **May touch**
   (`docs/impl/contracts.md` §0). If a contract doesn't fit, stop and ask in the handoff note
   (`docs/impl/README.md` §4.3).
4. **Commit** with conventional commits scoped to the task: `feat(M1-04): weak-key weighting`.
5. **Write the handoff note** at `docs/handoffs/<ID>.md`, using the headings in
   `.github/pull_request_template.md`. End it with `Closes #<issue>`.
6. **Verify and open the PR:**

   ```sh
   npm run verify
   git push -u origin task/<ID>
   gh pr create --base main --title "<type>(<ID>): <card title>" \
     --body-file docs/handoffs/<ID>.md --label m<N> --label tier-<a|b|c>
   ```

   Open it as a draft if the task is `blocked` or `partial`.

7. **CI and review.** Every required check must pass. The orchestrator (or a reviewer agent) checks
   the PR against the card's acceptance list. Fixes go on the same branch.
8. **Merge.** The orchestrator squash-merges with the PR title as the commit subject. Contributors
   don't merge their own PRs.

## Rules worth repeating

- Lint and format with Oxlint and Oxfmt only. Never add ESLint, Prettier or their plugins.
- Never hand-merge `package-lock.json`. Take `main`'s copy, re-apply your `package.json` change, and
  run `npm install`.
- Screenshot baselines come only from the **Update snapshots** workflow on Linux CI. Use
  `npm run e2e:docker` to compare pixels locally.
- All kid-facing text goes through `t()`. See [`CLAUDE.md`](CLAUDE.md) for the copy tone, the purity
  rule and the IP rule.
