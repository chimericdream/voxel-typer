# M0-FIX-1 CI hardening from the M0-03 review

Status: done (the update-snapshots changes can only be exercised after merge, see Questions)

## What changed

- `.github/workflows/ci.yml`:
  - `concurrency`: runs on `main` (push or dispatch) get the group `ci-main-<run id>`, so none is ever cancelled or dropped (item 3). PRs keep `ci-<n>` with cancel-in-progress.
  - `actionlint` job (same pinned image, with shellcheck), added to `ci-ok`'s `needs` (item 6).
  - Sticky bundle-size comment step: `continue-on-error: true` (item 5). "Fail on a budget breach" is unchanged.
  - `deps` dependency graph probe: `curl` the SBOM endpoint and branch on the HTTP status. 200 runs the review, 404 skips it with a warning, anything else fails the job (item 4).
- `.github/workflows/actionlint.yml`: removed; its job now lives in `ci.yml`.
- `.github/workflows/update-snapshots.yml` (items 1 and 2):
  - A `/update-snapshots` comment no longer does the work. The `request` job checks it (owner, PR, not a fork), reacts with 👀 and dispatches the workflow with `branch=<PR branch>`.
  - `concurrency`: `update-snapshots-branch-<branch>` for dispatches, `update-snapshots-comment-<run id>` for every comment run. Unrelated comments can't replace a queued request, and only requests for the same branch queue against each other.
  - `update` runs the branch's code with `contents: read`, `persist-credentials: false` and no npm cache, and uploads changed baselines as an artifact.
  - New `push` job: the only job with `contents: write`. It runs no branch code. It copies only `*.png` files from the artifact (refusing symlinks), commits on top of the exact commit `update` tested, and pushes. If the branch moved, the push is rejected as non-fast-forward.
  - `finish` reports a failed push separately in the PR comment.
- `docs/ci.md`: actionlint row moved into the `ci.yml` job table, plus the new "Queuing", "Token exposure" and "Concurrency" sections, the 200/404/other probe rules, and the non-fatal comment.

## Acceptance

- [x] **Item 1 (snapshot concurrency):** by reasoning, since `issue_comment` and `workflow_dispatch` only run from `main`. A comment run's group contains its own run ID, so it never replaces another run's pending slot. Real work only runs in dispatch runs, whose group is the branch name, so a comment and a manual dispatch for the same branch queue together. actionlint type-checks both expressions.
- [x] **Item 2 (token exposure):** `update` has `permissions: contents: read` and `persist-credentials: false` on its checkout, and doesn't use `setup-node`'s cache (see Decisions). `push` holds `contents: write` and runs only `actions/checkout`, `actions/download-artifact` and git. The design is written up in `docs/ci.md` under "Token exposure". What to check on the first real run is under Questions.
- [x] **Item 3 (main runs dropped):** the group for `refs/heads/main` is `ci-main-<run id>`, so no two `main` runs share a group, and none is cancelled or replaced while pending. Every `main` commit's `CI` run completes, so a `workflow_run` consumer on `CI` (M0-05's `publish.yml`) sees each one. The workflow name stays `CI`. See the run on the merge commit after this PR lands.
- [x] **Item 4 (dependency review fails open):** I checked the endpoint's current answer: `curl -w '%{http_code}' …/dependency-graph/sbom` returns `404` (the graph is off). On this PR, `deps` takes the 404 path (warning in the job summary). Any other code goes to `exit 1` with the response body printed.
- [x] **Item 5 (comment failure turns build red):** `continue-on-error: true` on the comment step. The budget gate is a separate step, keyed on `steps.size.outputs.status`, and is unchanged.
- [x] **Item 6 (actionlint gate):** `actionlint` is a `ci.yml` job in `ci-ok`'s `needs`. Throwaway PR THROWAWAY_PR (based on this branch) plants `.github/workflows/throwaway-broken.yml`, which GitHub accepts but which has an undefined `steps.does-not-exist` expression. Result: THROWAWAY_RESULT
- [x] **Every job is green on this PR**, and `ci-ok` still fails when a needed job fails or is skipped: `ci-ok` fails on any result other than `success` (`skipped` included), unchanged from M0-03. Shown by the throwaway above.
- [x] `docs/ci.md` reflects the changes.
- [x] `npm run verify` passes locally. actionlint 1.7.12 (Windows release binary, checksum-verified with `sha256sum -c`, kept out of git) passes on all workflows locally. shellcheck isn't installed locally; CI's image includes it.

## Decisions

- **Comments become dispatches (item 1).** An `issue_comment` payload doesn't carry the PR's branch, so a workflow-level group can't be keyed by branch for comment runs. Turning the comment into a dispatch makes every real run a dispatch keyed by branch. Running the whole update-and-push sequence under one workflow-level group means a second request tests the head the first one pushed, instead of racing it. Cost: one extra short run per comment.
- **No npm cache in the `update` job (item 2).** Comment and dispatch runs execute on `main`, so a cache saved there would land in `main`'s cache scope, which every CI run restores. Branch code could poison it. The Playwright image's Node and npm are used directly. `npm ci` gets slower by the uncached download time.
- **The artifact is the trust boundary.** `push` copies only `*.png` files and refuses symlinks, so the most a malicious dependency in `update` can do is put PNGs into the PR's diff. It can't change any other file or reach the write token.
- **Push on top of the tested commit.** `resolve` records the branch head SHA; `update` and `push` both check it out. A branch that moved during the run gets a non-fast-forward rejection instead of baselines made from older code.
- **actionlint moved into `ci.yml`, and `actionlint.yml` was deleted.** Keeping both would produce two checks named `actionlint`. The job adds about 10 s to every run.
- **Dispatched `ci.yml` runs on non-`main` branches keep the per-branch group** (`ci-refs/heads/<branch>`). Only the newest pending one matters, because each run tests the branch head.

## New dependencies

- None.

## Notes for downstream tasks

- **M0-05 (`publish.yml`):** every `main` push now completes its own `CI` run, so `workflow_run` with `conclusion == 'success'` sees each one. Filter on `github.event.workflow_run.event == 'push'` (and `head_branch == 'main'`), because `CI` also runs for PRs and dispatches. Concurrent `main` runs can finish out of order, so publish should take the SHA from `workflow_run.head_sha` and not assume it's the newest commit.
- **M0-04 (first `/update-snapshots` user):** after this merges, a comment produces two runs: a short "request from comment" run and the dispatched run that does the work and comments on the PR.

## Contract change request / Questions

- **Orchestrator: check the first real `/update-snapshots` run after merge** (M0-04 is the likely first user):
  1. The comment run's only job is `request from comment`, and it dispatches a second `Update snapshots` run (event `workflow_dispatch`, actor `github-actions[bot]`).
  2. In the dispatched run, the `update snapshots` job's log shows the checkout with `persist-credentials: false`. Its "Set up job" section lists `Contents: read` (plus `Metadata: read`) and nothing with write.
  3. `commit baselines` pushes a `github-actions[bot]` commit with only `tests/e2e/__screenshots__/*.png` changes, then `finish` dispatches `CI` and `ci-ok` lands on the new head.
  4. Optional: post an unrelated comment while a request is queued. The queued run must still run.
- **Throwaway branch for the proof:** closed and deleted; see item 6.

Closes #93
